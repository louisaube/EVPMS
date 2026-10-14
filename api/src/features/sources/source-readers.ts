import { Injectable } from '@nestjs/common'
import { and, eq, inArray, lt, notInArray, sql } from 'drizzle-orm'
import { Database, InjectDb } from '../../platform/database/database.module'
import { crecheAssignments, evpAccounts } from '../access/access.tables'
import { creches } from '../creches/creches.tables'
import { groupScopes, groups } from '../groups/groups.tables'
import { scopes } from '../scopes/scopes.tables'
import { maskNirs } from '../evp-core/redact-secrets'
import { normaliseSlotType } from './aqoona-slot-types'
import {
  AQOONA_NIR_UNAVAILABLE_DETAIL,
  AQOONA_SCOPE_MISSING_DETAIL,
  PAYFIT_SCOPE_MISSING_DETAIL,
  UNLINKED_CAUSE_LABELS,
  companyLabel,
  type UnlinkedCause,
} from './link-causes'
import { canonicalNir, nirKeyIsValid } from './nir'
import type { TypeMapping } from './payfit-types'
import type { AqoonaData, NirHolder, NirTable, PayfitNirs, PayfitData, SheetsRow, Window } from './source-connectors'
import type { Anomaly, ReadableSource, Volume } from './sources.schemas'
import {
  aqoonaMismatches,
  aqoonaPlannings,
  payfitAbsences,
  payfitCompanies,
  payfitContracts,
  payfitCoverage,
  payfitEmployees,
  sourceAnomalies,
} from './sources.tables'

export interface ReadResult {
  volumes: Volume[]
  anomalies: Anomaly[]
  /** At least one company or address failed among others (rule-evp-sources-partial-failure). */
  partial?: boolean
}

const CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,19}$/
const SIRET_PATTERN = /^\d{14}$/
const CHUNK = 500
const CONTRACT_STATUSES = ['ACTIVE', 'ARCHIVED', 'PENDING']

type Tx = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'execute'>

/** Lower case, no accent, no punctuation: « CRÈCHE ALPHA !! » and « Crèche Alpha » are the same name. */
export function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** rule-evp-aqoona-text-normalised: stray spaces (start, end, repeated) removed; anything that looks like a NIR is masked. */
function cleanText(value: unknown): string {
  return maskNirs(String(value ?? '').replace(/\s+/g, ' ').trim())
}

/** rule-evp-aqoona-text-normalised: for the establishments the comparison ignores the spaces too (« Micro-Stars », « Micro Stars »). */
const establishmentKey = (name: string): string => normalise(name).replace(/ /g, '')

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK))
  return out
}

async function replaceAnomalies(tx: Tx, source: ReadableSource, anomalies: Anomaly[]): Promise<void> {
  await tx.delete(sourceAnomalies).where(eq(sourceAnomalies.source, source))
  for (const part of chunks(anomalies)) {
    await tx.insert(sourceAnomalies).values(part.map((anomaly) => ({ source, ...anomaly })))
  }
}

/** Readers of the three sources: each applies one reading in a single transaction and returns volumes and anomalies. */
@Injectable()
export class SourceReaders {
  constructor(@InjectDb() private readonly db: Database) {}

