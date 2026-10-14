import { createHash } from 'node:crypto'
import { z } from 'zod'
import { evpConfig } from '../../evp-core/evp-config'
import { registerSecret } from '../../evp-core/redact-secrets'
import { halfDays } from '../payfit-half-days'
import { SourceError } from '../source-error'
import { NIR_SCOPE, nirKeyIsValid, payfitNirKey } from '../nir'
import { addHolder } from '../source-connectors'
import type { NirHolder, NirTable, PayfitCompanyResult, PayfitData, PayfitNirResult, PayfitNirs, PayfitScopeCheck, Window } from '../source-connectors'
import { parseJson, SourceHttp } from './http-client'

/**
 * Field of a collaborator that carries the social security number (PayFit scope « Social security number »). Its exact
 * name in the real answer is to be confirmed at the first real reading; this is the only place that knows it.
 */
export const PAYFIT_NIR_FIELD = 'socialSecurityNumber'

const PAGE_SIZE = 50
/** rule-evp-payfit-pagination: a cyclic token must not loop for ever. */
const MAX_PAGES = 1000

const keysSchema = z
  .array(z.object({ siret: z.string().regex(/^\d{14}$/), apiKey: z.string().min(1).max(500) }))
  .min(1)
  .max(100)
export type PayfitKeyEntry = z.infer<typeof keysSchema>[number]

/** rule-evp-payfit-bearer: one key per company, one entry per SIRET; unreadable → not configured, without quoting it. */
export function parsePayfitKeys(raw: string | undefined): PayfitKeyEntry[] {
  if (!raw) throw new SourceError('sources.not_configured', "PayFit n'est pas configuré : renseigner PAYFIT_API_KEYS.")
  try {
    return keysSchema.parse(JSON.parse(raw))
  } catch {
    throw new SourceError('sources.not_configured', 'La configuration des clés PayFit est illisible : vérifier PAYFIT_API_KEYS.')
  }
}

export const fingerprintOf = (apiKey: string): string => createHash('sha256').update(apiKey).digest('hex')

/** rule-evp-payfit-errors: the cause of a status that is not usable, in words (no key, no address). */
function statusError(status: number): SourceError {
  if (status === 401) return new SourceError('sources.refused', 'Clé PayFit refusée.', 'Clé refusée pour une société')
  if (status === 403) return new SourceError('sources.refused', 'Portée PayFit manquante.', 'Portée PayFit manquante')
  if (status === 404) return new SourceError('sources.unreachable', 'Société PayFit introuvable.', 'Société introuvable')
  if (status === 429) return new SourceError('sources.rate_limited', 'PayFit limite le débit des appels : réessayer plus tard.', 'Limite de débit PayFit')
  if (status === 400) return new SourceError('sources.unexpected_format', 'PayFit a refusé la requête.', 'Requête refusée par PayFit')
  return new SourceError('sources.unreachable', 'PayFit est injoignable.', 'PayFit injoignable')
}
const unexpected = (): SourceError => new SourceError('sources.unexpected_format', 'Réponse PayFit inattendue.', 'Réponse inattendue')

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null)
const day = (value: unknown): string | null => {
  const v = typeof value === 'string' ? /^(\d{4}-\d{2}-\d{2})/.exec(value)?.[1] : undefined
  return v ?? null
}

/**
 * rule-evp-payfit-scope-format: `scope` of the introspection is a string of scopes separated by spaces (OAuth 2.0), an array
 * of strings is accepted too; the required scope is compared exactly. Absent, empty or without it: missing.
 */
export function hasNirScope(body: unknown): boolean {
  const scope = (body as { scope?: unknown } | null)?.scope
  const scopes = typeof scope === 'string' ? scope.split(/\s+/) : Array.isArray(scope) ? scope.filter((item): item is string => typeof item === 'string') : []
  return scopes.includes(NIR_SCOPE)
}

/**
 * rule-evp-payfit-scope-introspection-failed: the cause of an introspection that failed, in words (PayFit unreachable, key
 * refused, rate limit, inactive key, unexpected answer). Never the key, the address or the answer of PayFit.
 */
