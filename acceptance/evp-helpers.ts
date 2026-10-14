/**
 * Aides de la version `v1-evp` (EVP, préparation et suivi des absences).
 * Boîte noire : HTTP + SQL, aucun import du code de l'API.
 *
 * Hypothèses de préparation (tirées du plan de module `evp-module-implementation-plan.md`, section « Données »,
 * le contrat de données du socle ne portant aucune table EVP) :
 *  - les comptes EVP vivent dans `base.users` (+ `base.credentials`) et `base.evp_accounts` ;
 *  - une crèche est une ligne de `base.creches`, un `base.scopes(code)` et un groupe technique `evp:<code>`
 *    lié à ce périmètre ; les comptes à consultation globale (RH, ADMINISTRATRICE) sont membres du groupe `evp:all`
 *    lié à tous les périmètres de crèche ; une directrice ou une RO est membre des groupes `evp:<code>` de ses crèches
 *    et a une ligne `base.creche_assignments` par crèche ;
 *  - `resetData()` vide toutes les tables du schéma `base`, `base.absence_types` comprise : `seedTypes()` la repose.
 *
 * Format des fixtures des connecteurs de test (`api/.evp-fixtures-test/*.json`, écrites par les tests avant une
 * lecture) et du journal d'appels `calls.log` : défini ici par la recette, à implémenter par les doubles. Voir
 * `acceptance/COVERAGE-v1-evp.md`, section « Interface des doubles de test ».
 */
import { createHmac, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool, PoolClient } from 'pg'
import bcrypt from 'bcryptjs'
import { API_URL, sql, createUser, login } from './harness'
import { decodePayload, jwtSecret } from './renfort-helpers'

export const UNKNOWN_UUID = '00000000-0000-4000-8000-000000000000'
export const API_DIR = join(__dirname, '..', 'api')
export const FIXTURES_DIR = join(API_DIR, '.evp-fixtures-test')
export const STORAGE_DIR = join(API_DIR, '.evp-storage-test')
export const CALLS_LOG = join(FIXTURES_DIR, 'calls.log')

// ───────────────────────────── HTTP ─────────────────────────────

export interface R {
  status: number
  body: any
  text: string
  headers: Headers
}

export async function http(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; rawBody?: string; headers?: Record<string, string>; redirect?: 'manual' | 'follow' } = {},
): Promise<R> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) }
  if (opts.token) headers.authorization = `Bearer ${opts.token}`
  let body: string | undefined
  if (opts.rawBody !== undefined) {
    body = opts.rawBody
    headers['content-type'] ??= 'application/json'
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body)
    headers['content-type'] = 'application/json'
  }
  const res = await fetch(`${API_URL}${path}`, { method, headers, body, redirect: opts.redirect ?? 'manual' })
  // Buffer#toString keeps a leading byte order mark, which Response#text would drop.
  const text = Buffer.from(await res.arrayBuffer()).toString('utf8')
  let parsed: any = undefined
  try {
    parsed = text ? JSON.parse(text) : undefined
  } catch {
    parsed = undefined
  }
  return { status: res.status, body: parsed, text, headers: res.headers }
}

export const GET = (path: string, token?: string) => http('GET', path, { token })
export const POST = (path: string, token?: string, body?: unknown) => http('POST', path, { token, body })
export const PATCH = (path: string, token?: string, body?: unknown) => http('PATCH', path, { token, body })

export const qs = (params: Record<string, string | number | boolean | undefined | string[]>): string => {
  const parts: string[] = []
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue
    for (const one of Array.isArray(v) ? v : [v]) parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(one))}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

// ───────────────────────────── dates (Europe/Paris) ─────────────────────────────

