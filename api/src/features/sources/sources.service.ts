import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { Database, InjectDb } from '../../platform/database/database.module'
import { ambientTransaction } from '../../platform/database/transaction-context'
import { ApiError, isUniqueViolation, notFound } from '../../platform/http/errors'
import { evpConfig } from '../evp-core/evp-config'
import { evpPageOf } from '../evp-core/evp-query'
import { redactSecrets } from '../evp-core/redact-secrets'
import type { EvpAccess } from '../evp-core/evp.types'
import { shiftDay, shiftMonth, todayParis } from '../evp-core/payroll-month'
import { creches } from '../creches/creches.tables'
import { isUnlinkedCause, UNLINKED_CAUSE_LABELS, type UnlinkedCause } from './link-causes'
import { loadTypeMapping } from './payfit-types'
import { ReconciliationService } from './reconciliation.service'
import { SourceConnectors } from './source-connectors'
import { isSourceError, MAX_ERROR_MESSAGE, SourceErrorCode } from './source-error'
import { normalise, SourceReaders } from './source-readers'
import {
  AnomaliesQuery,
  READABLE_SOURCES,
  ReadableSource,
  SourceName,
  Volume,
} from './sources.schemas'
import { aqoonaPlannings, payfitCompanies, sourceAnomalies, sourceRuns } from './sources.tables'

const FAILURE_MESSAGE = 'La lecture de la source a échoué. Réessayez plus tard ; si le problème persiste, contactez un administrateur.'
const INTERRUPTED_MESSAGE = 'La lecture a été interrompue. Relancez-la.'

const LABELS: Record<SourceName, string> = {
  workspace: 'Google Workspace',
  sheets: 'Google Sheets — Contacts des crèches',
  payfit: 'PayFit',
  aqoona: 'Aqoona',
}

const runningConflict = (): ApiError => new ApiError(409, 'sources.run_in_progress', 'A reading of this source is already running')

/** rule-evp-payfit-window: from the first day of M-2 to the last day of M+2 (Europe/Paris). */
export function payfitWindow(): { from: string; to: string } {
  const month = todayParis().slice(0, 7)
  return { from: `${shiftMonth(month, -2)}-01`, to: shiftDay(`${shiftMonth(month, 3)}-01`, -1) }
}

/** rule-evp-aqoona-window: from J-28 to J+35 (Europe/Paris). */
export function aqoonaWindow(): { from: string; to: string } {
  const today = todayParis()
  return { from: shiftDay(today, -28), to: shiftDay(today, 35) }
}

const windowOf = (key: ReadableSource) => (key === 'payfit' ? payfitWindow() : key === 'aqoona' ? aqoonaWindow() : null)

/** What a failed reading is recorded as: a classified code and a French message of 1..200 characters without secret. */
interface Failure {
  code: SourceErrorCode
  message: string
}

/** rule-evp-sources-error-codes, rule-evp-secrets-never-exposed: the exception itself is never relayed or logged. */
export function failureOf(error: unknown): Failure {
  if (isSourceError(error)) {
    return { code: error.code, message: redactSecrets(error.message).slice(0, MAX_ERROR_MESSAGE) || FAILURE_MESSAGE }
  }
  return { code: 'sources.unreachable', message: FAILURE_MESSAGE }
}

interface MatchingRatePart {
  count: number
  percent: number
}
interface MatchingRateItem {
  companyId: string | null
  siret: string | null
  name: string
  total: number
  linked: MatchingRatePart
  unlinked: MatchingRatePart
}

/** One person not linked, for one cause (rule-evp-unlinked-list-grain). */
interface UnlinkedEntry {
  name: string
  cause: UnlinkedCause
  creches: string[]
}

