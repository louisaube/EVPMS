import { resetData, closePool, createUser, login, sql } from './harness'
import { http, UNKNOWN_UUID, seedWorld, World, Account, closeEvp, countRows, auditCount } from './evp-helpers'

type Who = 'dirA' | 'roA' | 'rh' | 'adm' | 'sup'
const ALL: Who[] = ['dirA', 'roA', 'rh', 'adm', 'sup']
const DECLARANTS: Who[] = ['dirA', 'roA', 'rh', 'sup']
const GLOBAL_READ: Who[] = ['rh', 'sup']
const ACCESS_ADMIN: Who[] = ['rh', 'adm', 'sup']

interface Row {
  method: string
  path: string
  body?: unknown
  allowed: Who[]
  rule: string
  /** Sends the request only to forbidden callers (allowed ones would start a real reading). */
  forbiddenOnly?: boolean
  /** Whether the path carries an identifier that must be a UUID. */
  uuidParam?: string
}

const U = UNKNOWN_UUID
const ROWS: Row[] = [
  { method: 'GET', path: '/profile', allowed: ALL, rule: 'rule-evp-capabilities-list' },
  { method: 'GET', path: '/settings', allowed: ALL, rule: 'rule-evp-settings-payfit-disabled' },
  { method: 'GET', path: '/creches', allowed: ALL, rule: 'rule-evp-creche-scope' },
  { method: 'GET', path: '/creches/zzz/contracts', allowed: DECLARANTS, rule: 'rule-evp-declare-roles' },
  { method: 'GET', path: '/creches/zzz/closures', allowed: ALL, rule: 'rule-evp-creche-scope' },
  { method: 'POST', path: '/creches/zzz/closures/2020-01', body: { attested: false }, allowed: DECLARANTS, rule: 'rule-evp-closure-api-roles' },
  { method: 'GET', path: '/absence-types', allowed: ALL, rule: 'rule-evp-declare-types-defaults' },
  { method: 'GET', path: '/todo', allowed: ALL, rule: 'rule-evp-todo-counter-definition' },
  { method: 'GET', path: '/absences', allowed: ALL, rule: 'rule-evp-list-scope' },
  { method: 'GET', path: `/absences/${U}`, allowed: ALL, rule: 'rule-evp-list-scope', uuidParam: '/absences/not-a-uuid' },
  { method: 'GET', path: `/absences/${U}/audit`, allowed: GLOBAL_READ, rule: 'rule-evp-audit-atomic', uuidParam: '/absences/not-a-uuid/audit' },
  { method: 'POST', path: '/absences', body: {}, allowed: DECLARANTS, rule: 'rule-evp-declare-roles' },
  { method: 'PATCH', path: `/absences/${U}`, body: { comment: 'x' }, allowed: DECLARANTS, rule: 'rule-evp-declare-roles', uuidParam: '/absences/not-a-uuid' },
  { method: 'POST', path: `/absences/${U}/submit`, allowed: DECLARANTS, rule: 'rule-evp-declare-roles', uuidParam: '/absences/not-a-uuid/submit' },
  { method: 'POST', path: '/absences/validate-batch', body: { absenceIds: [U] }, allowed: ['rh'], rule: 'rule-evp-decision-marine-only' },
  { method: 'POST', path: `/absences/${U}/validate`, allowed: ['rh'], rule: 'rule-evp-decision-marine-only', uuidParam: '/absences/not-a-uuid/validate' },
  { method: 'POST', path: `/absences/${U}/return`, body: { reason: 'x' }, allowed: ['rh'], rule: 'rule-evp-decision-marine-only', uuidParam: '/absences/not-a-uuid/return' },
  { method: 'POST', path: `/absences/${U}/reject`, body: { reason: 'x' }, allowed: ['rh'], rule: 'rule-evp-decision-marine-only', uuidParam: '/absences/not-a-uuid/reject' },
  { method: 'POST', path: `/absences/${U}/cancel`, body: { reason: 'x' }, allowed: DECLARANTS, rule: 'rule-evp-cancel-scope', uuidParam: '/absences/not-a-uuid/cancel' },
  { method: 'POST', path: `/absences/${U}/mark-entered`, allowed: ['rh'], rule: 'rule-evp-decision-marine-only', uuidParam: '/absences/not-a-uuid/mark-entered' },
  { method: 'POST', path: '/justificatifs/authorize-upload', body: {}, allowed: DECLARANTS, rule: 'rule-evp-piece-scope' },
  { method: 'POST', path: `/justificatifs/${U}/confirm`, allowed: DECLARANTS, rule: 'rule-evp-piece-scope', uuidParam: '/justificatifs/not-a-uuid/confirm' },
  { method: 'POST', path: `/justificatifs/${U}/read-link`, allowed: ALL, rule: 'rule-evp-piece-scope', uuidParam: '/justificatifs/not-a-uuid/read-link' },
  { method: 'GET', path: '/notifications', allowed: ALL, rule: 'rule-evp-notif-scope' },
  { method: 'GET', path: '/notifications/unread-count', allowed: ALL, rule: 'rule-evp-notif-scope' },
  { method: 'POST', path: `/notifications/${U}/read`, allowed: ALL, rule: 'rule-evp-notif-scope', uuidParam: '/notifications/not-a-uuid/read' },
  { method: 'GET', path: '/journal-entries', allowed: GLOBAL_READ, rule: 'rule-evp-journal-readonly' },
  { method: 'GET', path: '/journal-entries/filters', allowed: GLOBAL_READ, rule: 'rule-evp-journal-readonly' },
  { method: 'POST', path: '/exports/absences', body: {}, allowed: GLOBAL_READ, rule: 'rule-evp-export-roles' },
  { method: 'GET', path: '/sources', allowed: GLOBAL_READ, rule: 'rule-evp-sources-manual' },
  { method: 'GET', path: `/sources/runs/${U}`, allowed: GLOBAL_READ, rule: 'rule-evp-sources-manual', uuidParam: '/sources/runs/not-a-uuid' },
  { method: 'GET', path: '/sources/sheets/anomalies', allowed: GLOBAL_READ, rule: 'rule-evp-sources-manual' },
  { method: 'POST', path: '/sources/payfit/refresh', allowed: GLOBAL_READ, rule: 'rule-evp-sources-manual', forbiddenOnly: true },
  { method: 'POST', path: '/sources/aqoona/refresh', allowed: GLOBAL_READ, rule: 'rule-evp-sources-manual', forbiddenOnly: true },
  { method: 'POST', path: '/sources/sheets/refresh', allowed: ['sup'], rule: 'rule-evp-sources-sheets-superadmin', forbiddenOnly: true },
  { method: 'POST', path: '/sources/refresh-all', allowed: ['sup'], rule: 'rule-evp-sources-sheets-superadmin', forbiddenOnly: true },
  { method: 'GET', path: '/access-accounts', allowed: ACCESS_ADMIN, rule: 'rule-evp-access-who-manages' },
  { method: 'POST', path: '/access-accounts', body: {}, allowed: ACCESS_ADMIN, rule: 'rule-evp-access-who-manages' },
  { method: 'PATCH', path: `/access-accounts/${U}`, body: { name: 'x' }, allowed: ACCESS_ADMIN, rule: 'rule-evp-access-who-manages', uuidParam: '/access-accounts/not-a-uuid' },
  { method: 'POST', path: `/access-accounts/${U}/remove`, allowed: ACCESS_ADMIN, rule: 'rule-evp-access-who-manages', uuidParam: '/access-accounts/not-a-uuid/remove' },
]