export const todayParis = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Mois `AAAA-MM` décalé de `n` mois par rapport à aujourd'hui (Paris). */
export function monthShift(n: number): string {
  const [y, m] = todayParis().split('-').map(Number)
  const idx = y * 12 + (m - 1) + n
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ───────────────────────────── jetons de session ─────────────────────────────

let claimShape: Record<string, unknown> | undefined

/**
 * Les comptes EVP n'ont aucun mot de passe utilisable (connexion Google seule) : la recette forge leur jeton avec
 * JWT_SECRET de `api/.env.test`. La forme des revendications est lue sur un vrai jeton du socle (compte jetable
 * créé puis supprimé), les valeurs d'identité, de rôle et de date sont substituées.
 */
async function shape(): Promise<Record<string, unknown>> {
  if (claimShape) return claimShape
  const probe = await createUser({ email: `shape-${randomBytes(4).toString('hex')}@probe.test`, password: 'Passw0rd!x', role: 'user' })
  try {
    const token = await login(probe.email, 'Passw0rd!x')
    const claims = decodePayload(token)
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(claims)) {
      if (v === probe.id) out[k] = '$ID'
      else if (v === 'user') out[k] = '$ROLE'
      else if (k === 'iat') out[k] = '$IAT'
      else if (k === 'exp') out[k] = '$EXP'
      else out[k] = v
    }
    if (!('iat' in out)) out.iat = '$IAT'
    if (!('exp' in out)) out.exp = '$EXP'
    claimShape = out
    return out
  } finally {
    await sql('delete from base.users where id = $1', [probe.id])
  }
}

const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64url')

export async function forgeSession(
  userId: string,
  socleRole: 'user' | 'admin',
  opts: { ageSeconds?: number; lifetimeSeconds?: number } = {},
): Promise<string> {
  const tpl = await shape()
  const iat = Math.floor(Date.now() / 1000) - (opts.ageSeconds ?? 0)
  const exp = iat + (opts.lifetimeSeconds ?? 8 * 3600)
  const claims: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(tpl)) {
    claims[k] = v === '$ID' ? userId : v === '$ROLE' ? socleRole : v === '$IAT' ? iat : v === '$EXP' ? exp : v
  }
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(claims))
  const sig = createHmac('sha256', jwtSecret()).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${sig}`
}

// ───────────────────────────── données de base ─────────────────────────────

export type EvpRole = 'DIRECTRICE' | 'RO' | 'RH' | 'ADMINISTRATRICE' | 'SUPERADMIN'

export const TYPES = [
  { code: 'CONGES_PAYES', label: 'Congés payés', piece: null, priv: false, hr: false, payfit: 'CP', compat: ['CP', 'CPA'] },
  { code: 'ARRET_MALADIE', label: 'Arrêt maladie', piece: "Avis d'arrêt", priv: true, hr: false, payfit: 'MAL', compat: ['MAL'] },
  { code: 'SANS_SOLDE', label: 'Sans solde', piece: 'Accord écrit', priv: false, hr: true, payfit: 'SS', compat: ['SS'] },
  { code: 'ENFANT_MALADE', label: 'Enfant malade', piece: 'Certificat', priv: false, hr: false, payfit: 'EM', compat: ['EM'] },
  { code: 'ACCIDENT_TRAVAIL', label: 'Accident du travail', piece: 'Certificat et déclaration', priv: false, hr: true, payfit: 'AT', compat: ['AT'] },
  { code: 'RECUPERATION', label: 'Récupération', piece: 'Heures validées', priv: false, hr: true, payfit: 'REC', compat: ['REC'] },
  { code: 'SANS_JUSTIFICATIF', label: 'Sans justificatif', piece: null, priv: false, hr: true, payfit: 'SJ', compat: ['SJ'] },
  { code: 'EVENEMENT_FAMILIAL', label: 'Événement familial', piece: 'Acte', priv: false, hr: false, payfit: 'EF', compat: ['EF'] },
  { code: 'AUTRE', label: 'Autre', piece: null, priv: false, hr: true, payfit: 'AUT', compat: ['AUT'] },
] as const

/** Repose les 9 types par défaut (la remise à zéro du harnais vide `base.absence_types`), codes PayFit compris. */
export async function seedTypes(): Promise<void> {
  for (const t of TYPES) {
    await sql(
      `insert into base.absence_types (code, label, expected_piece, private_piece, hr_review, payfit_code, payfit_compatible_codes)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (code) do update set label = excluded.label, expected_piece = excluded.expected_piece,
         private_piece = excluded.private_piece, hr_review = excluded.hr_review, payfit_code = excluded.payfit_code,
         payfit_compatible_codes = excluded.payfit_compatible_codes`,
      [t.code, t.label, t.piece, t.priv, t.hr, t.payfit, t.compat],
    )
  }
}

export interface Creche {
  code: string
  name: string
  siret: string
}

async function ensureGroup(name: string): Promise<string> {
  const found = await sql('select id from base.groups where lower(name) = lower($1)', [name])
  if (found.length) return found[0].id
  const rows = await sql('insert into base.groups (name) values ($1) returning id', [name])
  return rows[0].id
}

export async function seedCreche(
  code: string,
  opts: { name?: string; siret?: string; directriceName?: string | null; roNames?: string[]; verified?: boolean } = {},
): Promise<Creche> {
  const name = opts.name ?? `Crèche ${code}`
  const siret = opts.siret ?? String(10000000000000 + Math.abs(hash(code)) % 80000000000000)
  const [scope] = await sql('insert into base.scopes (code, name) values ($1, $2) returning id', [code, name])
  await sql(
    `insert into base.creches (code, name, siret, directrice_name, ro_names, verified, scope_code)
     values ($1, $2, $3, $4, $5, $6, $1)`,
    [code, name, siret, opts.directriceName === undefined ? null : opts.directriceName, opts.roNames ?? [], opts.verified ?? true],
  )
  const own = await ensureGroup(`evp:${code}`)
  await sql('insert into base.group_scopes (group_id, scope_id) values ($1, $2) on conflict do nothing', [own, scope.id])
  const all = await ensureGroup('evp:all')
  await sql('insert into base.group_scopes (group_id, scope_id) values ($1, $2) on conflict do nothing', [all, scope.id])
  return { code, name, siret }
}

function hash(s: string): number {
  let h = 7
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0
  return h
}

const RANDOM_HASH = bcrypt.hashSync(randomBytes(16).toString('hex'), 10)

export interface Account {
  id: string
  email: string
  name: string
  role: EvpRole
  token: string
}

let accountCounter = 0

/** Compte EVP complet (utilisateur socle, identifiants sans mot de passe utilisable, ligne EVP, affectations, groupes). */
export async function seedAccount(
  role: EvpRole,
  opts: { name?: string; email?: string; active?: boolean; creches?: string[]; removed?: boolean; password?: string } = {},
): Promise<Account> {
  accountCounter += 1
  const email = (opts.email ?? `${role.toLowerCase()}${accountCounter}@micro-stars.fr`).toLowerCase()
  const name = opts.name ?? `${role} ${accountCounter}`
  const socleRole = role === 'SUPERADMIN' ? 'admin' : 'user'
  const [user] = await sql('insert into base.users (email, role) values ($1, $2) returning id', [email, socleRole])
  const pwd = opts.password ? await bcrypt.hash(opts.password, 10) : RANDOM_HASH
  await sql("insert into base.credentials (user_id, password, type) values ($1, $2, 'token')", [user.id, pwd])
  await sql(
    `insert into base.evp_accounts (user_id, name, email, role, active, removed_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [user.id, name, email, role, opts.active ?? true, opts.removed ? new Date().toISOString() : null],
  )
  if (role === 'DIRECTRICE' || role === 'RO') {
    for (const code of opts.creches ?? []) await assignCreche(user.id, code)
  } else if (role === 'RH' || role === 'ADMINISTRATRICE') {
    const all = await ensureGroup('evp:all')
    await sql('insert into base.group_users (group_id, user_id) values ($1, $2) on conflict do nothing', [all, user.id])
  }
  const token = await forgeSession(user.id, socleRole)
  return { id: user.id, email, name, role, token }
}

