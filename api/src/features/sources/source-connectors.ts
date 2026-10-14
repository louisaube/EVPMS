import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import type { Database } from '../../platform/database/database.module'
import { evpConfig } from '../evp-core/evp-config'
import { AqoonaClient } from './clients/aqoona.client'
import type { SlotTypeAliases } from './aqoona-slot-types'
import { nirKeyIsValid, payfitNirKey } from './nir'
import { PayfitClient } from './clients/payfit.client'
import { SheetsClient } from './clients/sheets.client'
import type { SourceErrorCode } from './source-error'
import type { ReadableSource } from './sources.schemas'
import { payfitCompanies } from './sources.tables'

export interface SheetsRow {
  name: string
  code: string
  siret: string
  loginEmail?: string
  directriceName?: string
  ros?: Array<{ name: string; email: string }>
}

/** What became of one PayFit company (one key) in a reading (rule-evp-sources-partial-failure). */
export interface PayfitCompanyResult {
  siret: string
  /** null when the identifier of the company could not even be obtained */
  companyId: string | null
  reachable: boolean
  exhaustive: boolean
  failure?: { code: SourceErrorCode; detail: string; mismatch: boolean }
}

export interface PayfitData {
  companies: Array<{ id: string; siret: string; name: string; fingerprint?: string }>
  employees: Array<{ companyId: string; id: string; firstName: string; lastName: string }>
  contracts: Array<{ companyId: string; id: string; employeeId: string; startDate: string; endDate: string | null; status?: string }>
  absences: Array<{
    companyId: string
    id: string
    contractId: string
    typeCode: string
    /** raw status of PayFit (`approved`…) or, with the fixtures, of the first version (`VALIDATED`…) */
    status: string
    startDate: string
    /** null: the `moment` of PayFit cannot be interpreted (rule-evp-payfit-half-day-mapping) */
    startHalf: string | null
    startMoment?: string | null
    endDate: string
    endHalf: string | null
    endMoment?: string | null
  }>
  /** The read covers the whole window for every company: only then can an absence be declared missing. */
  exhaustive: boolean
  /** Per company; absent with the fixtures (every company then takes the global `exhaustive`). */
  companyResults?: PayfitCompanyResult[]
  /** rule-evp-payfit-scope-every-read: what the introspection of each key gave in this reading, filled by both drivers. */
  scopeChecks?: PayfitScopeCheck[]
}

/**
 * rule-evp-payfit-scope-every-read, rule-evp-payfit-scope-introspection-failed: the scope of one key, looked at in one reading.
 * `failed` carries the cause in words (never the key or the address); nothing is guessed about the scope then.
 */
export interface PayfitScopeCheck {
  siret: string
  status: 'ok' | 'scope-missing' | 'failed'
  cause?: string
}

export interface AqoonaRow {
  firstName: string
  lastName: string
  /** Transient: carries a possible NIR for the matching of one reading, never written anywhere (rule-evp-aqoona-nir-never-stored). */
  matricule?: string | null
  crecheName: string
  day: string
  start: string
  end: string
  /** Raw type of the slot; absent when the mapping has no such field, null when the row gives none. */
  type?: string | null
  /** Label (not secret) of the address the slot comes from. */
  addressLabel?: string
}

/** What a reading of Aqoona gives: the slots, the number of unusable records, and the fate of each address. */
export interface AqoonaData {
  rows: AqoonaRow[]
  unusable: number
  /** Aliases of the slot types, from the mapping file (rule-evp-aqoona-slot-type-normalised). */
  slotTypes?: SlotTypeAliases
  addresses: Array<{ label: string; ok: boolean; unusable: number; failure?: { code: SourceErrorCode; detail: string } }>
}

export interface Window {
  from: string
  to: string
}

/** A collaborator of the network: the PayFit company that holds her and her identifier in it. */
export interface NirHolder {
  companyId: string
  employeeId: string
}

/**
 * rule-evp-aqoona-nir-transient-key: NIR (as PayFit delivers them) → distinct collaborators that carry it. Lives in memory
 * for the duration of one Aqoona reading, never copied into a table or a log.
 */
export type NirTable = Map<string, NirHolder[]>

/**
 * rule-evp-link-network-read: by SIRET of the network (one per key); an empty map is a network that cannot be read at all
 * (no key configured, `payfit.json` unreadable).
 */