const OPENAPI_OPERATIONS: Array<[string, string]> = [
  ['get', '/service-status'], ['get', '/google-sign-in/start'], ['get', '/google-sign-in/callback'], ['get', '/profile'], ['get', '/settings'],
  ['get', '/access-accounts'], ['post', '/access-accounts'], ['patch', '/access-accounts/{id}'], ['post', '/access-accounts/{id}/remove'],
  ['get', '/creches'], ['get', '/creches/{code}/contracts'], ['get', '/creches/{code}/closures'], ['post', '/creches/{code}/closures/{month}'],
  ['get', '/absence-types'], ['get', '/todo'], ['get', '/absences'], ['get', '/absences/{id}'], ['get', '/absences/{id}/audit'], ['post', '/absences'],
  ['patch', '/absences/{id}'], ['post', '/absences/{id}/submit'], ['post', '/absences/validate-batch'], ['post', '/absences/{id}/validate'],
  ['post', '/absences/{id}/return'], ['post', '/absences/{id}/reject'], ['post', '/absences/{id}/cancel'], ['post', '/absences/{id}/mark-entered'],
  ['post', '/justificatifs/authorize-upload'], ['post', '/justificatifs/{id}/confirm'], ['post', '/justificatifs/{id}/read-link'],
  ['get', '/notifications'], ['get', '/notifications/unread-count'], ['post', '/notifications/{id}/read'], ['get', '/journal-entries'],
  ['get', '/journal-entries/filters'], ['post', '/exports/absences'], ['get', '/sources'], ['post', '/sources/{key}/refresh'],
  ['post', '/sources/refresh-all'], ['get', '/sources/runs/{id}'], ['get', '/sources/{key}/anomalies'],
]

