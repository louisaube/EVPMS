/**
 * Aides de la version `v2-evp-sources` (connexion Google vérifiée par le serveur, lectures réelles de Google Sheets,
 * PayFit et Aqoona). Boîte noire : HTTP + SQL, aucun import du code de l'API.
 *
 * L'API de test est un processus distinct des tests : ses adresses de sources sont fixées à son démarrage par
 * `api/.env.test` (ou par le fichier désigné par `ACCEPTANCE_ENV_FILE`). Les tests LISENT ce fichier, démarrent des
 * serveurs HTTP factices sur ces adresses locales et font varier le comportement des serveurs, jamais la
 * configuration. Voir `acceptance/COVERAGE-v2-evp-sources.md`, section « Interface des doubles de test (v2) ».
 */
import { createServer, IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from 'node:http'
import { createPrivateKey, createPublicKey, createSign, createVerify, generateKeyPairSync, KeyObject } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { API_DIR, addDays, http, qs, R, SIRET_A, SIRET_B, sleep, todayParis, Half } from './evp-helpers'

// ───────────────────────────── variantes d'API ─────────────────────────────

/** Les fichiers « standard » tournent contre l'API de test `real` entièrement configurée ; la variante `unconfigured` contre une API lancée sans variables de sources ni de secret Google. */
export const VARIANT = process.env.ACCEPTANCE_VARIANT ?? ''
export const describeStandard: typeof describe = (VARIANT === '' ? describe : describe.skip) as typeof describe
export const describeUnconfigured: typeof describe = (VARIANT === 'unconfigured' ? describe : describe.skip) as typeof describe

// ───────────────────────────── configuration de l'API de test ─────────────────────────────

const ENV_PATH = process.env.ACCEPTANCE_ENV_FILE ?? join(API_DIR, '.env.test')
let envCache: Record<string, string> | undefined

export function testEnv(): Record<string, string> {
  if (envCache) return envCache
  const out: Record<string, string> = {}
  for (const line of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[m[1]] = v
  }
  envCache = out
  return out
}

export const envOpt = (name: string): string | undefined => {
  const v = testEnv()[name]
  return v === undefined || v === '' ? undefined : v
}

export function envReq(name: string): string {
  const v = envOpt(name)
  // Une variable manquante est un attendu non satisfait (rouge nommant la variable), pas une erreur de mise en place.
  expect({ file: ENV_PATH, variable: name, declared: v !== undefined }).toEqual({ file: ENV_PATH, variable: name, declared: true })
  return v as string
}

export const envJson = <T>(name: string): T => JSON.parse(envReq(name)) as T

/** Chemin d'un fichier de configuration désigné par l'environnement (absolu, ou relatif à `api/` puis à la racine du dépôt). */
export function configFile(name: string): string {
  const p = envReq(name)
  if (isAbsolute(p)) return p
  const candidates = [join(API_DIR, p), join(API_DIR, '..', p)]
  return candidates.find((c) => existsSync(c)) ?? candidates[0]
}

/** Exécute `fn` après avoir remplacé le contenu d'un fichier de configuration, puis le restaure. */
export async function withConfigFile<T>(name: string, content: unknown, fn: () => Promise<T>): Promise<T> {
  const path = configFile(name)
  const original = readFileSync(path, 'utf8')
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content, null, 2))
  try {
    return await fn()
  } finally {
    writeFileSync(path, original)
  }
}

// ───────────────────────────── dates (Europe/Paris) ─────────────────────────────

export const d = (n: number): string => addDays(todayParis(), n)

