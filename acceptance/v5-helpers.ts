/**
 * Aides de la version `v5-evp-rattachement-nir` (rattachement par le NIR seul sur tout le réseau, taux en personnes, liste des
 * personnes non reliées, portée PayFit relue à chaque lecture, société nommée dans les anomalies). Boîte noire : HTTP + SQL,
 * aucun import du code de l'API. Elles complètent `evp-helpers.ts`, `v2-helpers.ts`, `v3-helpers.ts` et `v4-helpers.ts`
 * sans les modifier.
 *
 * NIR fictifs : ceux de `v4-helpers.ts` (clé juste vérifiée à la main, clé fausse = les 13 premiers chiffres d'un NIR juste
 * avec une autre clé). Aucun vrai numéro.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from './harness'
import { FIXTURES_DIR, GET, POST, PayfitFixture, R, SIRET_A, SIRET_B, World, payfitFixture, refresh, writeFixture, qs } from './evp-helpers'
import { d, everythingVisible } from './v2-helpers'
import { allTablesText } from './v3-helpers'
import {
  BAD1, BAD3, BAD4, NIR1, NIR2, NIR3, NIR4, NIR_KO, NIR_OK, V4_NIRS, bound, deref, expectNoLongDigits, isNullable, spaced, variants,
} from './v4-helpers'

export { BAD1, BAD3, BAD4, NIR1, NIR2, NIR3, NIR4, NIR_KO, NIR_OK, V4_NIRS, SIRET_A, SIRET_B, bound, d, deref, expectNoLongDigits, isNullable, spaced, variants, qs }

// ───────────────────────────── textes de l'API ─────────────────────────────

export const CAUSE_LABELS = {
  NIR_ABSENT: 'NIR absent dans Aqoona',
  NIR_KEY_INVALID: 'Clé du NIR incorrecte dans Aqoona',
  NIR_UNKNOWN: 'NIR inconnu de PayFit',
  NIR_AMBIGUOUS: 'NIR porté par plusieurs collaboratrices PayFit',
  PAYFIT_INCOMPLETE: 'NIR non vérifié : lecture PayFit incomplète',
} as const
export type Cause = keyof typeof CAUSE_LABELS
export const CAUSES = Object.keys(CAUSE_LABELS) as Cause[]

export const NO_NAME = 'Personne non nommée'
export const NO_COMPANY_NAME = 'Sans société identifiée'
export const UNMATCHED_LABEL = 'Planning non rattaché'
export const UNAVAILABLE_LABEL = 'Rapprochement par NIR indisponible'
export const NO_IDENTITY_LABEL = 'Ligne Aqoona sans nom ni NIR'
export const SCOPE_MISSING_LABEL = 'Portée PayFit manquante'
export const INTROSPECTION_LABEL = 'Introspection de la clé PayFit en échec'
export const KEY_AQOONA_LABEL = 'Clé de NIR Aqoona incorrecte'
export const KEY_PAYFIT_LABEL = 'Clé de NIR PayFit incorrecte'

/** Détail de « Planning non rattaché » : le libellé de la cause, puis la crèche lue. */
export const unmatchedDetail = (cause: Cause, creche: string): string => `${CAUSE_LABELS[cause]} (crèche lue : ${creche}).`
/** Détails de « Rapprochement par NIR indisponible » (côté Aqoona). */
export const AQ_SCOPE_DETAIL = 'La portée « collaborators:social-security:read » manque à la clé PayFit. Les collaboratrices de cette société ne peuvent pas être trouvées par leur NIR.'
export const AQ_UNAVAILABLE_DETAIL = 'Les collaboratrices de cette société ne peuvent pas être trouvées par leur NIR.'
/** Détails des anomalies de portée côté PayFit. */
export const PF_SCOPE_DETAIL = 'La portée « collaborators:social-security:read » manque à la clé de cette société : ses salariées ne peuvent pas être rattachées par leur NIR.'
export const PF_INTROSPECTION_DETAIL = /^La portée de la clé n'a pas pu être vérifiée : (PayFit injoignable|clé refusée|limite de débit|clé inactive|réponse inattendue)\.$/
export const introspectionDetail = (cause: string): string => `La portée de la clé n'a pas pu être vérifiée : ${cause}.`
export const noIdentityDetail = (n: number): RegExp => new RegExp(`^${n} ligne(\\(s\\)|s)? sans nom ni NIR\\.$`)
export const KEY_AQOONA_DETAIL = (n: number): RegExp => new RegExp(`^${n} créneau(x|\\(x\\))? : la clé de contrôle du NIR est incorrecte, la ligne n'est pas rattachée\\.$`)
export const KEY_PAYFIT_DETAIL = (siret: string): string => `Société ${siret} : la clé de contrôle du NIR est incorrecte, ce NIR n'est pas utilisé.`
export const UNKNOWN_COMPANY_NAME = 'Société sans nom connu'
export const companyLabel = (name: string, siret: string): string => `${name} (SIRET ${siret})`
export const ALPHA = companyLabel('Société A', SIRET_A)
export const BETA = companyLabel('Société B', SIRET_B)

