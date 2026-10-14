/**
 * Aides de la version `v4-evp-fiabilite-nir` (portée PayFit vérifiée, clé de contrôle du NIR, taux de rattachement).
 * Boîte noire : HTTP + SQL, aucun import du code de l'API. Elles complètent `evp-helpers.ts`, `v2-helpers.ts` et
 * `v3-helpers.ts` sans les modifier.
 *
 * NIR fictifs : aucun vrai numéro. Chaque NIR « juste » ci-dessous a une clé de contrôle vérifiée à la main
 * (97 − reste de la division par 97 des 13 premiers chiffres, 2A → 19 et 2B → 18) ; chaque NIR « faux » reprend les 13
 * premiers chiffres d'un NIR juste avec une autre clé.
 */
import { sql } from './harness'
import { GET, R, SIRET_A, SIRET_B, qs } from './evp-helpers'
import { PayfitFake, d, everythingVisible } from './v2-helpers'
import { NIR1, NIR2, NIR3, NIR4, allTablesText, nirForms, spaced } from './v3-helpers'
import { POST } from './evp-helpers'

export { NIR1, NIR2, NIR3, NIR4, SIRET_A, SIRET_B, spaced, nirForms, allTablesText, d }

// ───────────────────────────── NIR fictifs ─────────────────────────────

/** Vecteurs de la demande (`rule-evp-nir-key-vectors`) : `1 84 12 76 451 089 46` est juste (reste 51), `...47` est faux. */
export const NIR_OK = '184127645108946'
export const NIR_KO = '184127645108947'
/** `1 85 03 2A 004 012 38` est juste (2A → 19, reste 59) ; `1 85 03 2B 004 012 65` est juste (2B → 18, reste 32) ; la clé de 2B ne vaut pas pour 2A. */
export const NIR_2A_OK = '185032A00401238'
export const NIR_2B_OK = '185032B00401265'
export const NIR_2A_KO = '185032A00401265'
/** Reste 0 : la clé vaut 97 (`291031234562697`, 13 premiers chiffres multiples de 97). */
export const NIR_97 = '291031234562697'

/** NIR1, NIR3, NIR4 de la v3 avec une clé fausse (la bonne clé est 23, 27 et 49), et une clé `00` (toujours fausse). */
export const BAD1 = '285057512345624'
export const BAD1_00 = '285057512345600'
export const BAD3 = '278046912345628'
export const BAD4 = '172083312345648'

export const VALID_NIRS = [NIR1, NIR2, NIR3, NIR4, NIR_OK, NIR_2A_OK, NIR_2B_OK, NIR_97]
export const BAD_NIRS = [BAD1, BAD1_00, BAD3, BAD4, NIR_KO, NIR_2A_KO]
export const V4_NIRS = [...VALID_NIRS, ...BAD_NIRS]

/** Aucune série d'au moins 9 chiffres dans le texte, hors SIRET autorisés (un NIR, même fautif, en compte 13 ou 15). */
export function expectNoLongDigits(label: string, text: string, allowed: string[] = [SIRET_A, SIRET_B]): void {
  let rest = text
  for (const a of allowed) rest = rest.split(a).join('')
  const found = /\d{9,}/.exec(rest)
  expect({ label, longDigitRun: found ? `${found[0].length} chiffres` : null }).toEqual({ label, longDigitRun: null })
}

// ───────────────────────────── créneaux posés en SQL ─────────────────────────────

export type MatchMethod = 'NIR' | 'NOM' | 'AUCUN' | 'INCONNU'

export interface SlotSeed {
  personRef?: string
  crecheCode?: string | null
  companyId?: string | null
  employeeId?: string | null
  day?: string
  start?: string
  end?: string
  slotType?: string
  addressLabel?: string | null
}

let slotCounter = 0
let columnsCache: Array<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }> | undefined

/**
 * Insère un créneau dans `base.aqoona_plannings` avec le mode de rattachement donné (`'DEFAULT'` : la colonne n'est pas
 * écrite, c'est la valeur par défaut de la base qui joue). Les colonnes non nulles sans défaut que la recette ne connaît pas
 * reçoivent une valeur neutre de leur type : la recette ne dépend que des colonnes citées par la demande.
 */
export async function insertSlot(mode: MatchMethod | 'DEFAULT', o: SlotSeed = {}): Promise<void> {
  slotCounter += 1
  columnsCache ??= await sql("select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'base' and table_name = 'aqoona_plannings'")
  const known: Record<string, unknown> = {
    person_ref: o.personRef ?? `Personne ${slotCounter}`,
    creche_code: o.crecheCode === undefined ? 'alpha' : o.crecheCode,
    company_id: o.companyId === undefined ? 'co-a' : o.companyId,
    employee_id: o.employeeId === undefined ? null : o.employeeId,
    day: o.day ?? d(-3),
    start_time: o.start ?? '08:00',
    end_time: o.end ?? '12:00',
    slot_type: o.slotType ?? 'GARDE',
    address_label: o.addressLabel === undefined ? null : o.addressLabel,
  }
  if (mode !== 'DEFAULT') known.match_method = mode
  const values: Record<string, unknown> = {}
  for (const c of columnsCache) {
    if (c.column_name in known) {
      values[c.column_name] = known[c.column_name]
    } else if (c.is_nullable === 'NO' && c.column_default === null) {
      values[c.column_name] = neutral(c.data_type)
    }
  }
  const names = Object.keys(values)
  await sql(`insert into base.aqoona_plannings (${names.map((n) => `"${n}"`).join(', ')}) values (${names.map((_, i) => `$${i + 1}`).join(', ')})`, names.map((n) => values[n]))
}

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