export function firstOfMonth(shift: number): string {
  const [y, m] = todayParis().split('-').map(Number)
  const idx = y * 12 + (m - 1) + shift
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`
}
export const lastOfMonth = (shift: number): string => addDays(firstOfMonth(shift + 1), -1)

// ───────────────────────────── serveurs factices ─────────────────────────────

export interface Rec {
  seq: number
  at: number
  tag: string
  method: string
  path: string
  search: string
  headers: IncomingHttpHeaders
  body: string
}
export interface Ctx {
  req: Rec
  res: ServerResponse
  send(status: number, body?: string, headers?: Record<string, string>): void
  json(status: number, body?: unknown, headers?: Record<string, string>): void
  /** Ne jamais répondre (la connexion est coupée à la fermeture du réseau factice). */
  hang(): void
}
export type Handler = (c: Ctx) => void | Promise<void>

/**
 * Serveurs HTTP locaux sur les adresses fixes déclarées dans l'environnement de l'API de test. Un serveur par port ;
 * la requête est confiée au montage dont le préfixe de chemin est le plus long. Si le port est occupé (fichier de test
 * précédent encore en train de se fermer), l'écoute est retentée pendant 90 s.
 */
export class FakeNet {
  readonly log: Rec[] = []
  private seq = 0
  private servers = new Map<number, Server>()
  private mounts: Array<{ tag: string; port: number; prefix: string; handler: Handler }> = []

  async mount(tag: string, url: string, handler: Handler): Promise<void> {
    const u = new URL(url)
    const port = Number(u.port || 80)
    this.mounts.push({ tag, port, prefix: u.pathname.replace(/\/+$/, ''), handler })
    if (!this.servers.has(port)) await this.listen(port)
  }

  calls(tag: string | RegExp): Rec[] {
    return this.log.filter((r) => (typeof tag === 'string' ? r.tag === tag : tag.test(r.tag)))
  }

  clear(): void {
    this.log.length = 0
  }

  async close(): Promise<void> {
    for (const s of this.servers.values()) {
      s.closeAllConnections?.()
      await new Promise<void>((resolve) => s.close(() => resolve()))
    }
    this.servers.clear()
  }

  private async listen(port: number): Promise<void> {
    const server = createServer((req, res) => this.dispatch(port, req, res))
    const deadline = Date.now() + 90_000
    for (;;) {
      try {
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject)
          server.listen(port, () => {
            server.off('error', reject)
            resolve()
          })
        })
        this.servers.set(port, server)
        return
      } catch (e: any) {
        if (e?.code !== 'EADDRINUSE' || Date.now() > deadline) throw e
        await sleep(500)
      }
    }
  }

  private dispatch(port: number, req: IncomingMessage, res: ServerResponse): void {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('error', () => undefined)
    req.on('end', () => {
      const u = new URL(req.url ?? '/', 'http://fake.invalid')
      const mount = this.mounts
        .filter((m) => m.port === port && (m.prefix === '' || u.pathname === m.prefix || u.pathname.startsWith(`${m.prefix}/`)))
        .sort((a, b) => b.prefix.length - a.prefix.length)[0]
      const rec: Rec = {
        seq: ++this.seq,
        at: Date.now(),
        tag: mount?.tag ?? 'unmounted',
        method: req.method ?? 'GET',
        path: u.pathname,
        search: u.search,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }
      this.log.push(rec)
      const send = (status: number, body = '', headers: Record<string, string> = {}) => {
        if (res.headersSent || res.destroyed) return
        res.writeHead(status, headers)
        res.end(body)
      }
      const ctx: Ctx = {
        req: rec,
        res,
        send,
        json: (status, body, headers = {}) =>
          send(status, body === undefined ? '' : JSON.stringify(body), { 'content-type': 'application/json', ...headers }),
        hang: () => undefined,
      }
      if (!mount) return send(404)
      Promise.resolve()
        .then(() => mount.handler(ctx))
        .catch(() => send(500))
    })
  }
}

export type Scripted = 'ok' | 'hang' | number | { status: number; headers?: Record<string, string>; body?: unknown } | { delayMs: number }

/** Applique un comportement scénarisé ; rend vrai si la réponse a été donnée (ou volontairement jamais donnée). */
async function applyScripted(c: Ctx, s: Scripted, echo: string): Promise<boolean> {
  if (s === 'ok') return false
  if (s === 'hang') {
    c.hang()
    return true
  }
  if (typeof s === 'number') {
    // le corps d'erreur reprend volontairement l'en-tête d'autorisation : l'API ne doit jamais le relayer
    c.json(s, { status: s, error: 'fake_error', detail: echo })
    return true
  }
  if ('delayMs' in s) {
    await sleep(s.delayMs)
    return false
  }
  c.json(s.status, s.body ?? { status: s.status, error: 'fake_error', detail: echo }, s.headers)
  return true
}

class ScriptBook {
  private seq = new Map<string, Scripted[]>()
  private sticky = new Map<string, Scripted>()
  next(key: string): Scripted {
    const q = this.seq.get(key)
    if (q?.length) return q.shift()!
    return this.sticky.get(key) ?? 'ok'
  }
  once(key: string, ...s: Scripted[]): void {
    this.seq.set(key, [...(this.seq.get(key) ?? []), ...s])
  }
  always(key: string, s: Scripted): void {
    this.sticky.set(key, s)
  }
  reset(): void {
    this.seq.clear()
    this.sticky.clear()
  }
}

// ───────────────────────────── JWT ─────────────────────────────

export const b64u = (x: Buffer | string): string => Buffer.from(x).toString('base64url')

export function signRs256(header: object, payload: object, key: KeyObject): string {
  const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`
  return `${input}.${createSign('RSA-SHA256').update(input).sign(key).toString('base64url')}`
}