export const normalise = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
/** Deux noms de personne sont les mêmes à la casse, aux accents et aux espaces près (l'API écrit « Prénom NOM » ou « Prénom Nom »). */
export const sameName = (a: string, b: string): boolean => normalise(a) === normalise(b)

// ───────────────────────────── fixtures du pilote fake ─────────────────────────────

export type Row = Record<string, unknown>
export interface FixtureEmployee {
  companyId: string
  id: string
  firstName: string
  lastName: string
  nir?: string
}
export interface PayfitOptions {
  /** SIRET dont la portée « numéro de sécurité sociale » manque (liste `nirScopeMissing`). */
  scopeMissing?: string[]
  /** SIRET dont les NIR ne peuvent pas être lus (liste `nirUnavailable`). */
  unavailable?: string[]
  /** SIRET dont l'introspection échoue à la lecture PayFit (liste `introspectionFailed`, v5). */
  introspectionFailed?: string[]
  employees?: FixtureEmployee[]
  contracts?: Array<{ companyId: string; id: string; employeeId: string; startDate: string; endDate: string | null }>
  companies?: Array<{ id: string; siret: string; name: string }>
}

/**
 * payfit.json cohérent avec `seedWorld()`. `nirs` donne le NIR de collaboratrices, par identifiant PayFit (`emp-ct-a1`) ou, quand
 * deux sociétés ont le même identifiant, par `companyId/identifiant` (`co-b/emp-ct-a3`). Le NIR est un champ facultatif de la fixture
 * (D-0010) : il ne sert qu'au rapprochement, jamais conservé.
 */
export function payfitWith(nirs: Record<string, string> = {}, o: PayfitOptions = {}): void {
  const extra: Record<string, unknown> = {}
  if (o.scopeMissing) extra.nirScopeMissing = o.scopeMissing
  if (o.unavailable) extra.nirUnavailable = o.unavailable
  if (o.introspectionFailed) extra.introspectionFailed = o.introspectionFailed
  if (o.companies) extra.companies = o.companies
  const fixture: any = payfitFixture([], extra as Partial<PayfitFixture>)
  fixture.employees = [...fixture.employees, ...(o.employees ?? [])].map((e: FixtureEmployee) => {
    const nir = nirs[`${e.companyId}/${e.id}`] ?? nirs[e.id] ?? e.nir
    return nir ? { ...e, nir } : e
  })
  fixture.contracts = [...fixture.contracts, ...(o.contracts ?? [])]
  writeFixture('payfit', fixture)
}

/** payfit.json illisible : le réseau PayFit est inconnu (aucune société, aucun NIR). */
export function writeUnreadablePayfit(): void {
  mkdirSync(FIXTURES_DIR, { recursive: true })
  writeFileSync(join(FIXTURES_DIR, 'payfit.json'), '{ this is not json')
}

/** Ligne Aqoona du pilote fake : Léa Martin, Crèche Alpha, 08:00-12:00, à J-3, sans NIR. */
export const row = (over: Row = {}): Row => ({ firstName: 'Léa', lastName: 'Martin', matricule: null, crecheName: 'Crèche Alpha', day: d(-3), start: '08:00', end: '12:00', ...over })

/** Les ordinateurs de la suite : lecture d'Aqoona et de PayFit, état de la source, anomalies, créneaux stockés (jeton du RH du monde). */
export function kit(world: () => World) {
  const readAqoona = async (rows: Row[]) => {
    writeFixture('aqoona', { rows })
    return refresh(world().rh.token, 'aqoona')
  }
  const readPayfit = () => refresh(world().rh.token, 'payfit')
  const sourceOf = async (key = 'aqoona') => (await GET('/sources', world().rh.token)).body.items.find((i: any) => i.key === key)
  const anomaliesOf = async (key: 'aqoona' | 'payfit' = 'aqoona') => {
    const res = await GET(`/sources/${key}/anomalies?size=50`, world().rh.token)
    expect({ key, status: res.status }).toEqual({ key, status: 200 })
    return res.body
  }
  const ofType = async (type: string, key: 'aqoona' | 'payfit' = 'aqoona') => (await anomaliesOf(key)).items.filter((i: any) => i.type === type)
  const volume = (volumes: any[], label: string) => volumes.find((v) => v.label === label)
  const rates = async (token = world().rh.token) => {
    const res = await ratesOf(token)
    expect({ status: res.status, text: res.status === 200 ? '' : res.text }).toEqual({ status: 200, text: '' })
    return res.body
  }
  const people = async (query: Record<string, string | number> = {}, token = world().rh.token) => {
    const res = await unlinkedOf(token, query)
    expect({ status: res.status, text: res.status === 200 ? '' : res.text }).toEqual({ status: 200, text: '' })
    return res.body
  }
  return { readAqoona, readPayfit, sourceOf, anomaliesOf, ofType, volume, rates, people }
}