function introspectionCause(error: SourceError): string {
  if (error.code === 'sources.refused') return 'clé refusée'
  if (error.code === 'sources.rate_limited') return 'limite de débit'
  if (error.code === 'sources.unexpected_format') return 'réponse inattendue'
  return 'PayFit injoignable'
}

export type CompanyIdLookup = (siret: string, fingerprint: string) => Promise<string | null>

interface CompanyRead {
  company: { id: string; siret: string; name: string; fingerprint: string }
  employees: PayfitData['employees']
  contracts: PayfitData['contracts']
  absences: PayfitData['absences']
}

class CompanyFailure extends Error {
  constructor(
    readonly error: SourceError,
    readonly siret: string,
    readonly companyId: string | null,
    readonly mismatch: boolean,
  ) {
    super(error.message)
  }
}

/**
 * rule-evp-payfit-*: reads, company by company, the company, its collaborators, its contracts and its absences from
 * the partner API of PayFit. Only `GET` (and the introspection `POST` of a key); no write, no `time:write`
 * (rule-evp-payfit-scopes: the scopes are attached to the key, the code asks for none).
 */
export class PayfitClient {
  constructor(private readonly http = new SourceHttp()) {}

  missingConfiguration(): string[] {
    return evpConfig().sources.payfit.apiKeysRaw ? [] : ['PAYFIT_API_KEYS']
  }

  async read(window: Window, lookup: CompanyIdLookup): Promise<PayfitData> {
    const entries = parsePayfitKeys(evpConfig().sources.payfit.apiKeysRaw)
    const reads: CompanyRead[] = []
    const results: PayfitCompanyResult[] = []
    const failures: CompanyFailure[] = []
    const scopeChecks: PayfitScopeCheck[] = []
    for (const entry of entries) {
      registerSecret(entry.apiKey)
      try {
        const read = await this.readCompany(entry, window, lookup, (check) => scopeChecks.push(check))
        reads.push(read)
        results.push({ siret: entry.siret, companyId: read.company.id, reachable: true, exhaustive: true })
      } catch (error) {
        const failure =
          error instanceof CompanyFailure ? error : new CompanyFailure(error instanceof SourceError ? error : unexpected(), entry.siret, null, false)
        failures.push(failure)
        results.push({
          siret: entry.siret,
          companyId: failure.companyId,
          reachable: false,
          exhaustive: false,
          failure: { code: failure.error.code, detail: failure.error.detail, mismatch: failure.mismatch },
        })
      }
    }
    // rule-evp-sources-partial-failure: every company failed → the whole reading fails, nothing is copied
    if (reads.length === 0) throw failures[0].error
    return {
      companies: reads.map((r) => r.company),
      employees: reads.flatMap((r) => r.employees),
      contracts: reads.flatMap((r) => r.contracts),
      absences: reads.flatMap((r) => r.absences),
      exhaustive: failures.length === 0,
      companyResults: results,
      scopeChecks,
    }
  }

  /**
   * The request context of one key, shared by the full reading and by the reading of the NIR: headers, `GET` with the
   * statuses translated, and the identifier of the company (rule-evp-payfit-company-id: introspection once per key, the
   * identifier is kept with the fingerprint of the key).
   */
  private context(entry: PayfitKeyEntry, lookup: CompanyIdLookup) {
    const { payfit } = evpConfig().sources
    const fingerprint = fingerprintOf(entry.apiKey)
    const request = { headers: { authorization: `Bearer ${entry.apiKey}`, accept: 'application/json' }, retryDelayMs: payfit.retryDelayMs, unreachable: 'PayFit est injoignable.' }
    const get = async (path: string, query: Record<string, string> = {}): Promise<unknown> => {
      const url = `${payfit.baseUrl}${path}${Object.keys(query).length ? `?${new URLSearchParams(query).toString()}` : ''}`
      const answer = await this.http.get(url, request)
      if (answer.status < 200 || answer.status >= 300) throw statusError(answer.status)
      return parseJson(answer.text, 'Réponse PayFit inattendue.')
    }
    /**
     * rule-evp-payfit-scope-one-per-key: the one introspection `POST` of a key in a reading, made at most once and parsed once,
     * for the identifier of the company and for the scopes. Only `company_id`, `active` and `scope` are ever read from it.
     */
    let introspection: Promise<Record<string, unknown>> | null = null
    const introspect = (): Promise<Record<string, unknown>> => {
      introspection ??= (async () => {
        const answer = await this.http.postJson(payfit.introspectUrl, { token: entry.apiKey }, request)
        if (answer.status < 200 || answer.status >= 300) throw statusError(answer.status)
        const body = parseJson(answer.text, 'Réponse PayFit inattendue.')
        if (typeof body !== 'object' || body === null || Array.isArray(body)) throw unexpected()
        return body as Record<string, unknown>
      })()
      return introspection
    }
    return { fingerprint, get, introspect, lookupId: () => lookup(entry.siret, fingerprint) }
  }