export async function assignCreche(userId: string, code: string): Promise<void> {
  await sql('insert into base.creche_assignments (user_id, creche_code) values ($1, $2) on conflict do nothing', [userId, code])
  const g = await ensureGroup(`evp:${code}`)
  await sql('insert into base.group_users (group_id, user_id) values ($1, $2) on conflict do nothing', [g, userId])
}

export interface Contract {
  id: string
  companyId: string
  payfitContractId: string
  employeeName: string
}

export async function seedCompany(id: string, siret: string, name = `Société ${id}`): Promise<void> {
  await sql('insert into base.payfit_companies (id, siret, name) values ($1, $2, $3)', [id, siret, name])
}

export async function seedContract(
  companyId: string,
  payfitContractId: string,
  first: string,
  last: string,
  start = '2020-01-01',
  end: string | null = null,
): Promise<Contract> {
  const employeeId = `emp-${payfitContractId}`
  await sql('insert into base.payfit_employees (company_id, employee_id, first_name, last_name) values ($1, $2, $3, $4)', [
    companyId,
    employeeId,
    first,
    last,
  ])
  const [row] = await sql(
    `insert into base.payfit_contracts (company_id, payfit_contract_id, employee_id, start_date, end_date)
     values ($1, $2, $3, $4, $5) returning id`,
    [companyId, payfitContractId, employeeId, start, end],
  )
  return { id: row.id, companyId, payfitContractId, employeeName: `${first} ${last}` }
}