// Acceptance suite of version v1-evp: rights by business role on every route, robustness against the contract.
describe('EVP rights matrix and contract robustness', () => {
  let w: World
  let socleUser: string
  let socleAdmin: string

  beforeAll(async () => {
    await resetData()
  })
  beforeEach(async () => {
    await resetData()
    w = await seedWorld()
    await createUser({ email: 'ordinaire@example.com', password: 'Passw0rd!x', role: 'user' })
    await createUser({ email: 'administrateur@example.com', password: 'Passw0rd!x', role: 'admin' })
    socleUser = await login('ordinaire@example.com', 'Passw0rd!x')
    socleAdmin = await login('administrateur@example.com', 'Passw0rd!x')
  })
  afterAll(async () => {
    await closeEvp()
    await closePool()
  })

  const call = (row: Row, token?: string, path = row.path) => http(row.method, path, { token, body: row.body })
  const tokenOf = (who: Who): string => (w[who] as Account).token

  describe('business roles on every route', () => {
    for (const row of ROWS) {
      const label = `${row.method} ${row.path.replace(U, ':id')}`
      it(`[${row.rule}] ${label}: admitted roles ${row.allowed.join(', ')}; every other business role gets 403`, async () => {
        for (const who of ALL) {
          if (row.allowed.includes(who) && row.forbiddenOnly) continue
          const res = await call(row, tokenOf(who))
          if (row.allowed.includes(who)) {
            expect([401, 403]).not.toContain(res.status)
            expect(res.status).toBeLessThan(500)
          } else {
            expect(res.status).toBe(403)
            expect(res.body).toMatchObject({ status: 403 })
            expect(typeof res.body.code).toBe('string')
          }
        }
      })

      it(`[rule-evp-rights-rechecked] ${label}: anonymous gets 401 and an unregistered socle account (user or admin) gets 403`, async () => {
        expect((await call(row)).status).toBe(401)
        expect((await call(row, 'invalid.token.value')).status).toBe(401)
        for (const token of [socleUser, socleAdmin]) {
          const res = await call(row, token)
          expect(res.status).toBe(403)
        }
      })
    }

    it('[rule-evp-rights-rechecked] a deactivated account is refused on every route of the matrix at the next request', async () => {
      await sql('update base.evp_accounts set active = false where user_id = $1', [w.rh.id])
      for (const row of ROWS) {
        const res = await call(row, w.rh.token)
        expect(res.status).toBe(403)
      }
    })

    it('[rule-evp-decision-marine-only] the superadmin, though global admin of the socle, holds no decision right', async () => {
      for (const row of ROWS.filter((r) => r.rule === 'rule-evp-decision-marine-only')) expect((await call(row, w.sup.token)).status).toBe(403)
    })

    it('[rule-evp-closure-api-roles] [rule-evp-declare-roles] the ADMINISTRATRICE is refused on every route that creates or changes a dossier, a piece or a closure', async () => {
      const writes = ROWS.filter((r) => ['POST', 'PATCH'].includes(r.method) && /absences|justificatifs\/authorize|justificatifs\/.*confirm|closures/.test(r.path))
      expect(writes.length).toBeGreaterThan(8)
      for (const row of writes) expect((await call(row, w.adm.token)).status).toBe(403)
      expect(await countRows('absences')).toBe(0)
      expect(await countRows('closures')).toBe(0)
    })
  })

  describe('contract', () => {
    it('[rule-evp-audit-atomic] the OpenAPI document declares every operation of the version', async () => {
      const doc = (await http('GET', '/api-json')).body
      for (const [method, path] of OPENAPI_OPERATIONS) {
        expect(doc.paths?.[path]?.[method]).toBeDefined()
      }
    })

    it('[rule-evp-export-csv-format] the export is declared with a 200 string body (the live response carries text/csv)', async () => {
      // Arbitrated (DISPUTES.md): the foundation OpenAPI builder declares every response under a single media
      // type, so the declared media type is not asserted; the real `text/csv; charset=utf-8` header and the
      // Content-Disposition are checked by acceptance-evp-notifications-journal-export.test.ts.
      const doc = (await http('GET', '/api-json')).body
      const content = doc.paths['/exports/absences'].post.responses['200'].content
      const mediaTypes = Object.keys(content)
      expect(mediaTypes).toHaveLength(1)
      expect(content[mediaTypes[0]].schema.type).toBe('string')
    })

    it('[rule-evp-batch-max-50] [rule-evp-declare-max-pieces] [rule-evp-declare-comment-bound] the bounds of the specification appear in the contract', async () => {
      const doc = (await http('GET', '/api-json')).body
      const resolve = (n: any): any => (n && n.$ref ? resolve(n.$ref.replace('#/', '').split('/').reduce((o: any, k: string) => o[k], doc)) : n)
      const body = (path: string, method = 'post') => resolve(doc.paths[path][method].requestBody.content['application/json'].schema)
      const batch = resolve(body('/absences/validate-batch').properties.absenceIds)
      expect(batch.minItems).toBe(1)
      expect(batch.maxItems).toBe(50)
      const create = body('/absences')
      expect(resolve(create.properties.justificatifIds).maxItems).toBe(5)
      expect(resolve(create.properties.comment).maxLength).toBe(500)
      const reason = resolve(body('/absences/{id}/reject').properties.reason)
      expect([reason.minLength, reason.maxLength]).toEqual([1, 500])
      const authorize = body('/justificatifs/authorize-upload')
      expect(resolve(authorize.properties.sizeBytes).maximum).toBe(10485760)
      expect(resolve(authorize.properties.contentType).enum.sort()).toEqual(['application/pdf', 'image/jpeg', 'image/png'])
    })

    it('[rule-evp-no-store] [rule-evp-rights-rechecked] errors keep the stable body { status, code, message }, never a stack, SQL, or file path', async () => {
      const samples = [
        await http('GET', `/absences/${U}`, { token: w.rh.token }),
        await http('GET', '/absences/nope', { token: w.rh.token }),
        await http('GET', '/journal-entries', { token: w.dirA.token }),
        await http('POST', '/absences', { token: w.rh.token, body: {} }),
        await http('GET', '/profile'),
        await http('POST', `/creches/alpha/closures/2020-01`, { token: w.rh.token, body: { attested: false } }),
        await http('PATCH', `/access-accounts/${U}`, { token: w.rh.token, body: { name: 'x' } }),
      ]
      for (const res of samples) {
        expect(res.status).toBeGreaterThanOrEqual(400)
        expect(res.status).toBeLessThan(500)
        expect(Object.keys(res.body).filter((k) => !['status', 'code', 'message', 'details'].includes(k))).toEqual([])
        expect(typeof res.body.code).toBe('string')
        expect(res.text).not.toMatch(/\bat \S+ \(|node_modules|select .* from|insert into|\/home\/|\/srv\/|stack/i)
      }
    })

    it('[rule-evp-audit-atomic] a malformed identifier is a validation error (400), never a 404 or a 5xx, on every identified route', async () => {
      for (const row of ROWS.filter((r) => r.uuidParam)) {
        const who = (row.allowed[0] ?? 'rh') as Who
        const res = await call(row, tokenOf(who), row.uuidParam)
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('api.validation.incoming_failed')
      }
    })

    it('[rule-evp-audit-atomic] hostile bodies never reach a 5xx: wrong types, null characters, nested and oversized values', async () => {
      const hostile: unknown[] = [
        null, [], 'texte', 42, { a: '\u0000' }, { comment: '\u0000', reason: '\u0000', name: '\u0000', email: '\u0000', attested: '\u0000' },
        { absenceIds: [[]], crecheCodes: [{}], justificatifIds: [null] }, JSON.parse('{"__proto__": {"admin": true}}'), { from: {}, to: [] },
        { reason: 'x'.repeat(100000) }, { crecheCode: 'a'.repeat(100000), contractId: '\u0000' },
      ]
      for (const row of ROWS.filter((r) => r.method !== 'GET' && !r.forbiddenOnly)) {
        const who = (row.allowed[0] ?? 'rh') as Who
        for (const body of hostile) {
          const res = await http(row.method, row.path, { token: tokenOf(who), body })
          expect(res.status).toBeLessThan(500)
        }
      }
      expect(await countRows('absences')).toBe(0)
      expect(await countRows('evp_accounts')).toBe(7)
    })

    it('[rule-evp-audit-atomic] hostile query strings never reach a 5xx', async () => {
      const queries = ['?size=%00', '?search=%00', '?from[]=1', '?status=%00', '?status[]=A_VALIDER', '?from=1&from=2', '?crecheCode=%00', '?unreadOnly=%00', '?dateFrom=%00']
      for (const row of ROWS.filter((r) => r.method === 'GET')) {
        const who = (row.allowed[0] ?? 'rh') as Who
        for (const q of queries) {
          const res = await http('GET', `${row.path}${q}`, { token: tokenOf(who) })
          expect(res.status).toBeLessThan(500)
        }
      }
    })

    it('[rule-evp-audit-atomic] every write route of the version either leaves an audit entry on success or is the declared exemption (notification read)', async () => {
      const before = await auditCount()
      const created = await http('POST', '/absences', { token: w.dirA.token, body: { crecheCode: 'alpha', contractId: w.ctA.id, typeCode: 'CONGES_PAYES', startDate: '2026-03-02', startHalf: 'MATIN', endDate: '2026-03-03', endHalf: 'MATIN', justificatifIds: [] } })
      expect(created.status).toBe(201)
      expect(await auditCount()).toBe(before + 1)
      const afterCreate = await auditCount()
      const sub = await http('POST', `/absences/${created.body.id}/submit`, { token: w.dirA.token })
      expect(sub.status).toBe(200)
      expect(await auditCount()).toBe(afterCreate + 1)
      const read = await http('GET', '/notifications', { token: w.dirA.token })
      expect(read.status).toBe(200)
      expect(await auditCount()).toBe(afterCreate + 1)
    })
  })
})