// ───────────────────────────── routes des taux et de la liste ─────────────────────────────

export const RATES_PATH = '/sources/aqoona/matching-rates'
export const UNLINKED_PATH = '/sources/aqoona/unlinked-people'
export const ratesOf = (token?: string): Promise<R> => GET(RATES_PATH, token)
export const unlinkedOf = (token?: string, query: Record<string, string | number | undefined> = {}): Promise<R> => GET(`${UNLINKED_PATH}${qs(query)}`, token)

export interface PartV5 {
  count: number
  percent: number
}
export interface RateItemV5 {
  companyId: string | null
  siret: string | null
  name: string
  total: number
  linked: PartV5
  unlinked: PartV5
}
export interface PersonItem {
  name: string
  cause: Cause
  causeLabel: string
  creches: string[]
}

/** Ligne attendue des taux en personnes, pourcentages comme l'exige la demande : `round(100 × count / total, 1)`. */
export function expectedRate(companyId: string | null, siret: string | null, name: string, linked: number, unlinked: number): RateItemV5 {
  const total = linked + unlinked
  const pct = (n: number) => Math.round((100 * n * 10) / total) / 10
  return { companyId, siret, name, total, linked: { count: linked, percent: pct(linked) }, unlinked: { count: unlinked, percent: pct(unlinked) } }
}

export const rateOfCompany = (items: RateItemV5[], companyId: string | null): RateItemV5 | undefined => items.find((i) => i.companyId === companyId)
// `?.` : a reply in the shape of before v5 (no `linked` / `unlinked`) must fail an expectation, not throw a TypeError.
export const summary = (items: RateItemV5[]): Array<[string | null, number, number]> => items.map((i) => [i.companyId, i.linked?.count, i.unlinked?.count] as [string | null, number, number])
export const personsOf = (items: PersonItem[]): Array<[string, Cause, string[]]> => items.map((i) => [i.name, i.cause, i.creches])

// ───────────────────────────── créneaux stockés ─────────────────────────────

export interface StoredSlot {
  person_ref: string
  creche_code: string | null
  company_id: string | null
  employee_company_id: string | null
  employee_id: string | null
  match_method: string | null
  unlinked_cause: string | null
  creche_label: string | null
  day: string
  start: string
}

/** Créneaux dans l'ordre (jour, début, crèche, personne). Les colonnes de la v5 sont lues par `to_jsonb` : absentes, elles valent `null` et l'attendu échoue. */
export const slots = (): Promise<StoredSlot[]> =>
  sql(
    `select p.person_ref, p.creche_code, p.company_id, p.employee_id, p.day::text as day, left(p.start_time::text, 5) as start,
            to_jsonb(p)->>'employee_company_id' as employee_company_id, to_jsonb(p)->>'match_method' as match_method,
            to_jsonb(p)->>'unlinked_cause' as unlinked_cause, to_jsonb(p)->>'creche_label' as creche_label
       from base.aqoona_plannings p order by p.day, p.start_time, p.creche_code, p.person_ref`,
  )

export const slotOfDay = (all: StoredSlot[], day: string): StoredSlot => {
  const found = all.find((s) => s.day === day)
  expect({ day, found: found !== undefined }).toEqual({ day, found: true })
  return found as StoredSlot
}

/** Projection lisible d'un créneau rattaché ou non : [société du créneau, crèche, société de la collaboratrice, collaboratrice, mode, cause]. */
export const link = (s: StoredSlot): [string | null, string | null, string | null, string | null, string | null, string | null] => [
  s.company_id, s.creche_code, s.employee_company_id, s.employee_id, s.match_method, s.unlinked_cause,
]

export type Mode = 'NIR' | 'NOM' | 'AUCUN' | 'INCONNU'