  /**
   * rule-evp-aqoona-nir-transient-key, rule-evp-link-network-read, rule-evp-aqoona-nir-unavailable: for every key of
   * `PAYFIT_API_KEYS` (the whole network), `GET` of the collaborators of the company and nothing else; the answer is a table in
   * memory (NIR → distinct collaborators) that the caller drops at the end of its reading. Nothing is written, no value is
   * logged or put in an error. rule-evp-payfit-scope-checked: the introspection of the key comes first and its scopes are read
   * before any collaborator (rule-evp-payfit-scope-every-read: never from the cache of identifiers). Per SIRET: `ok`,
   * `scope-missing` (no `GET` of the collaborators) or `unavailable` (inactive, 401/403/429/5xx, timeout, unexpected format).
   * No key configured (or unreadable): an empty network, which the caller treats as unreadable.
   */
  async readNirs(): Promise<PayfitNirs> {
    const out: PayfitNirs = new Map()
    let entries: PayfitKeyEntry[] = []
    try {
      entries = parsePayfitKeys(evpConfig().sources.payfit.apiKeysRaw)
    } catch {
      return out
    }
    for (const entry of entries) {
      registerSecret(entry.apiKey)
      out.set(entry.siret, await this.readCompanyNirs(entry))
    }
    return out
  }

  private async readCompanyNirs(entry: PayfitKeyEntry): Promise<PayfitNirResult> {
    try {
      // rule-evp-payfit-scope-every-read: the cache of identifiers is not consulted here
      const { get, introspect } = this.context(entry, async () => null)
      const body = await introspect()
      const id = text(body.company_id)
      if (body.active === false || !id) return { status: 'unavailable' }
      if (!hasNirScope(body)) return { status: 'scope-missing' }
      const table: NirTable = new Map()
      const invalid: NirHolder[] = []
      for (const item of await this.pages(get, `/companies/${encodeURIComponent(id)}/collaborators`, 'collaborators', {})) {
        const record = (item ?? {}) as Record<string, unknown>
        const employeeId = text(record.id)
        const key = employeeId ? payfitNirKey(record[PAYFIT_NIR_FIELD]) : null
        if (!employeeId || !key) continue
        const holder = { companyId: id, employeeId }
        // rule-evp-nir-key-invalid-unused: a wrong key leaves the table; the identifier is kept, never the value
        if (key.length === 15 && !nirKeyIsValid(key)) {
          invalid.push(holder)
          continue
        }
        addHolder(table, key, holder)
      }
      return { status: 'ok', table, invalid }
    } catch {
      return { status: 'unavailable' }
    }
  }

