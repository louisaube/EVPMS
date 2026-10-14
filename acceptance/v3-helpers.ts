/**
 * Aides de la version `v3-evp-acces-contrats-siret` (liaison Google, contrats proposés, SIRET partagés, adresse Aqoona
 * « Pros », NIR transitoire). Boîte noire : HTTP + SQL, aucun import du code de l'API. Elles complètent `evp-helpers.ts`
 * et `v2-helpers.ts` sans les modifier.
 */
import { sql } from './harness'
import { Rec, FakeNet, aqoonaEntries, d, envJson } from './v2-helpers'
import { SIRET_A, SIRET_B } from './evp-helpers'

export { SIRET_A, SIRET_B }

// ───────────────────────────── NIR fictifs (clés valides, jamais de vrai numéro) ─────────────────────────────

export const NIR1 = '285057512345623'
export const NIR2 = '190011234567815'
export const NIR3 = '278046912345627'
export const NIR4 = '172083312345649'
/** NIR d'une personne née en Corse (2A à la place des 6e et 7e chiffres ; clé 79 : 2A compte 19, reste 18), et 14 chiffres (la forme d'un SIRET : jamais un NIR). */
export const NIR_2A = '190052A12345679'
export const DIGITS14 = '28505751234562'
export const ALL_NIRS = [NIR1, NIR2, NIR3, NIR4, NIR_2A]

/** Mise en forme avec espaces, comme la saisie humaine d'un NIR (même valeur normalisée). */
export const spaced = (nir: string): string => `${nir[0]} ${nir.slice(1, 3)} ${nir.slice(3, 5)} ${nir.slice(5, 7)} ${nir.slice(7, 10)} ${nir.slice(10, 13)} ${nir.slice(13)}`

/** Toutes les formes sous lesquelles un NIR fictif ne doit apparaître nulle part. */
export const nirForms = (nir: string): string[] => [nir, spaced(nir), nir.slice(0, 13)]

// ───────────────────────────── lignes « Pros » ─────────────────────────────

export interface ProsRow {
  user_firstname: string
  user_lastname: string
  user_matricule: string
  etablissement_name: string
  planning_days_date: string
  planning_days_heure_debut: string
  planning_days_heure_fin: string
  planning_days_type_creneau: string
}

/** Une ligne de l'adresse « Pros » (un créneau). Valeurs par défaut : Léa Martin, Crèche Alpha, Garde de 08:00 à 12:00 à J-3. */
export function pros(o: { prenom?: string; nom?: string; matricule?: string | null; etab?: string; day?: string; debut?: string; fin?: string; type?: string } = {}): ProsRow {
  return {
    user_firstname: o.prenom ?? 'Léa',
    user_lastname: o.nom ?? 'Martin',
    user_matricule: o.matricule ?? '',
    etablissement_name: o.etab ?? 'Crèche Alpha',
    planning_days_date: o.day ?? d(-3),
    planning_days_heure_debut: o.debut ?? '08:00',
    planning_days_heure_fin: o.fin ?? '12:00',
    planning_days_type_creneau: o.type ?? 'Garde',
  }
}

// ───────────────────────────── serveur Aqoona « Pros » ─────────────────────────────

/** Adresse « Pros » unique de la variante `pros` (AQOONA_URLS de l'API sous test). */
export const prosEntry = () => aqoonaEntries()[0]

export interface ProsReply {
  status?: number
  body?: unknown
  raw?: string
  redirectTo?: string
}

/**
 * Serveur factice de l'adresse « Pros » : refuse (403) toute requête dont le paramètre `securityCheck` n'est pas celui de
 * l'adresse configurée, ignore les autres paramètres (dont `dateBegin` et `dateEnd`, relus dans le journal des appels).
 */
export class ProsFake {
  readonly entry = prosEntry()
  reply: ProsReply = { body: [] }
  private queued: ProsReply[] = []