  /**
   * rule-evp-sources-sheets, rule-evp-sources-no-invention, rule-evp-creche-scope: builds the crèche referential with its
   * scope, its technical group and the link to the global group, in one transaction. Accounts, assignments and group
   * members are never touched: the gaps are only reported (rule-evp-sources-ro-gaps-not-overwritten).
   */
  async applySheets(rows: SheetsRow[]): Promise<ReadResult> {
    const anomalies: Anomaly[] = []
    const valid: Array<{ code: string; name: string; siret: string; directrice: string; ros: Array<{ name: string; email: string }> }> = []
    const seen = new Set<string>()
    for (const row of rows) {
      const code = String(row.code ?? '').trim().toLowerCase()
      const siret = String(row.siret ?? '').replace(/\s/g, '')
      const name = String(row.name ?? '').trim() || code
      const subject = String(row.name ?? '').trim() || String(row.code ?? '').trim() || 'Ligne sans nom'
      const codeOk = CODE_PATTERN.test(code)
      const siretOk = SIRET_PATTERN.test(siret)
      if (!codeOk) anomalies.push({ type: 'CODE_INVALID', label: 'Code de crèche invalide', subject, detail: 'Le code doit comporter 1 à 20 lettres minuscules, chiffres, tirets ou soulignés.' })
      if (!siretOk) anomalies.push({ type: 'SIRET_INVALID', label: 'SIRET manquant ou invalide', subject, detail: 'Le SIRET doit comporter 14 chiffres.' })
      if (!codeOk || !siretOk) continue
      if (seen.has(code)) {
        anomalies.push({ type: 'CODE_DUPLICATE', label: 'Code de crèche en double', subject, detail: 'Ce code apparaît plusieurs fois dans le tableau ; la première ligne est retenue.' })
        continue
      }
      seen.add(code)
      valid.push({
        code,
        name,
        siret,
        directrice: String(row.directriceName ?? '').trim(),
        ros: (row.ros ?? []).map((ro) => ({ name: String(ro.name ?? '').trim(), email: String(ro.email ?? '').trim().toLowerCase() })),
      })
    }

    await this.db.transaction(async (tx) => {
      const ensureGroup = async (name: string): Promise<string> => {
        const [found] = await tx.select({ id: groups.id }).from(groups).where(sql`lower(${groups.name}) = ${name.toLowerCase()}`)
        if (found) return found.id
        const [created] = await tx.insert(groups).values({ name }).returning({ id: groups.id })
        return created.id
      }
      const allGroup = await ensureGroup('evp:all')
      for (const creche of valid) {
        const [scope] = await tx
          .insert(scopes)
          .values({ code: creche.code, name: creche.name })
          .onConflictDoUpdate({ target: scopes.code, set: { name: creche.name, updatedAt: new Date() } })
          .returning({ id: scopes.id })
        await tx
          .insert(creches)
          .values({
            code: creche.code,
            name: creche.name,
            siret: creche.siret,
            directriceName: creche.directrice || null,
            roNames: creche.ros.map((ro) => ro.name),
            verified: true,
            scopeCode: creche.code,
          })
          .onConflictDoUpdate({
            target: creches.code,
            set: {
              name: creche.name,
              siret: creche.siret,
              directriceName: creche.directrice || null,
              roNames: creche.ros.map((ro) => ro.name),
              verified: true,
              scopeCode: creche.code,
              updatedAt: new Date(),
            },
          })
        const own = await ensureGroup(`evp:${creche.code}`)
        await tx.insert(groupScopes).values([{ groupId: own, scopeId: scope.id }, { groupId: allGroup, scopeId: scope.id }]).onConflictDoNothing()
      }
      // rule-evp-creche-readonly: a crèche absent from the last successful reading is no longer verified
      await tx
        .update(creches)
        .set({ verified: false })
        .where(valid.length > 0 ? notInArray(creches.code, valid.map((c) => c.code)) : undefined)

      for (const creche of valid) {
        const people = await tx
          .select({ role: evpAccounts.role, name: evpAccounts.name, email: evpAccounts.email, active: evpAccounts.active, removedAt: evpAccounts.removedAt })
          .from(crecheAssignments)
          .innerJoin(evpAccounts, eq(evpAccounts.userId, crecheAssignments.userId))
          .where(eq(crecheAssignments.crecheCode, creche.code))
        const assignedRo = new Set(people.filter((p) => p.role === 'RO' && p.active && !p.removedAt).map((p) => p.email.toLowerCase()))
        const listed = creche.ros.map((ro) => ro.email)
        const retired = listed.length
          ? await tx
              .select({ email: evpAccounts.email })
              .from(evpAccounts)
              .where(and(sql`${evpAccounts.removedAt} is not null`, inArray(sql`lower(${evpAccounts.email})`, listed)))
          : []
        const retiredEmails = new Set(retired.map((r) => r.email.toLowerCase()))
        if (retiredEmails.size > 0) {
          anomalies.push({ type: 'RO_RETIRED', label: 'RO retirée présente dans le tableau', subject: creche.name, detail: 'Une RO retirée figure encore dans le tableau ; son accès n’est pas recréé.' })
        }
        const expected = new Set(listed.filter((email) => !retiredEmails.has(email)))
        const gap = [...expected].some((email) => !assignedRo.has(email)) || [...assignedRo].some((email) => !expected.has(email))
        if (gap) {
          anomalies.push({
            type: 'RO_GAP',
            label: 'Écart RO',
            subject: creche.name,
            detail: `${expected.size} RO dans le tableau, ${assignedRo.size} RO affectée(s) : les accès ne sont pas modifiés.`,
          })
        }
        const directrice = people.find((p) => p.role === 'DIRECTRICE' && p.active && !p.removedAt)
        if (directrice && creche.directrice && normalise(directrice.name) !== normalise(creche.directrice)) {
          anomalies.push({ type: 'DIRECTRICE_GAP', label: 'Directrice différente du tableau', subject: creche.name, detail: 'La directrice affectée n’a pas le nom indiqué dans le tableau ; le compte n’est pas modifié.' })
        }
      }
      await replaceAnomalies(tx, 'sheets', anomalies)
    })
    return {
      volumes: [
        { label: 'Crèches lues', count: rows.length },
        { label: 'Crèches mises à jour', count: valid.length },
      ],
      anomalies,
    }
  }