  private async readCompany(
    entry: PayfitKeyEntry,
    window: Window,
    lookup: CompanyIdLookup,
    onScope: (check: PayfitScopeCheck) => void,
  ): Promise<CompanyRead> {
    const { fingerprint, get, introspect, lookupId } = this.context(entry, lookup)
    const fail = (error: SourceError, companyId: string | null, mismatch = false): never => {
      throw new CompanyFailure(error, entry.siret, companyId, mismatch)
    }

    // rule-evp-payfit-scope-every-read, rule-evp-payfit-scope-one-per-key: one introspection per key and per reading, even when
    // the identifier is cached (the identifier is cached, the scope never). Its failure does not stop the reading of the company.
    let body: Record<string, unknown> | null = null
    let introspectionError: SourceError | null = null
    try {
      body = await introspect()
    } catch (error) {
      introspectionError = error instanceof SourceError ? error : unexpected()
    }
    if (introspectionError) onScope({ siret: entry.siret, status: 'failed', cause: introspectionCause(introspectionError) })
    else if (body?.active === false) onScope({ siret: entry.siret, status: 'failed', cause: 'clé inactive' })
    else onScope({ siret: entry.siret, status: hasNirScope(body) ? 'ok' : 'scope-missing' })

    // rule-evp-payfit-company-id: the cached identifier first, else the one of the introspection
    const id = (await lookupId()) ?? text(body?.company_id)
    if (!id) return fail(introspectionError ?? unexpected(), null)
    const base = `/companies/${encodeURIComponent(id)}`
    try {
      // rule-evp-payfit-company, rule-evp-payfit-siret-check: the SIRET is `identificationNumber`, never `siret`
      const company = (await get(`/companies-fr/${encodeURIComponent(id)}`)) as { identificationNumber?: unknown; name?: unknown } | null
      const identification = text(company?.identificationNumber)?.replace(/\s/g, '')
      if (!identification) throw unexpected()
      if (identification !== entry.siret) {
        return fail(new SourceError('sources.unexpected_format', 'Le SIRET de la société PayFit diffère de celui de la clé.', 'SIRET différent de la clé'), id, true)
      }
      const name = text(company?.name) ?? entry.siret

      const employees = (await this.pages(get, `${base}/collaborators`, 'collaborators', {})).map((item) => {
        const record = item as Record<string, unknown>
        const employeeId = text(record.id)
        if (!employeeId) throw unexpected()
        return { companyId: id, id: employeeId, firstName: text(record.firstName) ?? '', lastName: text(record.lastName) ?? '' }
      })
      const contracts = (await this.pages(get, `${base}/contracts-fr`, 'contracts', {})).map((item) => {
        const record = item as Record<string, unknown>
        const contractId = text(record.contractId)
        const employeeId = text(record.collaboratorId)
        const startDate = day(record.startDate)
        if (!contractId || !employeeId || !startDate) throw unexpected()
        return { companyId: id, id: contractId, employeeId, startDate, endDate: day(record.endDate), status: text(record.status) ?? 'ACTIVE' }
      })
      const absences = (await this.pages(get, `${base}/absences`, 'absences', { status: 'all', beginDate: window.from, endDate: window.to })).map((item) => {
        const record = item as Record<string, any>
        const absenceId = text(record.id)
        const contractId = text(record.contractId)
        const startDate = day(record.startDate?.date)
        const endDate = day(record.endDate?.date)
        const type = text(record.type)
        const status = text(record.status)
        if (!absenceId || !contractId || !startDate || !endDate || !type || !status) throw unexpected()
        const startMoment = text(record.startDate?.moment)
        const endMoment = text(record.endDate?.moment)
        const halves = halfDays(startMoment, endMoment)
        return {
          companyId: id,
          id: absenceId,
          contractId,
          typeCode: type,
          status,
          startDate,
          startHalf: halves?.startHalf ?? null,
          startMoment,
          endDate,
          endHalf: halves?.endHalf ?? null,
          endMoment,
        }
      })
      return { company: { id, siret: entry.siret, name, fingerprint }, employees, contracts, absences }
    } catch (error) {
      if (error instanceof CompanyFailure) throw error
      return fail(error instanceof SourceError ? error : unexpected(), id)
    }
  }

  /** rule-evp-payfit-pagination: `maxResults=50`, then `meta.nextPageToken` until null. */
  private async pages(
    get: (path: string, query?: Record<string, string>) => Promise<unknown>,
    path: string,
    key: string,
    query: Record<string, string>,
  ): Promise<unknown[]> {
    const items: unknown[] = []
    const seen = new Set<string>()
    let token: string | null = null
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = (await get(path, { ...query, maxResults: String(PAGE_SIZE), ...(token ? { nextPageToken: token } : {}) })) as Record<string, any> | null
      const list = body?.[key]
      if (!Array.isArray(list)) throw unexpected()
      items.push(...list)
      const next: unknown = body?.meta?.nextPageToken
      if (next === null || next === undefined) return items
      if (typeof next !== 'string' || next === '' || seen.has(next)) throw unexpected()
      seen.add(next)
      token = next
    }
    throw unexpected()
  }
}