export type PayfitNirs = Map<string, PayfitNirResult>

/** Adds a collaborator to a table without duplicating her. */
export function addHolder(table: NirTable, nir: string, holder: NirHolder): void {
  const held = table.get(nir) ?? []
  if (!held.some((h) => h.companyId === holder.companyId && h.employeeId === holder.employeeId)) held.push(holder)
  table.set(nir, held)
}

/**
 * rule-evp-payfit-scope-checked: what the reading of the NIR of one company gave. `invalid` lists the collaborators whose NIR
 * has a wrong check key (identifiers only, never the value: rule-evp-nir-key-never-shown).
 */
export type PayfitNirResult = { status: 'ok'; table: NirTable; invalid: NirHolder[] } | { status: 'scope-missing' } | { status: 'unavailable' }

/**
 * rule-evp-sources-readonly: the connectors only READ. Every method is named after a read (`list...`); nothing is ever
 * written to Google Sheets, PayFit, Aqoona or Workspace. Credentials stay on the server side of the connector.
 */
export abstract class SourceConnectors {
  abstract listContacts(): Promise<SheetsRow[]>
  abstract listPayfit(window: Window): Promise<PayfitData>
  abstract listPlannings(window: Window): Promise<AqoonaData>
  /** rule-evp-link-network-read: read only, one result per SIRET of the whole network, writes nothing in the PayFit tables. */
  abstract listPayfitNirs(): Promise<PayfitNirs>

  /** Names of the variables still to set for each source (never a value); empty with the fixtures. */
  configuration(): Record<ReadableSource, string[]> {
    return { sheets: [], payfit: [], aqoona: [] }
  }

  /** Aqoona addresses as shown on the screen (label and masked address). */
  addresses(): Array<{ label: string; masked: string }> {
    return []
  }
}

/**
 * Test double: reads `api/.evp-fixtures-<env>/<source>.json` and appends one `<source>.<method>` line per call to
 * `calls.log`. A fixture holding an `error` simulates a failing source; a missing fixture is an unreachable source.
 */
export class FixtureSourceConnectors extends SourceConnectors {
  constructor(private readonly dir: string) {
    super()
  }

  private log(entry: string): void {
    mkdirSync(this.dir, { recursive: true })
    appendFileSync(join(this.dir, 'calls.log'), `${entry}\n`)
  }

  private load(name: string): Record<string, unknown> {
    const file = join(this.dir, `${name}.json`)
    if (!existsSync(file)) throw new Error('Source unreachable')
    const content = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    if (typeof content.error === 'string') throw new Error('Source failed')
    return content
  }

  async listContacts(): Promise<SheetsRow[]> {
    this.log('sheets.listContacts')
    return (this.load('sheets').rows as SheetsRow[] | undefined) ?? []
  }

  async listPayfit(_window: Window): Promise<PayfitData> {
    this.log('payfit.listCompanies')
    const content = this.load('payfit') as Partial<PayfitData>
    this.log('payfit.listEmployees')
    this.log('payfit.listContracts')
    this.log('payfit.listAbsences')
    return {
      scopeChecks: this.scopeChecks(content as typeof content & { nirScopeMissing?: string[]; introspectionFailed?: string[] }),
      companies: content.companies ?? [],
      employees: content.employees ?? [],
      contracts: content.contracts ?? [],
      absences: content.absences ?? [],
      exhaustive: content.exhaustive === true,
    }
  }

  async listPlannings(_window: Window): Promise<AqoonaData> {
    this.log('aqoona.listPlannings')
    return { rows: (this.load('aqoona').rows as AqoonaRow[] | undefined) ?? [], unusable: 0, addresses: [] }
  }

  /**
   * rule-evp-payfit-scope-every-read, rule-evp-payfit-scope-introspection-failed: a SIRET of `introspectionFailed` fails (and is
   * never also reported without the scope), one of `nirScopeMissing` lacks the scope; the others are fine.
   */
  private scopeChecks(content: { companies?: PayfitData['companies']; nirScopeMissing?: string[]; introspectionFailed?: string[] }): PayfitScopeCheck[] {
    const failed = content.introspectionFailed ?? []
    const missing = content.nirScopeMissing ?? []
    const sirets = [...new Set([...(content.companies ?? []).map((c) => c.siret), ...failed, ...missing])]
    return sirets.map((siret) =>
      failed.includes(siret)
        ? { siret, status: 'failed' as const, cause: 'PayFit injoignable' }
        : { siret, status: missing.includes(siret) ? ('scope-missing' as const) : ('ok' as const) },
    )
  }