export const SIRET_A = '11111111111111'
export const SIRET_B = '22222222222222'

export interface World {
  alpha: Creche
  beta: Creche
  ctA: Contract
  ctA2: Contract
  ctB: Contract
  dirA: Account
  dirB: Account
  roA: Account
  roB: Account
  rh: Account
  adm: Account
  sup: Account
}

/** Deux crèches (alpha, beta) liées chacune à une société PayFit par SIRET, deux contrats en alpha, un en beta, un compte par rôle. */
export async function seedWorld(): Promise<World> {
  await seedTypes()
  const alpha = await seedCreche('alpha', { name: 'Crèche Alpha', siret: SIRET_A, directriceName: 'Camille Alpha', roNames: ['Rosa Alpha'] })
  const beta = await seedCreche('beta', { name: 'Crèche Beta', siret: SIRET_B, directriceName: 'Dana Beta', roNames: ['Robin Beta'] })
  await seedCompany('co-a', SIRET_A, 'Société A')
  await seedCompany('co-b', SIRET_B, 'Société B')
  const ctA = await seedContract('co-a', 'ct-a1', 'Léa', 'Martin')
  const ctA2 = await seedContract('co-a', 'ct-a2', 'Noé', 'Petit')
  const ctB = await seedContract('co-b', 'ct-b1', 'Zoé', 'Durand')
  const dirA = await seedAccount('DIRECTRICE', { name: 'Camille Alpha', creches: ['alpha'] })
  const dirB = await seedAccount('DIRECTRICE', { name: 'Dana Beta', creches: ['beta'] })
  const roA = await seedAccount('RO', { name: 'Rosa Alpha', creches: ['alpha'] })
  const roB = await seedAccount('RO', { name: 'Robin Beta', creches: ['beta'] })
  const rh = await seedAccount('RH', { name: 'Marine RH' })
  const adm = await seedAccount('ADMINISTRATRICE', { name: 'Justine Admin' })
  const sup = await seedAccount('SUPERADMIN', { name: 'Louis Super' })
  return { alpha, beta, ctA, ctA2, ctB, dirA, dirB, roA, roB, rh, adm, sup }
}

// ───────────────────────────── absences ─────────────────────────────

export type Half = 'MATIN' | 'APRES_MIDI'
export type Status = 'A_COMPLETER' | 'ANTICIPEE' | 'A_VALIDER' | 'A_SAISIR' | 'DANS_PAYFIT' | 'REJETEE' | 'ANNULEE'
export const ALL_STATUSES: Status[] = ['A_COMPLETER', 'ANTICIPEE', 'A_VALIDER', 'A_SAISIR', 'DANS_PAYFIT', 'REJETEE', 'ANNULEE']

export interface AbsenceInput {
  crecheCode?: string
  contractId: string
  typeCode?: string
  startDate?: string
  startHalf?: Half
  endDate?: string
  endHalf?: Half
  comment?: string
  justificatifIds?: string[]
}

/** Corps de `POST /absences` : par défaut un congé payé terminé il y a quelques jours (donc « À valider »). */
export function absenceBody(input: AbsenceInput): Record<string, unknown> {
  const t = todayParis()
  return {
    crecheCode: 'alpha',
    typeCode: 'CONGES_PAYES',
    startDate: addDays(t, -6),
    startHalf: 'MATIN',
    endDate: addDays(t, -4),
    endHalf: 'APRES_MIDI',
    justificatifIds: [],
    ...input,
  }
}

export const createAbsence = (token: string, input: AbsenceInput) => POST('/absences', token, absenceBody(input))

export interface SeedAbsence {
  crecheCode?: string
  contractId: string
  typeCode?: string
  startDate?: string
  startHalf?: Half
  endDate?: string
  endHalf?: Half
  status?: Status
  saisieDeclaree?: boolean
  payrollMonth?: string
  declaredBy: string
  createdAt?: string
  comment?: string | null
  lastDecision?: Record<string, unknown> | null
}