/** Modes de rattachement stockés, dans l'ordre des créneaux (jour, début, crèche, personne). Vide tant que la colonne n'existe pas. */
export const storedModes = async (): Promise<Array<{ person_ref: string; creche_code: string | null; company_id: string | null; employee_id: string | null; day: string; start: string; match_method: string | null }>> =>
  sql(
    `select p.person_ref, p.creche_code, p.company_id, p.employee_id, p.day::text as day, left(p.start_time::text, 5) as start,
            to_jsonb(p)->>'match_method' as match_method
       from base.aqoona_plannings p order by p.day, p.start_time, p.creche_code, p.person_ref`,
  )

// ───────────────────────────── taux de rattachement ─────────────────────────────

export const RATES_PATH = '/sources/aqoona/matching-rates'
export const NO_COMPANY_NAME = 'Sans société identifiée'
export const ratesOf = (token?: string): Promise<R> => GET(RATES_PATH, token)

export interface RatePart {
  count: number
  percent: number
}
export interface RateItem {
  companyId: string | null
  siret: string | null
  name: string
  total: number
  byNir: RatePart
  byName: RatePart
  unmatched: RatePart
}

/** Ligne attendue, pourcentages calculés comme l'exige la demande : `round(100 × count / total, 1)`. */
export function expectedItem(companyId: string | null, siret: string | null, name: string, nir: number, nom: number, aucun: number): RateItem {
  const total = nir + nom + aucun
  const pct = (n: number) => Math.round((100 * n * 10) / total) / 10
  return {
    companyId,
    siret,
    name,
    total,
    byNir: { count: nir, percent: pct(nir) },
    byName: { count: nom, percent: pct(nom) },
    unmatched: { count: aucun, percent: pct(aucun) },
  }
}

/** Nom et SIRET de société posés en SQL (sans collaboratrice ni crèche) pour éprouver le tri et la jointure. */
export async function addCompany(id: string, siret: string, name: string): Promise<void> {
  await sql('insert into base.payfit_companies (id, siret, name) values ($1, $2, $3)', [id, siret, name])
}

// ───────────────────────────── contrat OpenAPI ─────────────────────────────

export const deref = (doc: any, node: any): any => {
  let cur = node
  for (let i = 0; i < 10 && cur?.$ref; i++) {
    const path = String(cur.$ref).replace(/^#\//, '').split('/')
    cur = path.reduce((acc: any, k: string) => acc?.[k], doc)
  }
  return cur
}

/** Variantes d'un schéma nullable, quelle que soit la façon dont le document l'écrit (`nullable`, `allOf`, `oneOf`, `anyOf`). */
export const variants = (doc: any, node: any): any[] => {
  const n = deref(doc, node)
  const subs = [...(n?.allOf ?? []), ...(n?.oneOf ?? []), ...(n?.anyOf ?? [])]
  return subs.length ? [n, ...subs.flatMap((s: any) => variants(doc, s))] : [n]
}

export const isNullable = (doc: any, node: any): boolean => variants(doc, node).some((v) => v?.nullable === true || v?.type === 'null' || (Array.isArray(v?.type) && v.type.includes('null')))

/** Contrainte d'un nœud, cherchée dans ses variantes (`minLength`, `maxLength`, `minimum`, `maximum`, `maxItems`, ...). */
export const bound = (doc: any, node: any, key: string): unknown => variants(doc, node).map((v) => v?.[key]).find((v) => v !== undefined)

// ───────────────────────────── faux PayFit : portées de l'introspection ─────────────────────────────

export const SOCIAL_SCOPE = 'collaborators:social-security:read'
export const SCOPE_WITHOUT = 'collaborators:read contracts:read time:read'
export const SCOPE_WITH = `${SCOPE_WITHOUT} ${SOCIAL_SCOPE}`
/** Valeur de `scope` qui signifie « le champ n'est pas dans la réponse d'introspection ». */
export const ABSENT = Symbol('scope absent')

/**
 * Règle la réponse d'introspection du faux PayFit : `per` donne le `scope` de chaque société (par SIRET), `fallback` celui
 * des autres. `ABSENT` supprime le champ. `active` vaut vrai sauf pour les SIRET de `inactive`.
 */
export function introspectScopes(pf: PayfitFake, per: Record<string, unknown> = {}, fallback: unknown = SCOPE_WITH, inactive: string[] = []): void {
  pf.introspectBody = (c) => {
    const scope = c.siret in per ? per[c.siret] : fallback
    const body: Record<string, unknown> = { active: !inactive.includes(c.siret), company_id: c.companyId, client_id: 'fake-client' }
    if (scope !== ABSENT) body.scope = scope
    return body
  }
}

// ───────────────────────────── tout ce que l'API montre ou stocke ─────────────────────────────

/** Texte de tout ce que l'API montre ou stocke à propos des lectures, taux de rattachement compris. */
export async function everythingV4(token: string): Promise<string> {
  const base = await everythingVisible(token, { GET: (p, t) => GET(p, t), POST: (p, t, b) => POST(p, t, b), sql: (q) => sql(q) })
  return [base, (await ratesOf(token)).text, await allTablesText()].join('\n')
}

export { qs }