export function verifyRs256(token: string, publicKey: KeyObject): boolean {
  const parts = token.split('.')
  if (parts.length !== 3) return false
  return createVerify('RSA-SHA256').update(`${parts[0]}.${parts[1]}`).verify(publicKey, Buffer.from(parts[2], 'base64url'))
}

export const decodePart = (part: string): any => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))

// ───────────────────────────── Google (connexion) ─────────────────────────────

export interface GoogleKey {
  kid: string
  privateKey: KeyObject
  jwk: Record<string, unknown>
}

export function newGoogleKey(kid: string): GoogleKey {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  return { kid, privateKey, jwk: { ...(publicKey.export({ format: 'jwk' }) as object), kid, alg: 'RS256', use: 'sig' } }
}

export const googleClientId = (): string => envReq('GOOGLE_CLIENT_ID')
export const googleDomain = (): string => envOpt('GOOGLE_ALLOWED_DOMAIN') ?? 'micro-stars.fr'
export const googleRedirectUri = (): string =>
  envOpt('GOOGLE_REDIRECT_URI') ?? `${envReq('GOOGLE_PUBLIC_ORIGIN').replace(/\/+$/, '')}/google-sign-in/callback`

/** Revendications d'un jeton d'identité valide ; une valeur `undefined` supprime la revendication. */
export function googleClaims(over: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000)
  return {
    iss: 'https://accounts.google.com',
    azp: googleClientId(),
    aud: googleClientId(),
    sub: '110000000000000000001',
    email: 'camille@micro-stars.fr',
    email_verified: true,
    hd: googleDomain(),
    name: 'Camille Alpha',
    iat: now,
    exp: now + 3600,
    ...over,
  }
}

export class GoogleFake {
  keys: GoogleKey[]
  certsCacheControl: string | undefined = 'public, max-age=0'
  certsOverride: { status: number; body?: string } | null = null
  tokenMode: 'normal' | 'hang' | { status: number; body?: unknown } = 'normal'
  tokenTransform: ((idToken: string) => unknown) | null = null
  readonly idTokens = new Map<string, string>()
  readonly tokenRequests: Array<{ form: URLSearchParams; headers: IncomingHttpHeaders; at: number }> = []

  constructor(keys: GoogleKey[]) {
    this.keys = keys
  }

  reset(keys?: GoogleKey[]): void {
    if (keys) this.keys = keys
    this.certsCacheControl = 'public, max-age=0'
    this.certsOverride = null
    this.tokenMode = 'normal'
    this.tokenTransform = null
    this.idTokens.clear()
    this.tokenRequests.length = 0
  }

  async mount(net: FakeNet): Promise<void> {
    await net.mount('google-certs', envReq('GOOGLE_CERTS_URL'), (c) => {
      if (this.certsOverride) return c.send(this.certsOverride.status, this.certsOverride.body ?? '', { 'content-type': 'application/json' })
      const headers: Record<string, string> = {}
      if (this.certsCacheControl !== undefined) headers['cache-control'] = this.certsCacheControl
      c.json(200, { keys: this.keys.map((k) => k.jwk) }, headers)
    })
    await net.mount('google-token', envReq('GOOGLE_TOKEN_URL'), (c) => {
      const form = new URLSearchParams(c.req.body)
      this.tokenRequests.push({ form, headers: c.req.headers, at: Date.now() })
      if (this.tokenMode === 'hang') return c.hang()
      if (typeof this.tokenMode === 'object') return c.json(this.tokenMode.status, this.tokenMode.body ?? { error: 'invalid_grant' })
      const idToken = this.idTokens.get(form.get('code') ?? '')
      if (!idToken) return c.json(400, { error: 'invalid_grant', error_description: 'Bad Request' })
      const body = this.tokenTransform
        ? this.tokenTransform(idToken)
        : { access_token: 'ya29.fake-access', expires_in: 3599, token_type: 'Bearer', scope: 'openid email profile', id_token: idToken }
      c.json(200, body)
    })
  }
}

export const setCookies = (res: R): string[] => ((res.headers as any).getSetCookie?.() as string[] | undefined) ?? []

/** En-tête `Cookie` à renvoyer à partir des `Set-Cookie` d'une réponse. */
export const cookieHeader = (res: R): string =>
  setCookies(res)
    .map((c) => c.split(';')[0])
    .join('; ')