/** rule-evp-matching-rates-people: the people of the stored slots, or the reason why they cannot be told. */
type PeopleModel =
  | { available: false; lastReadAt: string | null; windowFrom: string | null; windowTo: string | null }
  | {
      available: true
      lastReadAt: string | null
      windowFrom: string
      windowTo: string
      /** per company id (null: « Sans société identifiée »): distinct linked people and distinct unlinked people */
      companies: Map<string | null, { linked: number; unlinked: number }>
      entries: UnlinkedEntry[]
    }

interface ReadOutcome {
  volumes: Volume[]
  /** rule-evp-sources-partial-failure */
  partial: boolean
}

@Injectable()
export class SourcesService implements OnModuleInit {
  private readonly logger = new Logger(SourcesService.name)

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly connectors: SourceConnectors,
    private readonly readers: SourceReaders,
    private readonly reconciliation: ReconciliationService,
  ) {}

  /** A reading interrupted by a restart would block its source for ever: it is closed as failed. */
  async onModuleInit(): Promise<void> {
    try {
      await this.db
        .update(sourceRuns)
        .set({ state: 'FAILED', errorMessage: INTERRUPTED_MESSAGE, errorCode: 'sources.unreachable', finishedAt: new Date() })
        .where(eq(sourceRuns.state, 'RUNNING'))
    } catch {
      // the table may not exist yet (migrations not applied): nothing to close
    }
  }

  /** rule-evp-sources-manual: state, volumes, window and anomalies of each source; nothing is read by this call. */
  async list(evp: EvpAccess) {
    const config = evpConfig()
    const real = config.sourcesDriver === 'real'
    const missing = real ? this.connectors.configuration() : { sheets: [], payfit: [], aqoona: [] }
    const items = []
    for (const key of Object.keys(LABELS) as SourceName[]) {
      const base = {
        key,
        label: LABELS[key],
        canRefresh: false,
        windowFrom: null as string | null,
        windowTo: null as string | null,
        lastError: null as { code: SourceErrorCode; message: string; at: string } | null,
        addresses: [] as Array<{ label: string; masked: string }>,
      }
      if (key === 'workspace') {
        // the Google sign-in is configured or not; no outgoing call is made to know it
        items.push({ ...base, state: config.google ? ('UP_TO_DATE' as const) : ('UNAVAILABLE' as const), lastReadAt: null, currentRunId: null, volumes: [], anomalyCount: 0 })
        continue
      }
      const [running] = await this.db
        .select({ id: sourceRuns.id })
        .from(sourceRuns)
        .where(and(eq(sourceRuns.source, key), eq(sourceRuns.state, 'RUNNING')))
      const [lastDone] = await this.db
        .select({
          state: sourceRuns.state,
          partial: sourceRuns.partial,
          errorCode: sourceRuns.errorCode,
          errorMessage: sourceRuns.errorMessage,
          finishedAt: sourceRuns.finishedAt,
        })
        .from(sourceRuns)
        .where(and(eq(sourceRuns.source, key), ne(sourceRuns.state, 'RUNNING')))
        .orderBy(desc(sourceRuns.startedAt), desc(sourceRuns.id))
        .limit(1)
      const [lastSuccess] = await this.db
        .select({ finishedAt: sourceRuns.finishedAt, volumes: sourceRuns.volumes })
        .from(sourceRuns)
        .where(and(eq(sourceRuns.source, key), eq(sourceRuns.state, 'SUCCEEDED')))
        .orderBy(desc(sourceRuns.finishedAt), desc(sourceRuns.id))
        .limit(1)
      const [anomalies] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(sourceAnomalies)
        .where(eq(sourceAnomalies.source, key))
      const window = windowOf(key)
      const failed = lastDone?.state === 'FAILED'
      // rule-evp-sources-failure-state: the state shows the cause; the figures and the date of the last success stay
      const state = running
        ? ('RUNNING' as const)
        : missing[key].length > 0
          ? ('UNAVAILABLE' as const)
          : failed
            ? ('ERROR' as const)
            : lastDone?.partial
              ? ('PARTIAL' as const)
              : lastSuccess
                ? ('UP_TO_DATE' as const)
                : ('NEVER_READ' as const)
      items.push({
        ...base,
        canRefresh: evp.capabilities.includes(`sources:refresh:${key}`),
        windowFrom: window?.from ?? null,
        windowTo: window?.to ?? null,
        state,
        lastReadAt: lastSuccess?.finishedAt?.toISOString() ?? null,
        currentRunId: running?.id ?? null,
        volumes: ((lastSuccess?.volumes as Volume[] | undefined) ?? []),
        anomalyCount: Number(anomalies?.n ?? 0),
        lastError:
          failed && lastDone
            ? {
                code: (lastDone.errorCode as SourceErrorCode | null) ?? 'sources.unreachable',
                message: lastDone.errorMessage ?? FAILURE_MESSAGE,
                at: (lastDone.finishedAt ?? new Date()).toISOString(),
              }
            : null,
        // rule-evp-aqoona-mask: the addresses are listed masked, for Aqoona only
        addresses: key === 'aqoona' ? this.connectors.addresses() : [],
      })
    }
    return { items }
  }

  /**
   * rule-evp-matching-rates-people, rule-evp-matching-rates-live: the people of the Aqoona slots stored, computed on demand,
   * nothing is stored. rule-evp-matching-rates-unknown-mode (decisions D-0016, D-0015): never read with success, or a slot written
   * before v5 (mode `NOM`, `INCONNU`, any other), makes the whole answer unavailable (a rate would be wrong, not just late).
   */
  private async people(): Promise<PeopleModel> {
    const [lastSuccess] = await this.db
      .select({ finishedAt: sourceRuns.finishedAt })
      .from(sourceRuns)
      .where(and(eq(sourceRuns.source, 'aqoona'), eq(sourceRuns.state, 'SUCCEEDED')))
      .orderBy(desc(sourceRuns.finishedAt), desc(sourceRuns.id))
      .limit(1)
    if (!lastSuccess) return { available: false, lastReadAt: null, windowFrom: null, windowTo: null }
    const window = aqoonaWindow()
    const lastReadAt = lastSuccess.finishedAt?.toISOString() ?? null
    const slots = await this.db
      .select({
        personRef: aqoonaPlannings.personRef,
        crecheCode: aqoonaPlannings.crecheCode,
        companyId: aqoonaPlannings.companyId,
        employeeCompanyId: aqoonaPlannings.employeeCompanyId,
        employeeId: aqoonaPlannings.employeeId,
        method: aqoonaPlannings.matchMethod,
        cause: aqoonaPlannings.unlinkedCause,
        crecheLabel: aqoonaPlannings.crecheLabel,
      })
      .from(aqoonaPlannings)
      .orderBy(asc(aqoonaPlannings.day), asc(aqoonaPlannings.startTime), asc(aqoonaPlannings.id))
    if (slots.some((slot) => slot.method !== 'NIR' && slot.method !== 'AUCUN')) {
      return { available: false, lastReadAt, windowFrom: window.from, windowTo: window.to }
    }

    const companies = await this.db.select({ id: payfitCompanies.id }).from(payfitCompanies)
    const knownCompany = new Set(companies.map((c) => c.id))
    const crecheNames = new Map((await this.db.select({ code: creches.code, name: creches.name }).from(creches)).map((c) => [c.code, c.name]))
    // rule-evp-matching-rates-no-company (decision D-0015): no company, or a company that PayFit no longer knows
    const rowOf = (companyId: string | null): string | null => (companyId !== null && knownCompany.has(companyId) ? companyId : null)

    const linked = new Map<string | null, Set<string>>()
    const unlinked = new Map<string | null, Set<string>>()
    const entries = new Map<string, { name: string; cause: UnlinkedCause; creches: Set<string> }>()
    const add = (map: Map<string | null, Set<string>>, company: string | null, person: string) =>
      map.set(company, (map.get(company) ?? new Set<string>()).add(person))
    for (const slot of slots) {
      if (slot.employeeId !== null) {
        // rule-evp-matching-rates-company-of-person: a linked person counts for her company of reference
        add(linked, rowOf(slot.employeeCompanyId), JSON.stringify([slot.employeeCompanyId, slot.employeeId]))
        continue
      }
      // a row without identity (no cause) is not a person (rule-evp-link-no-identity)
      if (!isUnlinkedCause(slot.cause)) continue
      const person = normalise(slot.personRef)
      // an unlinked person counts for the company of each crèche where she was read
      add(unlinked, rowOf(slot.companyId), person)
      const entry = entries.get(JSON.stringify([person, slot.cause])) ?? { name: slot.personRef.slice(0, 200), cause: slot.cause, creches: new Set<string>() }
      const creche = (slot.crecheCode !== null ? crecheNames.get(slot.crecheCode) : undefined) ?? slot.crecheLabel
      if (creche) entry.creches.add(creche.slice(0, 200))
      entries.set(JSON.stringify([person, slot.cause]), entry)
    }
    const perCompany = new Map<string | null, { linked: number; unlinked: number }>()
    for (const key of new Set([...linked.keys(), ...unlinked.keys()])) {
      perCompany.set(key, { linked: linked.get(key)?.size ?? 0, unlinked: unlinked.get(key)?.size ?? 0 })
    }
    const collator = new Intl.Collator('fr', { sensitivity: 'base' })
    return {
      available: true,
      lastReadAt,
      windowFrom: window.from,
      windowTo: window.to,
      companies: perCompany,
      entries: [...entries.values()]
        .map((e) => ({ name: e.name, cause: e.cause, creches: [...e.creches].sort((a, b) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0)).slice(0, 50) }))
        .sort((a, b) => collator.compare(a.name, b.name) || (a.cause < b.cause ? -1 : a.cause > b.cause ? 1 : 0)),
    }
  }

  /**
   * rule-evp-matching-rates-people, rule-evp-matching-rates-percent: per company, the linked and the unlinked people, as counts
   * and percentages rounded in code to one decimal. Read only, nothing is traced. No NIR, no name of a person.
   */
  async matchingRates() {
    const model = await this.people()
    if (!model.available) return { available: false, lastReadAt: model.lastReadAt, windowFrom: model.windowFrom, windowTo: model.windowTo, items: [] as MatchingRateItem[] }
    const companies = await this.db.select({ id: payfitCompanies.id, siret: payfitCompanies.siret, name: payfitCompanies.name }).from(payfitCompanies)
    const known = new Map(companies.map((c) => [c.id, c]))
    const percent = (count: number, total: number) => Math.round((1000 * count) / total) / 10
    const item = (companyId: string | null, label: { siret: string | null; name: string }, c: { linked: number; unlinked: number }): MatchingRateItem => {
      const total = c.linked + c.unlinked
      return {
        companyId,
        siret: label.siret,
        name: label.name,
        total,
        linked: { count: c.linked, percent: percent(c.linked, total) },
        unlinked: { count: c.unlinked, percent: percent(c.unlinked, total) },
      }
    }
    const collator = new Intl.Collator('fr', { sensitivity: 'base' })
    const items = [...model.companies]
      // a company removed between the two reads is skipped rather than failing the whole answer
      .filter(([key, c]) => key !== null && known.has(key) && c.linked + c.unlinked >= 1)
      .map(([key, c]) => item(key, { siret: known.get(key!)!.siret, name: known.get(key!)!.name }, c))
      .sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.companyId ?? '', b.companyId ?? ''))
    // rule-evp-matching-rates-no-company: the line without company comes last
    const none = model.companies.get(null)
    if (none && none.linked + none.unlinked >= 1) items.push(item(null, { siret: null, name: 'Sans société identifiée' }, none))
    return { available: true, lastReadAt: model.lastReadAt, windowFrom: model.windowFrom, windowTo: model.windowTo, items }
  }

  /**
   * rule-evp-unlinked-list, rule-evp-unlinked-list-grain, rule-evp-unlinked-list-paging: one entry per person and per cause,
   * sorted by name then cause, paged in code after the sort; `total` counts the entries of all pages. Read only, nothing is traced.
   * rule-evp-unlinked-list-no-nir: a name, a cause, crèches; never a NIR, a fragment, an expected key or an identifier of PayFit.
   */
  async unlinkedPeople(query: AnomaliesQuery) {
    const { from, size } = evpPageOf(query, 25)
    const model = await this.people()
    if (!model.available) {
      return { available: false, lastReadAt: model.lastReadAt, windowFrom: model.windowFrom, windowTo: model.windowTo, total: 0, items: [] as Array<UnlinkedEntry & { causeLabel: string }> }
    }
    return {
      available: true,
      lastReadAt: model.lastReadAt,
      windowFrom: model.windowFrom,
      windowTo: model.windowTo,
      total: model.entries.length,
      items: model.entries.slice(from, from + size).map((entry) => ({ ...entry, causeLabel: UNLINKED_CAUSE_LABELS[entry.cause] })),
    }
  }

  async run(id: string) {
    const [row] = await this.db.select().from(sourceRuns).where(eq(sourceRuns.id, id))
    if (!row) throw notFound()
    return {
      id: row.id,
      state: row.state,
      step: row.step,
      volumes: (row.volumes as Volume[]) ?? [],
      errorMessage: row.errorMessage,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
    }
  }

  async anomalies(key: SourceName, query: AnomaliesQuery) {
    if (key === 'workspace') return { items: [], total: 0 }
    const { from, size } = evpPageOf(query, 25)
    const rows = await this.db
      .select({ type: sourceAnomalies.type, label: sourceAnomalies.label, subject: sourceAnomalies.subject, detail: sourceAnomalies.detail })
      .from(sourceAnomalies)
      .where(eq(sourceAnomalies.source, key))
      .orderBy(asc(sourceAnomalies.createdAt), asc(sourceAnomalies.id))
      .limit(size)
      .offset(from)
    const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(sourceAnomalies).where(eq(sourceAnomalies.source, key))
    return { items: rows, total: Number(n) }
  }

  /**
   * Opens a run in its own committed statement (outside the transaction of the request): the background task can then
   * see it at once, and the partial unique index refuses a second RUNNING run of the same source.
   */
  private async open(key: ReadableSource | 'all', startedBy: string, parentId: string | null, step: string | null): Promise<string> {
    return ambientTransaction.exit(async () => {
      try {
        const [row] = await this.db
          .insert(sourceRuns)
          .values({ source: key, startedBy, parentId, step })
          .returning({ id: sourceRuns.id })
        return row.id
      } catch (error) {
        if (isUniqueViolation(error)) throw runningConflict()
        throw error
      }
    })
  }

  private async close(runId: string, outcome: { volumes?: Volume[]; failure?: Failure; partial?: boolean; step?: string | null }): Promise<void> {
    await this.db
      .update(sourceRuns)
      .set({
        state: outcome.failure ? 'FAILED' : 'SUCCEEDED',
        volumes: outcome.volumes ?? [],
        errorMessage: outcome.failure ? outcome.failure.message : null,
        errorCode: outcome.failure ? outcome.failure.code : null,
        partial: outcome.failure ? false : (outcome.partial ?? false),
        finishedAt: new Date(),
        ...(outcome.step !== undefined ? { step: outcome.step } : {}),
      })
      .where(eq(sourceRuns.id, runId))
  }

  /** rule-evp-sources-manual, rule-evp-sources-run-single: launches one reading (202); the work continues in the background. */
  async start(evp: EvpAccess, key: SourceName): Promise<{ runId: string; state: 'RUNNING' }> {
    if (key === 'workspace') throw notFound()
    const runId = await this.open(key, evp.userId, null, key)
    ambientTransaction.exit(() => {
      void this.execute(key, runId)
    })
    return { runId, state: 'RUNNING' }
  }

  /** rule-evp-sources-sheets-superadmin: Sheets, then PayFit, then Aqoona; the first failure stops the chain. */
  async startAll(evp: EvpAccess): Promise<{ runId: string; steps: ReadableSource[] }> {
    const [busy] = await this.db
      .select({ id: sourceRuns.id })
      .from(sourceRuns)
      .where(and(inArray(sourceRuns.source, [...READABLE_SOURCES, 'all']), eq(sourceRuns.state, 'RUNNING')))
      .limit(1)
    if (busy) throw runningConflict()
    const runId = await this.open('all', evp.userId, null, READABLE_SOURCES[0])
    ambientTransaction.exit(() => {
      void this.executeAll(runId, evp.userId)
    })
    return { runId, steps: [...READABLE_SOURCES] }
  }

  private async execute(key: ReadableSource, runId: string): Promise<void> {
    try {
      const outcome = await this.read(key)
      await this.close(runId, { volumes: outcome.volumes, partial: outcome.partial })
    } catch (error) {
      const failure = failureOf(error)
      this.logger.warn(`Reading of ${key} failed (${failure.code})`)
      await this.close(runId, { failure }).catch(() => undefined)
    }
  }

  private async executeAll(parentId: string, startedBy: string): Promise<void> {
    const volumes: Volume[] = []
    let partial = false
    let failure: Failure | null = null
    try {
      for (const key of READABLE_SOURCES) {
        await this.db.update(sourceRuns).set({ step: key }).where(eq(sourceRuns.id, parentId))
        let child: string
        try {
          child = await this.open(key, startedBy, parentId, key)
        } catch (error) {
          // rule-evp-sources-run-single: this source was launched alone in the meantime; the chain stops and says why
          if (error instanceof ApiError && error.code === 'sources.run_in_progress') {
            failure = { code: 'sources.unreachable', message: `Une lecture de ${LABELS[key]} est déjà en cours : relancez la lecture ensuite.`.slice(0, MAX_ERROR_MESSAGE) }
          }
          throw error
        }
        try {
          const outcome = await this.read(key)
          await this.close(child, { volumes: outcome.volumes, partial: outcome.partial })
          volumes.push(...outcome.volumes)
          partial = partial || outcome.partial
        } catch (error) {
          failure = failureOf(error)
          this.logger.warn(`Reading of ${key} failed (${failure.code})`)
          await this.close(child, { failure }).catch(() => undefined)
          break
        }
      }
      await this.close(parentId, failure ? { failure } : { volumes, partial })
    } catch {
      await this.close(parentId, { failure: failure ?? { code: 'sources.unreachable', message: FAILURE_MESSAGE } }).catch(() => undefined)
    }
  }

  /**
   * One reading: the connector only reads (in memory), the reader applies it in one transaction, PayFit is then
   * reconciled. A global failure copies nothing (rule-evp-sources-failure-state).
   */
  private async read(key: ReadableSource): Promise<ReadOutcome> {
    if (key === 'sheets') {
      const result = await this.readers.applySheets(await this.connectors.listContacts())
      return { volumes: result.volumes, partial: false }
    }
    if (key === 'payfit') {
      const window = payfitWindow()
      const readAt = new Date()
      // rule-evp-payfit-type-mapping: validated first; an invalid file fails the reading before anything is read
      const mapping = evpConfig().sourcesDriver === 'real' ? await loadTypeMapping(this.db) : null
      const data = await this.connectors.listPayfit(window)
      const result = await this.readers.applyPayfit(data, readAt, window, mapping)
      await this.reconciliation.run(readAt, mapping)
      return { volumes: result.volumes, partial: result.partial ?? false }
    }
    const window = aqoonaWindow()
    const result = await this.readers.applyAqoona(await this.connectors.listPlannings(window), window, () =>
      this.connectors.listPayfitNirs(),
    )
    return { volumes: result.volumes, partial: result.partial ?? false }
  }
}