  reset(): void {
    this.reply = { body: [] }
    this.queued = []
  }
  rows(rows: unknown[]): void {
    this.reply = { body: rows }
  }
  once(...r: ProsReply[]): void {
    this.queued.push(...r)
  }

  async mount(net: FakeNet): Promise<void> {
    const expected = new URL(this.entry.url).searchParams.get('securityCheck')
    await net.mount('aqoona-pros', this.entry.bare, (c) => {
      const got = new URLSearchParams(c.req.search).get('securityCheck')
      if (got !== expected) return c.json(403, { error: 'bad securityCheck' })
      const r = this.queued.shift() ?? this.reply
      if (r.redirectTo) return c.send(302, '', { location: r.redirectTo })
      if (r.raw !== undefined) return c.send(r.status ?? 200, r.raw, { 'content-type': 'application/json' })
      c.json(r.status ?? 200, r.body ?? [])
    })
  }
}

export const queryOf = (rec: Rec): URLSearchParams => new URLSearchParams(rec.search)

// ───────────────────────────── PayFit : collaboratrices portant un NIR ─────────────────────────────

/**
 * Noms de champ sous lesquels le faux PayFit expose le NIR d'une collaboratrice (portée « Social security number »). Le
 * nom exact dans la réponse de PayFit n'est pas fixé par la spécification (plan de module, « Points laissés ouverts ») :
 * le faux serveur le sert sous toutes les graphies plausibles à la fois.
 */
export function withNir<T extends object>(collaborator: T, nir: string | null): T & Record<string, unknown> {
  if (nir === null) return { ...collaborator }
  return {
    ...collaborator,
    socialSecurityNumber: nir,
    social_security_number: nir,
    socialSecurityNumberFR: nir,
    securityNumber: nir,
    ssn: nir,
    nir,
  }
}

// ───────────────────────────── recherche d'une valeur dans toute la base ─────────────────────────────

/** Texte de toutes les lignes de toutes les tables du schéma `base` (recherche textuelle sur chaque colonne). */
export async function allTablesText(): Promise<string> {
  const tables = await sql<{ tablename: string }>("select tablename from pg_tables where schemaname = 'base' order by tablename")
  const parts: string[] = []
  for (const t of tables) parts.push(JSON.stringify(await sql(`select x::text as t from base."${t.tablename}" x`)))
  return parts.join('\n')
}

/** Chaque forme de chaque NIR fictif est absente du texte (la sortie nomme `label` et le NIR par son rang, jamais par sa valeur). */
export function expectNoNir(label: string, text: string, nirs: string[] = ALL_NIRS): void {
  nirs.forEach((nir, rank) => {
    for (const form of nirForms(nir)) {
      expect({ label, nirRank: rank, found: text.includes(form) }).toEqual({ label, nirRank: rank, found: false })
    }
  })
}

// ───────────────────────────── divers ─────────────────────────────

/** Les SIRET des clés PayFit en plus de SIRET_A et SIRET_B (variante `pros`). */
export const bulkSirets = (): string[] => envJson<Array<{ siret: string }>>('PAYFIT_API_KEYS').map((e) => e.siret).filter((s) => s !== SIRET_A && s !== SIRET_B)

/**
 * Plannings stockés. `slot_type` est lu par `to_jsonb` : tant que la colonne n'existe pas (avant le code de la version),
 * elle vaut `null` et l'attendu échoue, au lieu d'une erreur SQL qui n'éprouverait rien.
 */
export const plannings = () =>
  sql(
    `select p.person_ref, p.creche_code, p.company_id, p.employee_id, p.day::text as day, left(p.start_time::text, 5) as start, left(p.end_time::text, 5) as "end",
            to_jsonb(p)->>'slot_type' as slot_type
       from base.aqoona_plannings p order by p.day, p.start_time, p.creche_code, p.person_ref, to_jsonb(p)->>'slot_type'`,
  )