/** Cookie de session (nom contenant `-jwt-`, valeur non vide), ou undefined. */
export function sessionCookie(res: R): { pair: string; value: string; attrs: string } | undefined {
  for (const raw of setCookies(res)) {
    const [pair, ...attrs] = raw.split(';')
    const eq = pair.indexOf('=')
    const name = pair.slice(0, eq)
    const value = pair.slice(eq + 1)
    if (/-jwt-/.test(name) && value.length > 0) return { pair: pair.trim(), value, attrs: attrs.join(';') }
  }
  return undefined
}

export interface Flow {
  start: R
  state: string
  nonce: string
  challenge: string
  cookie: string
  redirectUri: string
}

/** Première moitié du flux : `GET /google-sign-in/start`. */
export async function beginFlow(redirection?: string): Promise<Flow> {
  const start = await http('GET', `/google-sign-in/start${redirection === undefined ? '' : qs({ redirection })}`)
  expect({ status: start.status, body: start.status === 302 ? '' : start.text }).toEqual({ status: 302, body: '' })
  const loc = new URL(start.headers.get('location')!)
  return {
    start,
    state: loc.searchParams.get('state') ?? '',
    nonce: loc.searchParams.get('nonce') ?? '',
    challenge: loc.searchParams.get('code_challenge') ?? '',
    cookie: cookieHeader(start),
    redirectUri: loc.searchParams.get('redirect_uri') ?? '',
  }
}

export const callbackPath = (code: string, state: string): string => `/google-sign-in/callback${qs({ code, state })}`

// ───────────────────────────── Google Sheets ─────────────────────────────

export const SHEET_HEADER = ['Nom', 'Code', 'SIRET', 'Adresse de connexion', 'Directrice', 'RO nom', 'RO e-mail']
export const GAMMA = ['Crèche Gamma', 'GAMMA', '03333333333333', 'gamma@micro-stars.fr', 'Gaby Gamma', 'Rita Gamma', 'rita.gamma@micro-stars.fr']

export function sheetsEnv() {
  return {
    baseUrl: envReq('SHEETS_BASE_URL'),
    tokenUrl: envOpt('SHEETS_TOKEN_URL') ?? envReq('GOOGLE_TOKEN_URL'),
    id: envReq('SHEETS_SPREADSHEET_ID'),
    tab: envOpt('SHEETS_TAB_NAME') ?? 'Contacts des crèches',
    range: envOpt('SHEETS_RANGE') ?? 'A:G',
    clientEmail: envOpt('SHEETS_CLIENT_EMAIL'),
    privateKeyPem: envReq('SHEETS_PRIVATE_KEY').replace(/\\n/g, '\n'),
  }
}

export class SheetsFake {
  table: string[][] = [SHEET_HEADER, GAMMA]
  omitValues = false
  rawBody: string | undefined
  expiresIn = 60
  issued = 0
  readonly assertions: Array<{ grantType: string | null; header: any; claims: any; valid: boolean; form: URLSearchParams }> = []
  private book = new ScriptBook()

  reset(): void {
    this.table = [SHEET_HEADER, GAMMA]
    this.omitValues = false
    this.rawBody = undefined
    this.expiresIn = 60
    this.assertions.length = 0
    this.book.reset()
  }
  failValues(...s: Scripted[]): void {
    this.book.once('values', ...s)
  }
  failValuesAlways(s: Scripted): void {
    this.book.always('values', s)
  }
  failToken(...s: Scripted[]): void {
    this.book.once('token', ...s)
  }