  /**
   * rule-evp-aqoona-nir-transient-key (decision D-0010), rule-evp-link-network-read: the optional `nir` of the collaborators of
   * `payfit.json`, read here only, for every company of the file; `nirUnavailable` and `nirScopeMissing` (lists of SIRET)
   * simulate a company that cannot be read. No line in `calls.log`. An unreadable file is an empty network.
   */
  async listPayfitNirs(): Promise<PayfitNirs> {
    const out: PayfitNirs = new Map()
    let content: Partial<PayfitData> & { nirUnavailable?: string[]; nirScopeMissing?: string[] }
    try {
      content = this.load('payfit') as typeof content
    } catch {
      return out
    }
    const companies = Array.isArray(content.companies) ? content.companies : []
    const sirets = new Set([...companies.map((c) => c.siret), ...(content.nirUnavailable ?? []), ...(content.nirScopeMissing ?? [])])
    for (const siret of sirets) {
      if ((content.nirUnavailable ?? []).includes(siret)) {
        out.set(siret, { status: 'unavailable' })
        continue
      }
      // rule-evp-payfit-scope-missing-fallback: the fixture simulates an introspection without the scope
      if ((content.nirScopeMissing ?? []).includes(siret)) {
        out.set(siret, { status: 'scope-missing' })
        continue
      }
      const ids = new Set(companies.filter((c) => c.siret === siret).map((c) => c.id))
      const table: NirTable = new Map()
      const invalid: NirHolder[] = []
      for (const employee of (content.employees ?? []) as Array<PayfitData['employees'][number] & { nir?: unknown }>) {
        const key = ids.has(employee.companyId) ? payfitNirKey(employee.nir) : null
        if (!key) continue
        const holder = { companyId: employee.companyId, employeeId: employee.id }
        // rule-evp-nir-key-both-sides, rule-evp-nir-key-absent-ok: only a complete NIR is checked
        if (key.length === 15 && !nirKeyIsValid(key)) {
          invalid.push(holder)
          continue
        }
        addHolder(table, key, holder)
      }
      out.set(siret, { status: 'ok', table, invalid })
    }
    return out
  }
}

/**
 * Real, read-only connectors (EVP_SOURCES_DRIVER=real): Google Sheets API v4, PayFit partner API, Aqoona tokenised
 * addresses. One switch for the whole process, no fall-back on the fixtures for a source (rule-evp-sources-configurable).
 */
export class RealSourceConnectors extends SourceConnectors {
  private readonly sheets = new SheetsClient()
  private readonly payfit = new PayfitClient()
  private readonly aqoona = new AqoonaClient()

  constructor(private readonly db: Database) {
    super()
  }

  listContacts(): Promise<SheetsRow[]> {
    return this.sheets.readContacts()
  }

  /** rule-evp-payfit-company-id: the identifier of a company is kept with the fingerprint of its key. */
  private readonly companyIdOf = async (siret: string, fingerprint: string): Promise<string | null> => {
    const [row] = await this.db
      .select({ id: payfitCompanies.id })
      .from(payfitCompanies)
      .where(and(eq(payfitCompanies.siret, siret), eq(payfitCompanies.keyFingerprint, fingerprint)))
      .limit(1)
    return row?.id ?? null
  }

  listPayfit(window: Window): Promise<PayfitData> {
    return this.payfit.read(window, this.companyIdOf)
  }

  listPlannings(window: Window): Promise<AqoonaData> {
    return this.aqoona.read(window)
  }

  listPayfitNirs(): Promise<PayfitNirs> {
    return this.payfit.readNirs()
  }

  override configuration(): Record<ReadableSource, string[]> {
    return {
      sheets: this.sheets.missingConfiguration(),
      payfit: this.payfit.missingConfiguration(),
      aqoona: this.aqoona.missingConfiguration(),
    }
  }

  override addresses(): Array<{ label: string; masked: string }> {
    return this.aqoona.addresses()
  }
}

export function createSourceConnectors(db: Database): SourceConnectors {
  const config = evpConfig()
  return config.sourcesDriver === 'real' ? new RealSourceConnectors(db) : new FixtureSourceConnectors(config.fixturesDir)
}