/** Insère un dossier directement en base (états difficiles à atteindre par l'API). Rend son identifiant. */
export async function seedAbsence(a: SeedAbsence): Promise<string> {
  const t = todayParis()
  const start = a.startDate ?? addDays(t, -6)
  const rows = await sql(
    `insert into base.absences (creche_code, scope_code, contract_id, type_code, start_date, start_half, end_date, end_half,
       status, saisie_declaree, comment, payroll_month, blockages, last_decision, declared_by, declared_at, created_at, updated_at)
     values ($1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, '[]'::jsonb, $12, $13, now(), coalesce($14::timestamptz, now()), now())
     returning id`,
    [
      a.crecheCode ?? 'alpha',
      a.contractId,
      a.typeCode ?? 'CONGES_PAYES',
      start,
      a.startHalf ?? 'MATIN',
      a.endDate ?? addDays(start, 2),
      a.endHalf ?? 'APRES_MIDI',
      a.status ?? 'A_VALIDER',
      a.saisieDeclaree ?? false,
      a.comment ?? null,
      a.payrollMonth ?? start.slice(0, 7),
      a.lastDecision ? JSON.stringify(a.lastDecision) : null,
      a.declaredBy,
      a.createdAt ?? null,
    ],
  )
  return rows[0].id
}

export const statusOf = async (id: string): Promise<string> => (await sql('select status from base.absences where id = $1', [id]))[0].status

export const absenceRow = async (id: string) => (await sql('select * from base.absences where id = $1', [id]))[0]

export async function countRows(table: string, where = 'true', params: unknown[] = []): Promise<number> {
  return Number((await sql(`select count(*)::int as n from base.${table} where ${where}`, params))[0].n)
}

// ───────────────────────────── journal d'audit ─────────────────────────────

export const auditRows = (action?: string) =>
  action
    ? sql('select * from base.audit_logs where action = $1 order by occurred_at, id', [action])
    : sql('select * from base.audit_logs order by occurred_at, id')

export const auditCount = async (action?: string): Promise<number> => (await auditRows(action)).length

// ───────────────────────────── invariants ─────────────────────────────

/** Écarts entre `creche_assignments` et les groupes techniques `evp:<code>` (hors `evp:all`) : vide si l'invariant tient. */
export async function assignmentInvariantViolations(): Promise<any[]> {
  return sql(
    `(select ca.user_id, ca.creche_code, 'affectation sans groupe' as problem from base.creche_assignments ca
      except select gu.user_id, substring(g.name from 5), 'affectation sans groupe'
        from base.group_users gu join base.groups g on g.id = gu.group_id where g.name like 'evp:%' and g.name <> 'evp:all')
     union all
     (select gu.user_id, substring(g.name from 5), 'groupe sans affectation'
        from base.group_users gu join base.groups g on g.id = gu.group_id where g.name like 'evp:%' and g.name <> 'evp:all'
      except select ca.user_id, ca.creche_code, 'groupe sans affectation' from base.creche_assignments ca)`,
  )
}

// ───────────────────────────── justificatifs ─────────────────────────────

export const PDF_BYTES = (marker = randomBytes(8).toString('hex')) => Buffer.from(`%PDF-1.4\n% ${marker}\n1 0 obj\n<<>>\nendobj\n%%EOF\n`)
export const JPEG_BYTES = (marker = randomBytes(8).toString('hex')) =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`JFIF ${marker}`), Buffer.from([0xff, 0xd9])])
export const PNG_BYTES = (marker = randomBytes(8).toString('hex')) =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`IHDR ${marker}`)])

export interface AuthorizeInput {
  crecheCode?: string
  absenceId?: string
  fileName?: string
  contentType?: string
  sizeBytes: number
}

export const authorizeUpload = (token: string, input: AuthorizeInput) =>
  POST('/justificatifs/authorize-upload', token, { crecheCode: 'alpha', fileName: 'justificatif.pdf', contentType: 'application/pdf', ...input })

/** Dépôt des octets à l'URL signée (sans jeton d'authentification EVP). */
export async function putBytes(auth: any, bytes: Buffer, contentType?: string): Promise<number> {
  const url = new URL(auth.uploadUrl, API_URL)
  const res = await fetch(url, { method: auth.method ?? 'PUT', headers: { ...(auth.headers ?? {}), ...(contentType ? { 'content-type': contentType } : {}) }, body: bytes })
  await res.arrayBuffer()
  return res.status
}