  /**
   * rule-evp-sources-payfit, rule-evp-sources-partial-failure: companies, collaborators, contracts and absences of the
   * companies that answered are upserted (the contract is keyed by company + PayFit contract); a company that failed keeps
   * what it had and is only marked unreachable and not exhaustive. Every returned absence is stamped `readAt`; the stale
   * ones of a company are deleted only when its read was exhaustive. A duplicated SIRET is an anomaly, not a constraint.
   * `mapping` is null with the fixtures (the v1 rules apply: no type, company or half-day anomaly).
   */
  async applyPayfit(data: PayfitData, readAt: Date, window: Window, mapping: TypeMapping | null): Promise<ReadResult> {
    const real = data.companyResults !== undefined
    const anomalies: Anomaly[] = []
    const reachableIds = new Set(
      real ? data.companyResults!.filter((r) => r.reachable && r.companyId).map((r) => r.companyId as string) : data.companies.map((c) => c.id),
    )
    const known = (id: string): boolean => reachableIds.has(id)
    await this.db.transaction(async (tx) => {
      for (const part of chunks([...new Map(data.companies.map((c) => [c.id, c])).values()])) {
        await tx
          .insert(payfitCompanies)
          .values(
            part.map((c) => ({
              id: c.id,
              siret: String(c.siret ?? '').replace(/\s/g, ''),
              name: c.name,
              keyFingerprint: c.fingerprint ?? null,
              companyIdResolvedAt: c.fingerprint ? readAt : null,
            })),
          )
          .onConflictDoUpdate({
            target: payfitCompanies.id,
            set: {
              siret: sql`excluded.siret`,
              name: sql`excluded.name`,
              // the fixtures give no key: what a real reading recorded is kept
              keyFingerprint: sql`coalesce(excluded.key_fingerprint, ${payfitCompanies.keyFingerprint})`,
              companyIdResolvedAt: sql`coalesce(excluded.company_id_resolved_at, ${payfitCompanies.companyIdResolvedAt})`,
            },
          })
      }
      const employees = [...new Map(data.employees.filter((e) => known(e.companyId)).map((e) => [`${e.companyId}|${e.id}`, e])).values()]
      for (const part of chunks(employees)) {
        await tx
          .insert(payfitEmployees)
          .values(part.map((e) => ({ companyId: e.companyId, employeeId: e.id, firstName: e.firstName, lastName: e.lastName })))
          .onConflictDoUpdate({
            target: [payfitEmployees.companyId, payfitEmployees.employeeId],
            set: { firstName: sql`excluded.first_name`, lastName: sql`excluded.last_name` },
          })
      }
      const contracts = [...new Map(data.contracts.filter((c) => known(c.companyId)).map((c) => [`${c.companyId}|${c.id}`, c])).values()]
      for (const part of chunks(contracts)) {
        await tx
          .insert(payfitContracts)
          .values(
            part.map((c) => ({
              companyId: c.companyId,
              payfitContractId: c.id,
              employeeId: c.employeeId,
              startDate: c.startDate,
              endDate: c.endDate ?? null,
              status: c.status && CONTRACT_STATUSES.includes(c.status) ? c.status : 'ACTIVE',
            })),
          )
          .onConflictDoUpdate({
            target: [payfitContracts.companyId, payfitContracts.payfitContractId],
            set: { employeeId: sql`excluded.employee_id`, startDate: sql`excluded.start_date`, endDate: sql`excluded.end_date`, status: sql`excluded.status` },
          })
      }
      const observed = [...new Map(data.absences.filter((a) => known(a.companyId)).map((a) => [`${a.companyId}|${a.id}`, a])).values()]
      for (const part of chunks(observed)) {
        await tx
          .insert(payfitAbsences)
          .values(
            part.map((a) => ({
              companyId: a.companyId,
              payfitAbsenceId: a.id,
              contractId: a.contractId,
              typeCode: a.typeCode,
              status: a.status,
              startDate: a.startDate,
              startHalf: a.startHalf,
              startMoment: a.startMoment ?? null,
              endDate: a.endDate,
              endHalf: a.endHalf,
              endMoment: a.endMoment ?? null,
              observedAt: readAt,
            })),
          )
          .onConflictDoUpdate({
            target: [payfitAbsences.companyId, payfitAbsences.payfitAbsenceId],
            set: {
              contractId: sql`excluded.contract_id`,
              typeCode: sql`excluded.type_code`,
              status: sql`excluded.status`,
              startDate: sql`excluded.start_date`,
              startHalf: sql`excluded.start_half`,
              startMoment: sql`excluded.start_moment`,
              endDate: sql`excluded.end_date`,
              endHalf: sql`excluded.end_half`,
              endMoment: sql`excluded.end_moment`,
              observedAt: sql`excluded.observed_at`,
            },
          })
      }

      // coverage per company (rule-evp-sources-partial-failure)
      const everyCompany = (await tx.select({ id: payfitCompanies.id, siret: payfitCompanies.siret }).from(payfitCompanies)).map((c) => c)
      const exhaustiveIds: string[] = []
      if (!real) {
        // the fixtures: the global flag holds for every company known
        for (const company of everyCompany) {
          if (data.exhaustive) exhaustiveIds.push(company.id)
          await tx
            .insert(payfitCoverage)
            .values({ companyId: company.id, reachable: true, windowStart: window.from, windowEnd: window.to, exhaustive: data.exhaustive, observedAt: readAt })
            .onConflictDoUpdate({
              target: payfitCoverage.companyId,
              set: { reachable: true, windowStart: window.from, windowEnd: window.to, exhaustive: data.exhaustive, observedAt: readAt },
            })
        }
      } else {
        for (const result of data.companyResults!) {
          const ids = result.companyId ? [result.companyId] : everyCompany.filter((c) => c.siret === result.siret).map((c) => c.id)
          for (const id of ids) {
            if (result.reachable && result.exhaustive) exhaustiveIds.push(id)
            await tx
              .insert(payfitCoverage)
              .values({ companyId: id, reachable: result.reachable, windowStart: window.from, windowEnd: window.to, exhaustive: result.reachable && result.exhaustive, observedAt: readAt })
              .onConflictDoUpdate({
                target: payfitCoverage.companyId,
                set: result.reachable
                  ? { reachable: true, windowStart: window.from, windowEnd: window.to, exhaustive: result.exhaustive, observedAt: readAt }
                  : { reachable: false, exhaustive: false },
              })
          }
        }
      }
      if (exhaustiveIds.length > 0) {
        await tx.delete(payfitAbsences).where(and(inArray(payfitAbsences.companyId, exhaustiveIds), lt(payfitAbsences.observedAt, readAt)))
      }

      const duplicated = await tx
        .select({ siret: payfitCompanies.siret, n: sql<number>`count(*)::int`, names: sql<string>`string_agg(${payfitCompanies.name}, ', ' order by ${payfitCompanies.name})` })
        .from(payfitCompanies)
        .groupBy(payfitCompanies.siret)
        .having(sql`count(*) > 1`)
      for (const company of duplicated) {
        anomalies.push({
          type: 'SIRET_DUPLICATE',
          label: 'SIRET partagé par plusieurs sociétés',
          subject: company.names,
          detail: `${company.n} sociétés PayFit portent le même SIRET : aucun contrat n’est proposé pour la crèche concernée.`,
        })
      }

      // rule-evp-payfit-scope-every-read, rule-evp-payfit-scope-introspection-failed, rule-evp-company-named-in-anomalies: one
      // anomaly per company and per reading, whatever the driver (the fixtures have no `companyResults`); never a failure of the reading
      if (data.scopeChecks?.some((check) => check.status !== 'ok')) {
        const recorded = new Map<string, string>()
        for (const company of await tx.select({ siret: payfitCompanies.siret, name: payfitCompanies.name }).from(payfitCompanies).orderBy(payfitCompanies.name)) {
          if (!recorded.has(company.siret)) recorded.set(company.siret, company.name)
        }
        const sent = new Map(data.companies.map((c) => [c.siret, c.name]))
        for (const check of data.scopeChecks) {
          if (check.status === 'ok') continue
          const subject = companyLabel(sent.get(check.siret) ?? recorded.get(check.siret), check.siret)
          anomalies.push(
            check.status === 'scope-missing'
              ? { type: 'payfit_scope_missing', label: 'Portée PayFit manquante', subject, detail: PAYFIT_SCOPE_MISSING_DETAIL }
              : {
                  type: 'payfit_introspection_failed',
                  label: 'Introspection de la clé PayFit en échec',
                  subject,
                  detail: `La portée de la clé n'a pas pu être vérifiée : ${check.cause ?? 'PayFit injoignable'}.`,
                },
          )
        }
      }

      if (real) {
        // rule-evp-payfit-companies-without-creche
        const crecheSirets = new Set((await tx.select({ siret: creches.siret }).from(creches)).map((c) => c.siret))
        for (const company of data.companies) {
          if (!crecheSirets.has(company.siret)) {
            anomalies.push({
              type: 'payfit_company_without_creche',
              label: 'Société sans crèche (SIRET)',
              subject: company.name,
              detail: 'Aucune crèche du référentiel ne porte le SIRET de cette société PayFit.',
            })
          }
        }
        // rule-evp-sources-partial-failure, rule-evp-payfit-siret-check: a company that failed is named by its SIRET
        for (const result of data.companyResults!) {
          if (!result.failure) continue
          if (result.failure.mismatch) {
            anomalies.push({
              type: 'payfit_siret_mismatch',
              label: 'SIRET différent de la clé',
              subject: result.siret,
              detail: 'Le SIRET de la société PayFit diffère de celui de la clé : la société n’est pas lue.',
            })
          }
          anomalies.push({ type: 'payfit_company_unreachable', label: 'Société inaccessible', subject: result.siret, detail: result.failure.detail })
        }
      }

      if (mapping) {
        // rule-evp-payfit-type-unmapped: one anomaly per code, with the number of absences
        const unmapped = new Map<string, number>()
        for (const absence of observed) if (!mapping.typeOf(absence.typeCode)) unmapped.set(absence.typeCode, (unmapped.get(absence.typeCode) ?? 0) + 1)
        for (const [code, count] of [...unmapped].sort(([a], [b]) => a.localeCompare(b))) {
          anomalies.push({
            type: 'payfit_type_unmapped',
            label: "Type d'absence PayFit non configuré",
            subject: code,
            detail: `${count} absence(s) de ce type ne peuvent confirmer aucun dossier : ajouter le code à la correspondance des types.`,
          })
        }
      }
      // rule-evp-payfit-half-day-mapping: a `moment` that cannot be read
      const unreadable = observed.filter((a) => a.startHalf === null || a.endHalf === null).length
      if (unreadable > 0) {
        anomalies.push({
          type: 'payfit_half_day_unreadable',
          label: 'Demi-journée PayFit non interprétable',
          subject: 'Absences PayFit',
          detail: `${unreadable} absence(s) ont une demi-journée que l’on ne sait pas lire : elles ne confirment aucun dossier.`,
        })
      }
      await replaceAnomalies(tx, 'payfit', anomalies)
    })
    return {
      volumes: [
        { label: 'Sociétés', count: data.companies.length },
        { label: 'Collaboratrices', count: data.employees.length },
        { label: 'Contrats', count: data.contracts.length },
        { label: 'Absences', count: data.absences.length },
      ],
      anomalies,
      partial: real && data.companyResults!.some((r) => !r.reachable),
    }
  }