export interface SlotSeed {
  personRef?: string
  crecheCode?: string | null
  companyId?: string | null
  employeeId?: string | null
  employeeCompanyId?: string | null
  unlinkedCause?: Cause | null
  crecheLabel?: string | null
  day?: string
  start?: string
  end?: string
  slotType?: string
}

let counter = 0
let columnsCache: Array<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }> | undefined

/**
 * Insère un créneau dans `base.aqoona_plannings` avec le mode et la cause donnés (`'DEFAULT'` : la colonne `match_method` n'est
 * pas écrite). Un créneau « rattaché » demande `employeeId` et `employeeCompanyId` ; un créneau « non relié » demande `unlinkedCause`.
 * Les colonnes non nulles sans défaut que la recette ne connaît pas reçoivent une valeur neutre de leur type.
 */
export async function seedSlot(mode: Mode | 'DEFAULT', o: SlotSeed = {}): Promise<void> {
  counter += 1
  columnsCache ??= await sql("select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'base' and table_name = 'aqoona_plannings'")
  const known: Record<string, unknown> = {
    person_ref: o.personRef ?? `Personne ${counter}`,
    creche_code: o.crecheCode === undefined ? 'alpha' : o.crecheCode,
    company_id: o.companyId === undefined ? 'co-a' : o.companyId,
    employee_id: o.employeeId === undefined ? null : o.employeeId,
    employee_company_id: o.employeeCompanyId === undefined ? null : o.employeeCompanyId,
    unlinked_cause: o.unlinkedCause === undefined ? null : o.unlinkedCause,
    creche_label: o.crecheLabel === undefined ? null : o.crecheLabel,
    day: o.day ?? d(-3),
    start_time: o.start ?? '08:00',
    end_time: o.end ?? '12:00',
    slot_type: o.slotType ?? 'GARDE',
  }
  if (mode !== 'DEFAULT') known.match_method = mode
  const values: Record<string, unknown> = {}
  for (const c of columnsCache) {
    if (c.column_name in known) values[c.column_name] = known[c.column_name]
    else if (c.is_nullable === 'NO' && c.column_default === null) values[c.column_name] = neutral(c.data_type)
  }
  const names = Object.keys(values)
  await sql(`insert into base.aqoona_plannings (${names.map((n) => `"${n}"`).join(', ')}) values (${names.map((_, i) => `$${i + 1}`).join(', ')})`, names.map((n) => values[n]))
}

/** Personne rattachée par son NIR : un créneau `NIR`, avec la société de référence de la collaboratrice. */
export const seedLinked = (employeeCompanyId: string, employeeId: string, o: SlotSeed = {}): Promise<void> =>
  seedSlot('NIR', { personRef: `Rattachée ${employeeId}`, employeeCompanyId, employeeId, ...o })

/** Personne non reliée : un créneau `AUCUN` avec sa cause. */
export const seedUnlinked = (personRef: string, cause: Cause, o: SlotSeed = {}): Promise<void> =>
  seedSlot('AUCUN', { personRef, unlinkedCause: cause, employeeId: null, employeeCompanyId: null, ...o })

function neutral(dataType: string): unknown {
  if (/char|text/.test(dataType)) return 'x'
  if (/int|numeric|double|real/.test(dataType)) return 0
  if (dataType === 'boolean') return false
  if (dataType === 'date') return d(-3)
  if (/^time/.test(dataType) && !/stamp/.test(dataType)) return '00:00'
  if (/timestamp/.test(dataType)) return new Date().toISOString()
  if (dataType === 'uuid') return '00000000-0000-4000-8000-000000000001'
  if (/json/.test(dataType)) return '{}'
  return null
}

/** Société PayFit posée en SQL (sans collaboratrice ni crèche). */
export async function addCompany(id: string, siret: string, name: string): Promise<void> {
  await sql('insert into base.payfit_companies (id, siret, name) values ($1, $2, $3)', [id, siret, name])
}

// ───────────────────────────── tout ce que l'API montre ou stocke ─────────────────────────────

/** Texte de tout ce que l'API montre ou stocke à propos des lectures : réponses, anomalies, taux, liste, tables de `base`. */
export async function everythingV5(token: string): Promise<string> {
  const base = await everythingVisible(token, { GET: (p, t) => GET(p, t), POST: (p, t, b) => POST(p, t, b), sql: (q) => sql(q) })
  const parts = [base, (await ratesOf(token)).text, (await unlinkedOf(token, { size: 50 })).text, await allTablesText()]
  for (const from of [0, 50, 100]) parts.push((await unlinkedOf(token, { from, size: 50 })).text)
  return parts.join('\n')
}