export const confirmPiece = (token: string, id: string) => POST(`/justificatifs/${id}/confirm`, token)

/** Autorise, dépose et confirme une pièce. Rend son identifiant. */
export async function uploadPiece(
  token: string,
  opts: { crecheCode?: string; absenceId?: string; fileName?: string; kind?: 'pdf' | 'jpeg' | 'png'; marker?: string } = {},
): Promise<{ id: string; bytes: Buffer; auth: any }> {
  const kind = opts.kind ?? 'pdf'
  const bytes = kind === 'pdf' ? PDF_BYTES(opts.marker) : kind === 'jpeg' ? JPEG_BYTES(opts.marker) : PNG_BYTES(opts.marker)
  const contentType = kind === 'pdf' ? 'application/pdf' : kind === 'jpeg' ? 'image/jpeg' : 'image/png'
  const auth = await authorizeUpload(token, {
    crecheCode: opts.crecheCode,
    absenceId: opts.absenceId,
    fileName: opts.fileName ?? `piece.${kind === 'jpeg' ? 'jpg' : kind}`,
    contentType,
    sizeBytes: bytes.length,
  })
  if (auth.status !== 201) throw new Error(`authorize-upload ${auth.status} ${auth.text}`)
  const put = await putBytes(auth.body, bytes, contentType)
  if (put >= 400) throw new Error(`PUT ${put}`)
  const conf = await confirmPiece(token, auth.body.id)
  if (conf.status !== 200) throw new Error(`confirm ${conf.status} ${conf.text}`)
  return { id: auth.body.id, bytes, auth: auth.body }
}

/** Nombre de fichiers du stockage de test dont le contenu contient le marqueur (agnostique de la disposition des clés). */
export function storageFilesContaining(marker: string): string[] {
  const hits: string[] = []
  const walk = (dir: string) => {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else if (readFileSync(p).includes(marker)) hits.push(p)
    }
  }
  walk(STORAGE_DIR)
  return hits
}

// ───────────────────────────── sources (fixtures et journal d'appels) ─────────────────────────────

export function clearFixtures(): void {
  mkdirSync(FIXTURES_DIR, { recursive: true })
  for (const f of ['workspace', 'sheets', 'payfit', 'aqoona']) rmSync(join(FIXTURES_DIR, `${f}.json`), { force: true })
  rmSync(CALLS_LOG, { force: true })
}

export function writeFixture(name: 'workspace' | 'sheets' | 'payfit' | 'aqoona', data: unknown): void {
  mkdirSync(FIXTURES_DIR, { recursive: true })
  writeFileSync(join(FIXTURES_DIR, `${name}.json`), JSON.stringify(data))
}

export const callsLog = (): string => (existsSync(CALLS_LOG) ? readFileSync(CALLS_LOG, 'utf8') : '')

/** Statuts PayFit de la recette : seul `VALIDATED` est admissible ; `CANCELED` marque une absence annulée à la source. */
export const PF = { ok: 'VALIDATED', canceled: 'CANCELED', notAdmissible: 'PENDING' }

export interface PayfitFixture {
  companies?: Array<{ id: string; siret: string; name: string }>
  employees?: Array<{ companyId: string; id: string; firstName: string; lastName: string }>
  contracts?: Array<{ companyId: string; id: string; employeeId: string; startDate: string; endDate: string | null }>
  absences?: Array<{
    companyId: string
    id: string
    contractId: string
    typeCode: string
    status: string
    startDate: string
    startHalf: Half
    endDate: string
    endHalf: Half
  }>
  /** Lecture exhaustive (couvre la fenêtre pour chaque société) : requis pour une alerte de disparition. */
  exhaustive?: boolean
  error?: string
}