  async mount(net: FakeNet): Promise<void> {
    const e = sheetsEnv()
    const publicKey = createPublicKey(createPrivateKey(e.privateKeyPem))
    await net.mount('sheets-token', e.tokenUrl, async (c) => {
      const form = new URLSearchParams(c.req.body)
      const parts = (form.get('assertion') ?? '').split('.')
      let header: any
      let claims: any
      let valid = false
      try {
        header = decodePart(parts[0])
        claims = decodePart(parts[1])
        valid = verifyRs256(form.get('assertion') ?? '', publicKey)
      } catch {
        valid = false
      }
      this.assertions.push({ grantType: form.get('grant_type'), header, claims, valid, form })
      if (await applyScripted(c, this.book.next('token'), `assertion ${form.get('assertion') ?? ''}`)) return
      this.issued += 1
      c.json(200, { access_token: `fake-sheets-token-${this.issued}`, expires_in: this.expiresIn, token_type: 'Bearer' })
    })
    const basePath = new URL(e.baseUrl).pathname.replace(/\/+$/, '')
    await net.mount('sheets', e.baseUrl, async (c) => {
      const auth = String(c.req.headers.authorization ?? '')
      if (await applyScripted(c, this.book.next('values'), auth)) return
      if (!/^Bearer fake-sheets-token/.test(auth)) return c.json(401, { error: { code: 401, status: 'UNAUTHENTICATED', message: `Invalid credentials ${auth}` } })
      const decoded = decodeURIComponent(c.req.path)
      if (!decoded.startsWith(`${basePath}/v4/spreadsheets/${e.id}/values/`)) return c.json(404, { error: { code: 404, status: 'NOT_FOUND', message: 'Requested entity was not found.' } })
      if (decoded !== `${basePath}/v4/spreadsheets/${e.id}/values/'${e.tab}'!${e.range}`) {
        return c.json(400, { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Unable to parse range' } })
      }
      if (this.rawBody !== undefined) return c.send(200, this.rawBody, { 'content-type': 'text/html' })
      const meta = { range: `'${e.tab}'!A1:G${this.table.length}`, majorDimension: 'ROWS' }
      c.json(200, this.omitValues ? meta : { ...meta, values: this.table })
    })
  }
}

// ───────────────────────────── PayFit ─────────────────────────────

export type Moment = 'beginning-of-day' | 'middle-of-day' | 'end-of-day'
export const MOMENT: Record<'start' | 'end', Record<Half, Moment>> = {
  start: { MATIN: 'beginning-of-day', APRES_MIDI: 'middle-of-day' },
  end: { MATIN: 'middle-of-day', APRES_MIDI: 'end-of-day' },
}

export interface PfAbs {
  id: string
  contractId: string
  startDate: string
  endDate: string
  startMoment: Moment
  endMoment: Moment
  type: string
  status: string
}
export interface PfCompany {
  siret: string
  key: string
  companyId: string
  name?: string
  identificationNumber?: string
  collaborators: Array<{ id: string; firstName: string; lastName: string }>
  contracts: Array<{ contractId: string; collaboratorId: string; startDate: string; endDate: string | null; status?: string }>
  absences: PfAbs[]
}

export function payfitKey(siret: string): string {
  const entry = envJson<Array<{ siret: string; apiKey: string }>>('PAYFIT_API_KEYS').find((e) => e.siret === siret)
  expect({ variable: 'PAYFIT_API_KEYS', siret, declared: entry !== undefined }).toEqual({ variable: 'PAYFIT_API_KEYS', siret, declared: true })
  return entry!.apiKey
}

/** Absence PayFit (statut brut `approved` par défaut, type `CP`, du jour J-6 au jour J-4, du matin à l'après-midi). */
export function pfa(over: Partial<PfAbs> & { startHalf?: Half; endHalf?: Half } = {}): PfAbs {
  const { startHalf = 'MATIN', endHalf = 'APRES_MIDI', ...rest } = over
  return {
    id: 'pf-1',
    contractId: 'ct-a1',
    startDate: d(-6),
    endDate: d(-4),
    startMoment: MOMENT.start[startHalf],
    endMoment: MOMENT.end[endHalf],
    type: 'CP',
    status: 'approved',
    ...rest,
  }
}

export class PayfitFake {
  companies: PfCompany[] = []
  introspectBody: ((c: PfCompany) => unknown) | null = null
  cyclic = false
  private book = new ScriptBook()

  reset(): void {
    this.book.reset()
    this.introspectBody = null
    this.cyclic = false
  }
  /** Comportements successifs pour un appel (clé : SIRET de la société, point d'accès). */
  fail(siret: string, endpoint: 'introspect' | 'company' | 'collaborators' | 'contracts' | 'absences', ...s: Scripted[]): void {
    this.book.once(`${siret}|${endpoint}`, ...s)
  }
  failAlways(siret: string, endpoint: 'introspect' | 'company' | 'collaborators' | 'contracts' | 'absences', s: Scripted): void {
    this.book.always(`${siret}|${endpoint}`, s)
  }
  company(siret: string): PfCompany {
    return this.companies.find((c) => c.siret === siret)!
  }

  async mount(net: FakeNet): Promise<void> {
    await net.mount('payfit-introspect', envReq('PAYFIT_INTROSPECT_URL'), (c) => this.introspect(c))
    await net.mount('payfit', envReq('PAYFIT_BASE_URL'), (c) => this.api(c))
  }

  private async introspect(c: Ctx): Promise<void> {
    const bearer = /^Bearer (.+)$/.exec(String(c.req.headers.authorization ?? ''))?.[1]
    const spec = this.companies.find((x) => x.key === bearer)
    if (c.req.method !== 'POST') return c.json(405, { error: 'method_not_allowed' })
    if (!spec) return c.json(401, { active: false, error: 'invalid_token', detail: `Bearer ${bearer}` })
    if (await applyScripted(c, this.book.next(`${spec.siret}|introspect`), `Bearer ${bearer}`)) return
    let token: unknown
    try {
      token = JSON.parse(c.req.body).token
    } catch {
      token = undefined
    }
    if (token !== spec.key) return c.json(400, { error: 'invalid_request', detail: `body ${c.req.body}` })
    c.json(200, this.introspectBody ? this.introspectBody(spec) : { active: true, company_id: spec.companyId, scope: 'collaborators:read contracts:read time:read', client_id: 'fake-client' })
  }

  private async api(c: Ctx): Promise<void> {
    const m = /^\/companies(-fr)?\/([^/]+)(?:\/(collaborators|contracts-fr|absences))?$/.exec(c.req.path)
    const endpoint = !m
      ? undefined
      : m[1] && !m[3]
        ? 'company'
        : !m[1] && m[3] === 'collaborators'
          ? 'collaborators'
          : !m[1] && m[3] === 'contracts-fr'
            ? 'contracts'
            : !m[1] && m[3] === 'absences'
              ? 'absences'
              : undefined
    if (c.req.method !== 'GET' || !m || !endpoint) return c.json(404, { error: 'not_found' })
    const bearer = /^Bearer (.+)$/.exec(String(c.req.headers.authorization ?? ''))?.[1]
    if (!bearer || !this.companies.some((x) => x.key === bearer)) return c.json(401, { error: 'unauthorized', detail: `Bearer ${bearer}` })
    const spec = this.companies.find((x) => x.companyId === decodeURIComponent(m[2]))
    if (!spec) return c.json(404, { error: 'company_not_found' })
    if (bearer !== spec.key) return c.json(403, { error: 'forbidden', detail: `Bearer ${bearer}` })
    if (await applyScripted(c, this.book.next(`${spec.siret}|${endpoint}`), `Bearer ${bearer}`)) return

    const url = new URL(`http://x${c.req.path}${c.req.search}`)
    if (endpoint === 'company') {
      const body: Record<string, unknown> = { id: spec.companyId, identificationNumber: spec.identificationNumber ?? spec.siret, siret: '00000000000000' }
      if (spec.name !== undefined) body.name = spec.name
      return c.json(200, body)
    }
    const max = Number(url.searchParams.get('maxResults') ?? 10)
    if (!Number.isInteger(max) || max < 1 || max > 50) return c.json(400, { error: 'invalid_max_results' })
    let all: unknown[]
    let key: string
    if (endpoint === 'collaborators') {
      key = 'collaborators'
      all = spec.collaborators.map((x) => ({ ...x }))
    } else if (endpoint === 'contracts') {
      key = 'contracts'
      all = spec.contracts.map((x) => ({ contractId: x.contractId, collaboratorId: x.collaboratorId, startDate: x.startDate, endDate: x.endDate, status: x.status ?? 'ACTIVE', firstName: 'Leurre', lastName: 'Deprecie' }))
    } else {
      key = 'absences'
      const status = url.searchParams.get('status') ?? 'approved'
      const begin = url.searchParams.get('beginDate')
      const end = url.searchParams.get('endDate')
      const contract = url.searchParams.get('contractId')
      all = spec.absences
        .filter((a) => status === 'all' || a.status === status)
        .filter((a) => !begin || a.endDate >= begin)
        .filter((a) => !end || a.startDate <= end)
        .filter((a) => !contract || a.contractId === contract)
        .map((a) => ({ id: a.id, contractId: a.contractId, startDate: { date: a.startDate, moment: a.startMoment }, endDate: { date: a.endDate, moment: a.endMoment }, type: a.type, status: a.status }))
    }
    if (this.cyclic) return c.json(200, { meta: { nextPageToken: 'loop' }, [key]: all.slice(0, 1) })
    const token = url.searchParams.get('nextPageToken')
    const offset = token ? Number(/^p(\d+)$/.exec(token)?.[1] ?? NaN) : 0
    if (Number.isNaN(offset)) return c.json(400, { error: 'invalid_page_token' })
    const next = offset + max < all.length ? `p${offset + max}` : null
    c.json(200, { meta: { nextPageToken: next }, [key]: all.slice(offset, offset + max) })
  }
}

/** Deux sociétés alignées sur `seedWorld()` : `co-a` (SIRET A, contrats ct-a1 et ct-a2) et `co-b` (SIRET B, contrat ct-b1). */
export function payfitWorld(absencesA: PfAbs[] = [], absencesB: PfAbs[] = []): PayfitFake {
  const f = new PayfitFake()
  f.companies = [
    {
      siret: SIRET_A,
      key: payfitKey(SIRET_A),
      companyId: 'co-a',
      name: 'Société A',
      collaborators: [
        { id: 'emp-ct-a1', firstName: 'Léa', lastName: 'Martin' },
        { id: 'emp-ct-a2', firstName: 'Noé', lastName: 'Petit' },
      ],
      contracts: [
        { contractId: 'ct-a1', collaboratorId: 'emp-ct-a1', startDate: '2020-01-01', endDate: null },
        { contractId: 'ct-a2', collaboratorId: 'emp-ct-a2', startDate: '2020-01-01', endDate: null },
      ],
      absences: absencesA,
    },
    {
      siret: SIRET_B,
      key: payfitKey(SIRET_B),
      companyId: 'co-b',
      name: 'Société B',
      collaborators: [{ id: 'emp-ct-b1', firstName: 'Zoé', lastName: 'Durand' }],
      contracts: [{ contractId: 'ct-b1', collaboratorId: 'emp-ct-b1', startDate: '2020-01-01', endDate: null }],
      absences: absencesB,
    },
  ]
  return f
}

// ───────────────────────────── Aqoona ─────────────────────────────

export interface AqEntry {
  index: number
  label: string
  hasLabel: boolean
  url: string
  /** Adresse sans la partie qui suit `?` (pour le montage du serveur factice). */
  bare: string
  /** Valeurs secrètes à ne jamais retrouver ailleurs que dans la configuration. */
  secrets: string[]
  /** Forme masquée attendue de `addresses[].masked`. */
  masked: string
}

export function aqoonaEntries(): AqEntry[] {
  const raw = envJson<Array<{ label?: string; url: string }>>('AQOONA_URLS')
  return raw.map((e, index) => {
    const u = new URL(e.url)
    const secrets = new Set<string>([e.url, u.search.slice(1)])
    u.searchParams.forEach((v) => {
      if (v.length >= 6) secrets.add(v)
    })
    return {
      index,
      label: e.label ?? `Adresse ${index + 1}`,
      hasLabel: e.label !== undefined,
      url: e.url,
      bare: `${u.origin}${u.pathname}`,
      secrets: [...secrets].filter((s) => s.length >= 6),
      masked: `${u.origin}${u.pathname}?…`,
    }
  })
}

export interface AqReply {
  status?: number
  body?: unknown
  raw?: string
  headers?: Record<string, string>
  delayMs?: number
  hang?: boolean
  /** Réponse JSON de plus de `bytes` octets, envoyée en flux. */
  bytes?: number
  redirectTo?: string
}

/**
 * Ligne Aqoona au format « Pros » du fichier de correspondance de la recette (`acceptance/fixtures/aqoona-mapping.test.json`,
 * noms de champ de generateMicrostarsPlanningPros.php, v3 : rule-evp-aqoona-root-array, rule-evp-aqoona-mapping-final).
 * `matricule` alimente `user_matricule`, qui ne sert qu'à porter un NIR éventuel : `person_ref` vaut « Prénom NOM ».
 */
export function aqRow(o: { matricule?: string | null; prenom?: string; nom?: string; creche?: string; day?: string; jour?: string; debut?: string; fin?: string }) {
  return {
    user_firstname: o.prenom ?? 'Léa',
    user_lastname: o.nom ?? 'Martin',
    user_matricule: o.matricule ?? '',
    etablissement_name: o.creche ?? 'CRÈCHE ALPHA !!',
    planning_days_date: o.day ?? o.jour ?? d(-3),
    planning_days_heure_debut: o.debut ?? '08:00',
    planning_days_heure_fin: o.fin ?? '16:00',
    planning_days_type_creneau: 'Garde',
  }
}
/** La réponse est un tableau JSON à la racine, une ligne par créneau. */
export const aqBody = (rows: unknown[]) => rows

/** Fichier de correspondance alternatif : tableau à la racine, jours `JJ/MM/AAAA`, heures `HH:mm:ss`. */
export const AQ_ALT_MAPPING = {
  records: '',
  fields: { matricule: 'mat', prenom: 'first', nom: 'last', creche: 'site', jour: 'day', debut: 'from', fin: 'to' },
  dayFormat: 'DD/MM/YYYY',
  timeFormat: 'HH:mm:ss',
}

export class AqoonaFake {
  readonly entries = aqoonaEntries()
  private replies: AqReply[][] = this.entries.map(() => [])
  private sticky: AqReply[] = this.entries.map(() => ({ body: aqBody([]) }))

  reset(): void {
    this.replies = this.entries.map(() => [])
    this.sticky = this.entries.map(() => ({ body: aqBody([]) }))
  }
  /** Réponse permanente d'une adresse. */
  set(i: number, r: AqReply): void {
    this.sticky[i] = r
  }
  setAll(r: AqReply): void {
    this.entries.forEach((_, i) => this.set(i, r))
  }
  /** Réponses successives d'une adresse, puis la réponse permanente. */
  queue(i: number, ...r: AqReply[]): void {
    this.replies[i].push(...r)
  }

  async mount(net: FakeNet): Promise<void> {
    for (const e of this.entries) {
      await net.mount(`aqoona-${e.index}`, e.bare, async (c) => {
        // v3 (rule-evp-aqoona-window-params): the API adds dateBegin and dateEnd to the configured address; only the token is checked.
        if (new URLSearchParams(c.req.search).get('token') !== new URL(e.url).searchParams.get('token')) return c.json(403, { error: 'bad token', detail: c.req.search })
        const r = this.replies[e.index].shift() ?? this.sticky[e.index]
        if (r.delayMs) await sleep(r.delayMs)
        if (r.hang) return c.hang()
        if (r.redirectTo) return c.send(302, '', { location: r.redirectTo })
        if (r.bytes) {
          c.res.writeHead(r.status ?? 200, { 'content-type': 'application/json' })
          const row = JSON.stringify(aqRow({}))
          c.res.write('[')
          let written = 0
          let first = true
          while (written < r.bytes && !c.res.destroyed) {
            const chunk = (first ? '' : ',') + row
            first = false
            written += chunk.length
            if (!c.res.write(chunk)) await new Promise<void>((resolve) => c.res.once('drain', () => resolve()))
          }
          if (!c.res.destroyed) c.res.end(']')
          return
        }
        if (r.raw !== undefined) return c.send(r.status ?? 200, r.raw, { 'content-type': 'text/html', ...r.headers })
        c.json(r.status ?? 200, r.body ?? { status: r.status, detail: `échec pour ${e.url}` }, r.headers)
      })
    }
  }
}

// ───────────────────────────── secrets ─────────────────────────────

/** Toutes les valeurs secrètes de la configuration de test, à ne retrouver dans aucune sortie de l'API. */
export function configuredSecrets(): string[] {
  const out = new Set<string>()
  const add = (s: string | undefined) => {
    if (s && s.length >= 6) out.add(s)
  }
  for (const e of envJson<Array<{ apiKey: string }>>('PAYFIT_API_KEYS')) add(e.apiKey)
  for (const a of aqoonaEntries()) a.secrets.forEach(add)
  add(envOpt('GOOGLE_CLIENT_SECRET'))
  const pem = sheetsEnv().privateKeyPem.split('\n').filter((l) => l.length > 40 && !l.startsWith('-----'))
  add(pem[0])
  add('fake-sheets-token')
  add('ya29.fake-access')
  return [...out]
}

export function expectNoSecret(label: string, text: string, secrets: string[] = configuredSecrets()): void {
  for (const s of secrets) {
    expect({ label, containsSecret: text.includes(s), secretStart: s.slice(0, 4) }).toEqual({ label, containsSecret: false, secretStart: s.slice(0, 4) })
  }
}

/** Contenu textuel de tout ce que l'API montre ou stocke à propos des lectures : à passer à `expectNoSecret`. */
export async function everythingVisible(
  token: string,
  deps: { GET: (p: string, t?: string) => Promise<R>; POST: (p: string, t?: string, b?: unknown) => Promise<R>; sql: (q: string) => Promise<any[]> },
): Promise<string> {
  const parts: string[] = []
  parts.push((await deps.GET('/sources', token)).text)
  for (const key of ['sheets', 'payfit', 'aqoona']) parts.push((await deps.GET(`/sources/${key}/anomalies?size=50`, token)).text)
  parts.push((await deps.GET('/journal-entries?size=50', token)).text)
  parts.push((await deps.GET('/notifications', token)).text)
  parts.push((await deps.POST('/exports/absences', token, { from: d(-60), to: d(60) })).text)
  for (const t of ['source_runs', 'source_anomalies', 'audit_logs', 'notifications', 'aqoona_plannings', 'aqoona_mismatches']) {
    parts.push(JSON.stringify(await deps.sql(`select x::text as t from base.${t} x`)))
  }
  return parts.join('\n')
}

export { SIRET_A, SIRET_B }