  /**
   * rule-evp-sources-aqoona, rule-evp-link-nir-only, rule-evp-link-network-wide, rule-evp-aqoona-nir-transient-key: the slots of
   * the window replace the previous ones of the addresses that answered (those of an address that failed are kept,
   * rule-evp-sources-partial-failure). A row is linked to a collaborator of PayFit by its NIR alone, searched in the whole
   * network and never by first and last name; the crèche does not take part in it (rule-evp-link-unknown-creche). One pass
   * decides, for each row, the link or the cause (rule-evp-link-causes). Only the result is kept: the NIR is read from the
   * row and from the table of the network, in this method, and is never stored, logged or reported
   * (rule-evp-aqoona-nir-never-stored).
   */
  async applyAqoona(data: AqoonaData, window: Window, listNirs: () => Promise<PayfitNirs>): Promise<ReadResult> {
    const anomalies: Anomaly[] = []
    const mismatches: Array<typeof aqoonaMismatches.$inferInsert> = []
    // rule-evp-aqoona-etab-unique: only the verified crèches of the referential
    const known = await this.db.select({ code: creches.code, name: creches.name, siret: creches.siret }).from(creches).where(eq(creches.verified, true))
    const byEstablishment = new Map<string, typeof known>()
    for (const creche of known) {
      const key = establishmentKey(creche.name)
      byEstablishment.set(key, [...(byEstablishment.get(key) ?? []), creche])
    }
    const companies = await this.db
      .select({ id: payfitCompanies.id, siret: payfitCompanies.siret, name: payfitCompanies.name })
      .from(payfitCompanies)
      .orderBy(payfitCompanies.name, payfitCompanies.id)
    const companiesBySiret = new Map<string, string[]>()
    for (const company of companies) companiesBySiret.set(company.siret, [...(companiesBySiret.get(company.siret) ?? []), company.id])
    const nameOfSiret = new Map<string, string>()
    for (const company of companies) if (!nameOfSiret.has(company.siret)) nameOfSiret.set(company.siret, company.name)
    // the collaborators recorded by a full reading of PayFit (rule-evp-link-employee-not-read), « Prénom NOM » for the display
    const holderKey = (holder: NirHolder): string => `${holder.companyId}|${holder.employeeId}`
    const displayed = new Map<string, string>()
    const employees = await this.db
      .select({ companyId: payfitEmployees.companyId, employeeId: payfitEmployees.employeeId, firstName: payfitEmployees.firstName, lastName: payfitEmployees.lastName })
      .from(payfitEmployees)
    for (const e of employees) displayed.set(holderKey(e), cleanText(`${e.firstName} ${e.lastName}`))

    const reported = new Set<string>()
    const report = (anomaly: Anomaly, key: string) => {
      if (reported.has(key)) return
      reported.add(key)
      anomalies.push(anomaly)
    }
    const establishmentOf = (name: unknown): (typeof known)[number] | null => {
      const candidates = byEstablishment.get(establishmentKey(String(name ?? ''))) ?? []
      return candidates.length === 1 ? candidates[0] : null
    }
    const inWindow = data.rows.filter((row) => row.day >= window.from && row.day <= window.to)

    // rule-evp-nir-key-invalid-unused: a NIR of a row is used only when its check key is right (the value is never kept)
    const usableNir = (row: AqoonaData['rows'][number]): string | null => {
      const nir = canonicalNir(row.matricule)
      return nir !== null && nirKeyIsValid(nir) ? nir : null
    }

    // rule-evp-link-network-read: PayFit is asked, for the whole network, as soon as one row has a NIR of right key
    let network: PayfitNirs = new Map()
    const asked = inWindow.some((row) => usableNir(row) !== null)
    if (asked) {
      try {
        network = await listNirs()
      } catch {
        // rule-evp-aqoona-nir-unavailable: never a failure of the reading; an unreadable network
        network = new Map()
      }
    }
    // rule-evp-aqoona-nir-unavailable: a company that cannot be read (scope, introspection, collaborators) or that has no key at all
    const unreadable = new Map<string, 'scope-missing' | 'unavailable'>()
    if (asked) {
      for (const [siret, result] of network) if (result.status !== 'ok') unreadable.set(siret, result.status)
      // a company PayFit has recorded but that has no key in the network; an empty network is unreadable as a whole, not company by company
      if (network.size > 0) for (const siret of nameOfSiret.keys()) if (!network.has(siret)) unreadable.set(siret, 'unavailable')
    }
    // rule-evp-link-incomplete-read (decision D-0021): a company that cannot be read, or no network at all
    const incomplete = asked && (network.size === 0 || unreadable.size > 0)
    // rule-evp-aqoona-nir-unavailable, rule-evp-company-named-in-anomalies: only the companies PayFit has recorded are named
    for (const [siret, status] of [...unreadable].sort(([a], [b]) => a.localeCompare(b))) {
      if (!nameOfSiret.has(siret)) continue
      anomalies.push({
        type: 'aqoona_nir_unavailable',
        label: 'Rapprochement par NIR indisponible',
        subject: companyLabel(nameOfSiret.get(siret), siret),
        detail: status === 'scope-missing' ? AQOONA_SCOPE_MISSING_DETAIL : AQOONA_NIR_UNAVAILABLE_DETAIL,
      })
    }
    // rule-evp-link-network-wide: the table of the whole network; a NIR delivered with 13 characters by PayFit matches the 13 first
    const table: NirTable = new Map()
    for (const [siret, result] of [...network].sort(([a], [b]) => a.localeCompare(b))) {
      if (result.status !== 'ok') continue
      for (const [nir, holders] of result.table) {
        const held = table.get(nir) ?? []
        for (const holder of holders) if (!held.some((h) => holderKey(h) === holderKey(holder))) held.push(holder)
        table.set(nir, held)
      }
      // rule-evp-nir-key-payfit-anomaly-source (decision D-0018): the NIR of PayFit are read here only, for every company read
      const named = result.invalid.map((holder) => ({ holder, subject: displayed.get(holderKey(holder)) || `Collaboratrice ${cleanText(holder.employeeId)}` }))
      for (const { holder, subject } of named.sort((a, b) => a.subject.localeCompare(b.subject))) {
        report(
          {
            type: 'payfit_nir_key_invalid',
            label: 'Clé de NIR PayFit incorrecte',
            subject: subject.slice(0, 100),
            detail: `Société ${siret} : la clé de contrôle du NIR est incorrecte, ce NIR n'est pas utilisé.`,
          },
          `payfit-key|${siret}|${holderKey(holder)}`,
        )
      }
    }
    /** rule-evp-link-nir-only: the collaborators of the network that carry this NIR, found live in PayFit. */
    const carriers = (nir: string): NirHolder[] => {
      const out: NirHolder[] = []
      for (const holder of [...(table.get(nir) ?? []), ...(table.get(nir.slice(0, 13)) ?? [])]) {
        if (!out.some((h) => holderKey(h) === holderKey(holder))) out.push(holder)
      }
      return out
    }

    // rule-evp-nir-key-anomaly-grain: one anomaly per distinct person, with the number of slots
    const wrongKeys = new Map<string, { subject: string; slots: number }>()
    // rule-evp-link-no-identity: the rows without name and without NIR, counted per address
    const withoutIdentity = new Map<string, number>()

    interface Slot {
      insert: typeof aqoonaPlannings.$inferInsert
      typeLabel: string | null
      untyped: boolean
    }
    // rule-evp-aqoona-dedupe: exactly the columns of the unique index, `null` equal to `null`
    const slots = new Map<string, Slot>()
    // rule-evp-aqoona-text-normalised: a person is known by her normalised name; the first spelling read is the one kept
    const spellings = new Map<string, string>()
    for (const row of inWindow) {
      const spelled = `${cleanText(row.firstName)} ${cleanText(row.lastName)}`.trim()
      const person = spellings.get(normalise(spelled)) ?? spelled
      if (spelled && !spellings.has(normalise(spelled))) spellings.set(normalise(spelled), spelled)
      const crecheName = cleanText(row.crecheName)
      const addressLabel = row.addressLabel ?? null
      const rawNir = canonicalNir(row.matricule)
      const hasNirValue = row.matricule !== null && row.matricule !== undefined && String(row.matricule).trim() !== ''

      // rule-evp-link-unknown-creche (decision D-0022): the crèche is known as soon as the establishment is unique; the link never depends on it
      const creche = establishmentOf(row.crecheName)
      const crecheCode = creche?.code ?? null
      const crecheCompanies = creche ? (companiesBySiret.get(creche.siret) ?? []) : []
      const companyId = crecheCompanies.length === 1 ? crecheCompanies[0] : null

      // rule-evp-link-causes: absent or unreadable, wrong key, ambiguous, incomplete read, unknown (in this order)
      let linked: NirHolder | null = null
      let cause: UnlinkedCause | null = null
      const noIdentity = !person && !hasNirValue
      if (!noIdentity) {
        if (rawNir === null) cause = 'NIR_ABSENT'
        else if (!nirKeyIsValid(rawNir)) cause = 'NIR_KEY_INVALID'
        else {
          const found = carriers(rawNir)
          if (found.length > 1) cause = 'NIR_AMBIGUOUS'
          // rule-evp-link-employee-not-read (decision D-0024): a collaborator PayFit has no record of yet is not linked
          else if (found.length === 1) {
            if (displayed.has(holderKey(found[0]))) linked = found[0]
            else cause = 'PAYFIT_INCOMPLETE'
          } else cause = incomplete ? 'PAYFIT_INCOMPLETE' : 'NIR_UNKNOWN'
        }
      }

      // rule-evp-aqoona-person-ref: « Prénom NOM », never the registration number
      const personRef = (linked ? displayed.get(holderKey(linked)) : null) || person || 'Personne non nommée'

      // rule-evp-aqoona-slot-type-normalised
      const slotType = normaliseSlotType(row.type, data.slotTypes)
      const insert: typeof aqoonaPlannings.$inferInsert = {
        personRef,
        crecheCode,
        companyId,
        employeeCompanyId: linked?.companyId ?? null,
        employeeId: linked?.employeeId ?? null,
        day: row.day,
        startTime: row.start,
        endTime: row.end,
        slotType: slotType.type,
        addressLabel,
        // rule-evp-matching-method-first-row: a deduplicated slot keeps the values of the first row kept; only the mode is stored
        matchMethod: linked ? 'NIR' : 'AUCUN',
        unlinkedCause: cause,
        // rule-evp-unlinked-list: the establishment as read, kept for an unlinked slot whose crèche is unknown (a name, never a NIR)
        crecheLabel: cause && !creche ? crecheName.slice(0, 200) || null : null,
      }
      const key = JSON.stringify([personRef, crecheCode, companyId, row.day, row.start, row.end, slotType.type])
      if (noIdentity) withoutIdentity.set(addressLabel ?? 'Aqoona', (withoutIdentity.get(addressLabel ?? 'Aqoona') ?? 0) + 1)
      if (slots.has(key)) continue
      slots.set(key, { insert, typeLabel: slotType.label, untyped: slotType.type === 'NON_PRECISE' && row.type !== undefined })
      // rule-evp-nir-key-anomaly-without-company (decision D-0017): whatever the establishment, the row is reported
      if (rawNir !== null && !nirKeyIsValid(rawNir)) {
        const wrong = wrongKeys.get(normalise(person)) ?? { subject: (person || 'Personne non nommée').slice(0, 100), slots: 0 }
        wrong.slots++
        wrongKeys.set(normalise(person), wrong)
      }
      if (cause) {
        // rule-evp-link-unusable-nir: the cause, in words, and the crèche as read; never a NIR
        mismatches.push({ personRef, crecheName, reason: UNLINKED_CAUSE_LABELS[cause], day: row.day, addressLabel })
        report(
          { type: 'PLANNING_UNMATCHED', label: 'Planning non rattaché', subject: person || 'Personne non nommée', detail: `${UNLINKED_CAUSE_LABELS[cause]} (crèche lue : ${crecheName}).` },
          // grain: one anomaly per person, crèche read and cause, never per slot
          JSON.stringify(['unmatched', normalise(person), normalise(crecheName), cause]),
        )
      }
    }
    // the table of the network lives for this reading only (rule-evp-link-network-read)
    table.clear()
    network = new Map()
    for (const [, wrong] of [...wrongKeys].sort(([a], [b]) => a.localeCompare(b))) {
      anomalies.push({
        type: 'aqoona_nir_key_invalid',
        label: 'Clé de NIR Aqoona incorrecte',
        subject: wrong.subject,
        detail: `${wrong.slots} créneau(x) : la clé de contrôle du NIR est incorrecte, la ligne n'est pas rattachée.`,
      })
    }
    for (const [label, count] of [...withoutIdentity].sort(([a], [b]) => a.localeCompare(b))) {
      anomalies.push({ type: 'aqoona_no_identity', label: 'Ligne Aqoona sans nom ni NIR', subject: label, detail: `${count} ligne(s) sans nom ni NIR.` })
    }
    const plannings = [...slots.values()].map((slot) => slot.insert)

    // rule-evp-aqoona-slot-type-anomalies: one per distinct unknown type, one per address for the rows without type
    const unknownTypes = new Map<string, number>()
    const untyped = new Map<string, number>()
    for (const slot of slots.values()) {
      if (slot.typeLabel !== null) unknownTypes.set(slot.typeLabel, (unknownTypes.get(slot.typeLabel) ?? 0) + 1)
      if (slot.untyped) untyped.set(slot.insert.addressLabel ?? 'Aqoona', (untyped.get(slot.insert.addressLabel ?? 'Aqoona') ?? 0) + 1)
    }
    for (const [label, count] of [...unknownTypes].sort(([a], [b]) => a.localeCompare(b))) {
      anomalies.push({
        type: 'aqoona_slot_type_unknown',
        label: 'Type de créneau Aqoona inconnu',
        subject: label,
        detail: `${count} créneau(x) rangé(s) en « autre »`,
      })
    }
    for (const [label, count] of [...untyped].sort(([a], [b]) => a.localeCompare(b))) {
      anomalies.push({ type: 'aqoona_slot_type_missing', label: 'Créneau Aqoona sans type', subject: label, detail: `${count} créneau(x) sans type` })
    }

    // rule-evp-aqoona-unexpected-format (decision D-0004): the unusable records are counted, one anomaly per address
    for (const address of data.addresses) {
      if (address.ok && address.unusable > 0) {
        anomalies.push({
          type: 'aqoona_unusable_row',
          label: 'Ligne Aqoona inexploitable',
          subject: address.label,
          detail: `${address.unusable} ligne(s) écartée(s) : crèche, jour ou heure inexploitable.`,
        })
      }
    }
    // rule-evp-sources-partial-failure: an address that failed keeps its plannings and is reported
    for (const address of data.addresses) {
      if (!address.ok) {
        anomalies.push({
          type: 'aqoona_address_unreachable',
          label: 'Adresse Aqoona inaccessible',
          subject: address.label,
          detail: address.failure?.detail ?? 'Adresse Aqoona inaccessible',
        })
      }
    }

    const answered = data.addresses.filter((a) => a.ok).map((a) => a.label)
    const replaceAll = data.addresses.length === 0
    await this.db.transaction(async (tx) => {
      const scope = (column: typeof aqoonaPlannings.addressLabel | typeof aqoonaMismatches.addressLabel) =>
        replaceAll
          ? undefined
          : answered.length === 0
            ? sql`${column} is null`
            : sql`(${column} is null or ${column} in (${sql.join(answered.map((label) => sql`${label}`), sql`, `)}))`
      await tx.delete(aqoonaPlannings).where(scope(aqoonaPlannings.addressLabel))
      await tx.delete(aqoonaMismatches).where(scope(aqoonaMismatches.addressLabel))
      // the unique index is the belt: it never refuses a row that the memory kept, but a slot kept from an address that failed may equal one
      for (const part of chunks(plannings)) await tx.insert(aqoonaPlannings).values(part).onConflictDoNothing()
      for (const part of chunks(mismatches)) await tx.insert(aqoonaMismatches).values(part)
      await replaceAnomalies(tx, 'aqoona', anomalies)
    })
    // rule-evp-link-person-both-states: « Plannings rattachés » and « Rapprochés par NIR » are the same figure
    const linkedCount = plannings.filter((p) => p.employeeId).length
    return {
      volumes: [
        { label: 'Plannings lus', count: plannings.length },
        { label: 'Plannings rattachés', count: linkedCount },
        { label: 'Rapprochés par NIR', count: linkedCount },
      ],
      anomalies,
      partial: data.addresses.some((a) => !a.ok),
    }
  }
}