/** Fixture PayFit cohérente avec `seedWorld()` : sociétés, collaboratrices et contrats de l'amorçage, plus les absences données. */
export function payfitFixture(absences: PayfitFixture['absences'] = [], extra: Partial<PayfitFixture> = {}): PayfitFixture {
  return {
    companies: [
      { id: 'co-a', siret: SIRET_A, name: 'Société A' },
      { id: 'co-b', siret: SIRET_B, name: 'Société B' },
    ],
    employees: [
      { companyId: 'co-a', id: 'emp-ct-a1', firstName: 'Léa', lastName: 'Martin' },
      { companyId: 'co-a', id: 'emp-ct-a2', firstName: 'Noé', lastName: 'Petit' },
      { companyId: 'co-b', id: 'emp-ct-b1', firstName: 'Zoé', lastName: 'Durand' },
    ],
    contracts: [
      { companyId: 'co-a', id: 'ct-a1', employeeId: 'emp-ct-a1', startDate: '2020-01-01', endDate: null },
      { companyId: 'co-a', id: 'ct-a2', employeeId: 'emp-ct-a2', startDate: '2020-01-01', endDate: null },
      { companyId: 'co-b', id: 'ct-b1', employeeId: 'emp-ct-b1', startDate: '2020-01-01', endDate: null },
    ],
    absences,
    exhaustive: true,
    ...extra,
  }
}

export async function waitRun(token: string, runId: string, timeoutMs = 60000): Promise<any> {
  const until = Date.now() + timeoutMs
  for (;;) {
    const res = await GET(`/sources/runs/${runId}`, token)
    if (res.status !== 200) throw new Error(`run ${runId}: ${res.status} ${res.text}`)
    if (res.body.state !== 'RUNNING') return res.body
    if (Date.now() > until) throw new Error(`run ${runId} still RUNNING`)
    await sleep(100)
  }
}

/** Lance une lecture et attend sa fin. */
export async function refresh(token: string, key: 'sheets' | 'payfit' | 'aqoona') {
  const started = await POST(`/sources/${key}/refresh`, token)
  if (started.status !== 202) throw new Error(`refresh ${key}: ${started.status} ${started.text}`)
  return waitRun(token, started.body.runId)
}

// ───────────────────────────── base : rôle `evp_app` et sécurité au niveau des lignes ─────────────────────────────

const slug = (() => {
  try {
    return JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')).name as string
  } catch {
    return 'evpms'
  }
})()
const DATABASE_URL = process.env.ACCEPTANCE_DATABASE_URL ?? `postgres://database:database@localhost:5432/${slug}_test`
let rlsPool: Pool | undefined

/**
 * Exécute `fn` dans une transaction annulée à la fin, sous le rôle `evp_app` (sans contournement de la sécurité au niveau
 * des lignes). `settings` : réglages de la requête EVP ; absents, la politique doit échouer fermée.
 */
export async function asEvpApp<T>(settings: { userId: string; scopeAll: boolean } | null, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  rlsPool ??= new Pool({ connectionString: DATABASE_URL, max: 2 })
  const c = await rlsPool.connect()
  try {
    await c.query('begin')
    await c.query('set local role evp_app')
    if (settings) await c.query("select set_config('evp.user_id', $1, true), set_config('evp.scope_all', $2, true)", [settings.userId, settings.scopeAll ? 'true' : 'false'])
    return await fn(c)
  } finally {
    await c.query('rollback').catch(() => undefined)
    c.release()
  }
}

/** Lignes lues sous `evp_app`, ou `null` si la lecture lève une erreur (échec fermé accepté). */
export async function rowsAsEvpApp(settings: { userId: string; scopeAll: boolean } | null, query: string, params: unknown[] = []): Promise<any[] | null> {
  return asEvpApp(settings, async (c) => {
    try {
      return (await c.query(query, params)).rows
    } catch {
      return null
    }
  })
}

export async function closeEvp(): Promise<void> {
  await rlsPool?.end()
  rlsPool = undefined
}

// ───────────────────────────── secrets de l'API de test ─────────────────────────────

export function envSecrets(): string[] {
  const text = readFileSync(join(API_DIR, '.env.test'), 'utf8')
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^(JWT_SECRET|COOKIE_SECRET|DATABASE_URL)=(.*)$/.exec(line)
    if (m) out.push(m[2].trim().replace(/^["']|["']$/g, ''))
  }
  return out.filter((s) => s.length >= 8)
}

/** Tous les chemins d'un objet JSON (clés), pour chercher des noms suspects. */
export function allKeys(value: unknown, acc: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, acc))
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      acc.push(k)
      allKeys(v, acc)
    }
  }
  return acc
}

export const sortedKeys = (o: object): string[] => Object.keys(o).sort()

export const ROLES: EvpRole[] = ['DIRECTRICE', 'RO', 'RH', 'ADMINISTRATRICE', 'SUPERADMIN']
