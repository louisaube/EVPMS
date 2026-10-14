import { resetData, closePool, sql, createUser, login } from './harness'
import { logSince, logSize } from './renfort-helpers'
import {
  http, GET, POST, PATCH, qs, UNKNOWN_UUID, seedWorld, seedAccount, seedCreche, World, Account, forgeSession,
  auditRows, auditCount, countRows, assignmentInvariantViolations, envSecrets, allKeys, sortedKeys, closeEvp,
} from './evp-helpers'

// Acceptance suite of version v1-evp: service status, Google sign-in, session, profile, capabilities, settings,
// access administration (RO and directrices).
describe('EVP access, session, profile and settings', () => {
  let w: World

  beforeEach(async () => {
    await resetData()
    w = await seedWorld()
  })
  afterAll(async () => {
    await closeEvp()
    await closePool()
  })

  const CAPS: Record<string, string[]> = {
    DIRECTRICE: ['absences:create', 'closures:attest', 'notifications:read', 'profile:read', 'settings:read'],
    RO: ['absences:create', 'notifications:read', 'profile:read', 'settings:read'],
    RH: [
      'absences:create', 'absences:decide', 'access:manage:ro', 'export:run', 'journal:read', 'notifications:read', 'profile:read',
      'settings:read', 'sources:read', 'sources:refresh:aqoona', 'sources:refresh:payfit',
    ],
    ADMINISTRATRICE: ['access:manage:ro', 'notifications:read', 'profile:read', 'settings:read'],
    SUPERADMIN: [
      'absences:create', 'access:manage:directrice', 'access:manage:ro', 'export:run', 'journal:read', 'notifications:read',
      'profile:read', 'settings:read', 'sources:read', 'sources:refresh:aqoona', 'sources:refresh:payfit', 'sources:refresh:sheets',
    ],
  }

  // ───────────────────────────── GET /service-status ─────────────────────────────
  describe('GET /service-status', () => {
    it('[rule-evp-login-service-status] is public, answers 200 with exactly status, reason and message and no HR data', async () => {
      await seedAccount('RH', { name: 'Personne Secrète' })
      const res = await GET('/service-status')
      expect(res.status).toBe(200)
      expect(sortedKeys(res.body)).toEqual(['message', 'reason', 'status'])
      expect(['ready', 'unavailable']).toContain(res.body.status)
      expect(typeof res.body.message).toBe('string')
      expect(res.body.message.length).toBeLessThanOrEqual(300)
      if (res.body.status === 'ready') expect(res.body.reason).toBeNull()
      else expect(['google_not_configured', 'database_unreachable', 'maintenance']).toContain(res.body.reason)
      expect(res.text).not.toContain('Personne Secrète')
      expect(res.text).not.toContain('micro-stars.fr')
    })

    it('[rule-evp-login-service-status] answers the same shape to a signed-in caller and never a 5xx', async () => {
      const res = await GET('/service-status', w.rh.token)
      expect(res.status).toBe(200)
      expect(sortedKeys(res.body)).toEqual(['message', 'reason', 'status'])
    })
  })

  // ───────────────────────────── Google sign-in ─────────────────────────────
  describe('Google sign-in', () => {
    it('[rule-evp-login-service-status] [rule-evp-login-no-secret-in-studio] start redirects to Google with hd, PKCE and minimal scopes when configured, else 503 platform.service_unavailable', async () => {
      const status = (await GET('/service-status')).body
      const res = await http('GET', '/google-sign-in/start')
      if (status.reason === 'google_not_configured') {
        expect(res.status).toBe(503)
        expect(res.body.code).toBe('platform.service_unavailable')
        return
      }
      expect(res.status).toBe(302)
      const location = new URL(res.headers.get('location')!)
      expect(location.hostname).toMatch(/google/)
      expect(location.searchParams.get('hd')).toBe('micro-stars.fr')
      expect(location.searchParams.get('state')).toBeTruthy()
      expect(location.searchParams.get('code_challenge')).toBeTruthy()
      expect(location.searchParams.get('code_challenge_method')).toBe('S256')
      const scopes = (location.searchParams.get('scope') ?? '').split(/\s+/).sort()
      expect(scopes).toEqual(['email', 'openid', 'profile'])
      expect(res.headers.get('set-cookie') ?? '').toMatch(/HttpOnly/i)
    })

    it('[rule-evp-login-safe-redirect] start never answers 5xx for a dangerous or oversized redirection and never reflects it in a 2xx body', async () => {
      for (const redirection of ['//evil.example', 'https://evil.example', '/\\evil.example', 'javascript:alert(1)', `/${'a'.repeat(300)}`, '']) {
        const res = await http('GET', `/google-sign-in/start${qs({ redirection })}`)
        expect([302, 400, 503]).toContain(res.status)
        const location = res.headers.get('location') ?? ''
        expect(location).not.toContain('evil.example')
      }
    })

    it('[rule-evp-login-single-denial] callback with a Google error redirects to /connexion?erreur=annule, never JSON, never a session cookie', async () => {
      const res = await http('GET', `/google-sign-in/callback${qs({ error: 'access_denied', state: 'x', code: 'y' })}`)
      expect(res.status).toBe(302)
      const location = new URL(res.headers.get('location')!, 'http://studio.invalid')
      expect(location.pathname).toBe('/connexion')
      expect(location.searchParams.get('erreur')).toBe('annule')
      expect(res.headers.get('location')).not.toContain('access_denied')
      expect(res.text).toBe('')
      expect(res.headers.get('set-cookie') ?? '').not.toMatch(/-jwt-/)
    })

    it('[rule-evp-login-domain-not-enough] [rule-evp-login-no-secret-in-studio] callback with a forged state redirects to /connexion?erreur=echec and opens no session', async () => {
      const res = await http('GET', `/google-sign-in/callback${qs({ code: 'forged-code', state: 'forged.state.value' })}`)
      expect(res.status).toBe(302)
      const location = new URL(res.headers.get('location')!, 'http://studio.invalid')
      expect(location.pathname).toBe('/connexion')
      expect(['echec', 'domaine', 'non_autorise']).toContain(location.searchParams.get('erreur'))
      expect(location.searchParams.get('erreur')).toBe('echec')
      expect(res.text).toBe('')
      expect(res.headers.get('set-cookie') ?? '').not.toMatch(/-jwt-/)
    })

    it('[rule-evp-login-domain-not-enough] callback with oversized or missing query is refused without a stack (400 validation or redirection), never 5xx', async () => {
      for (const q of [qs({ code: 'x'.repeat(2049), state: 'y' }), qs({ code: 'x', state: 'y'.repeat(2049) }), '']) {
        const res = await http('GET', `/google-sign-in/callback${q}`)
        expect(res.status).toBeLessThan(500)
        expect([302, 400]).toContain(res.status)
        if (res.status === 400) expect(res.body.code).toBe('api.validation.incoming_failed')
      }
    })

    it('[rule-evp-login-google-only] POST /auth/login does not open a session for an EVP account, even with the right password', async () => {
      const acct = await seedAccount('RH', { email: 'pwd.rh@micro-stars.fr', password: 'Passw0rd!x' })
      const res = await http('POST', '/auth/login', { body: { email: acct.email, password: 'Passw0rd!x', returnToken: true } })
      expect(res.status).toBe(401)
      expect(res.body.code).toBe('security.invalid_credentials')
      expect(res.body.token).toBeUndefined()
      const cookie = await http('POST', '/auth/login', {
        body: { email: acct.email, password: 'Passw0rd!x', returnToken: false },
        headers: { origin: 'http://localhost:5173' },
      })
      expect(cookie.status).toBe(401)
      expect(cookie.headers.get('set-cookie') ?? '').not.toMatch(/-jwt-/)
    })

    it('[rule-evp-login-google-only] witness: the password login of a non-EVP socle account is unchanged', async () => {
      await createUser({ email: 'socle@example.com', password: 'Passw0rd!x', role: 'user' })
      expect(typeof (await login('socle@example.com', 'Passw0rd!x'))).toBe('string')
    })

    it('[rule-evp-login-google-only] a former EVP account (retired RO) cannot log in with a password either', async () => {
      const ro = await seedAccount('RO', { email: 'old.ro@micro-stars.fr', password: 'Passw0rd!x', active: false, removed: true })
      const res = await http('POST', '/auth/login', { body: { email: ro.email, password: 'Passw0rd!x', returnToken: true } })
      expect(res.status).toBe(401)
    })
  })

  // ───────────────────────────── session et droits relus ─────────────────────────────
  describe('session and rights', () => {
    it('[rule-evp-session-8h] a session token older than 8 hours is refused with 401', async () => {
      const old = await forgeSession(w.rh.id, 'user', { ageSeconds: 9 * 3600, lifetimeSeconds: 8 * 3600 })
      const res = await GET('/profile', old)
      expect(res.status).toBe(401)
    })

    it('[rule-evp-session-8h] a 24-hour token (password login lifetime) older than 8 hours is refused on a business route with 401 security.invalid_token', async () => {
      const longLived = await forgeSession(w.rh.id, 'user', { ageSeconds: 9 * 3600, lifetimeSeconds: 24 * 3600 })
      const res = await GET('/journal-entries', longLived)
      expect(res.status).toBe(401)
      expect(res.body.code).toBe('security.invalid_token')
    })

    it('[rule-evp-session-8h] profile announces the session end about 8 hours after issue', async () => {
      const res = await GET('/profile', w.rh.token)
      expect(res.status).toBe(200)
      const ms = Date.parse(res.body.sessionExpiresAt) - Date.now()
      expect(ms).toBeGreaterThan(7.9 * 3600 * 1000)
      expect(ms).toBeLessThanOrEqual(8 * 3600 * 1000 + 60000)
    })

    it('[rule-evp-rights-rechecked] a deactivated account is refused on the very next request with 403 access.account_inactive', async () => {
      expect((await GET('/profile', w.dirA.token)).status).toBe(200)
      await sql('update base.evp_accounts set active = false where user_id = $1', [w.dirA.id])
      const res = await GET('/profile', w.dirA.token)
      expect(res.status).toBe(403)
      expect(res.body.code).toBe('access.account_inactive')
      expect((await GET('/absences', w.dirA.token)).status).toBe(403)
    })

    it('[rule-evp-rights-rechecked] a role change in the database is taken into account without a new login', async () => {
      const before = await GET('/profile', w.roA.token)
      expect(before.body.role).toBe('RO')
      await sql("update base.evp_accounts set role = 'DIRECTRICE' where user_id = $1", [w.roA.id])
      const after = await GET('/profile', w.roA.token)
      expect(after.body.role).toBe('DIRECTRICE')
      expect([...after.body.capabilities].sort()).toEqual(CAPS.DIRECTRICE)
    })

    it('[rule-evp-rights-rechecked] an account that lost its crèches is refused with 403 access.not_authorized', async () => {
      await sql('delete from base.creche_assignments where user_id = $1', [w.dirA.id])
      const res = await GET('/profile', w.dirA.token)
      expect(res.status).toBe(403)
      expect(res.body.code).toBe('access.not_authorized')
    })

    it('[rule-evp-rights-rechecked] [rule-evp-login-domain-not-enough] an authenticated socle account that is not registered in EVP gets 403 access.not_authorized', async () => {
      await createUser({ email: 'stranger@micro-stars.fr', password: 'Passw0rd!x', role: 'user' })
      const token = await login('stranger@micro-stars.fr', 'Passw0rd!x')
      const res = await GET('/profile', token)
      expect(res.status).toBe(403)
      expect(res.body.code).toBe('access.not_authorized')
    })

    it('[rule-evp-rights-rechecked] an account with a registration but no assigned crèche (directrice) is refused, while a global role without crèche referential is accepted', async () => {
      const lonely = await seedAccount('DIRECTRICE', { creches: [] })
      expect((await GET('/profile', lonely.token)).status).toBe(403)
      await resetData()
      const sup = await seedAccount('SUPERADMIN')
      const rh = await seedAccount('RH')
      expect((await GET('/profile', sup.token)).status).toBe(200)
      expect((await GET('/profile', rh.token)).status).toBe(200)
    })

    it('[rule-evp-rights-rechecked] a retired RO loses the session at the next request', async () => {
      expect((await GET('/profile', w.roA.token)).status).toBe(200)
      const removed = await POST(`/access-accounts/${w.roA.id}/remove`, w.rh.token)
      expect(removed.status).toBe(200)
      expect((await GET('/profile', w.roA.token)).status).toBe(403)
    })
  })

  // ───────────────────────────── GET /profile ─────────────────────────────
  describe('GET /profile', () => {
    it.each(['DIRECTRICE', 'RO', 'RH', 'ADMINISTRATRICE', 'SUPERADMIN'] as const)(
      '[rule-evp-capabilities-list] [rule-evp-creche-scope] the profile of %s carries the exact capabilities, scope and crèches',
      async (role) => {
        const acct = { DIRECTRICE: w.dirA, RO: w.roA, RH: w.rh, ADMINISTRATRICE: w.adm, SUPERADMIN: w.sup }[role] as Account
        const res = await GET('/profile', acct.token)
        expect(res.status).toBe(200)
        expect(sortedKeys(res.body)).toEqual(['active', 'capabilities', 'creches', 'email', 'id', 'name', 'role', 'scope', 'sessionExpiresAt'])
        expect(res.body).toMatchObject({ id: acct.id, name: acct.name, email: acct.email, role, active: true })
        expect([...res.body.capabilities].sort()).toEqual(CAPS[role])
        if (role === 'DIRECTRICE' || role === 'RO') {
          expect(res.body.scope).toBe('ASSIGNED')
          expect(res.body.creches).toEqual([{ code: 'alpha', name: 'Crèche Alpha' }])
        } else {
          expect(res.body.scope).toBe('ALL')
          expect(res.body.creches).toEqual([])
        }
      },
    )

    it('[rule-evp-capabilities-list] the superadmin does not hold the decision capability and only the directrice holds the attestation capability', async () => {
      const sup = (await GET('/profile', w.sup.token)).body.capabilities
      expect(sup).not.toContain('absences:decide')
      expect(sup).not.toContain('closures:attest')
      for (const a of [w.roA, w.rh, w.adm]) expect((await GET('/profile', a.token)).body.capabilities).not.toContain('closures:attest')
    })

    it('[rule-evp-creche-scope] a RO sees exactly the crèches explicitly assigned', async () => {
      await sql('insert into base.creche_assignments (user_id, creche_code) values ($1, $2)', [w.roA.id, 'beta'])
      const g = (await sql("select id from base.groups where name = 'evp:beta'"))[0].id
      await sql('insert into base.group_users (group_id, user_id) values ($1, $2)', [g, w.roA.id])
      const res = await GET('/profile', w.roA.token)
      expect(res.body.creches.map((c: any) => c.code).sort()).toEqual(['alpha', 'beta'])
    })

    it('[rule-evp-capabilities-list] anonymous gets 401 and an invalid token gets 401', async () => {
      expect((await GET('/profile')).status).toBe(401)
      expect((await GET('/profile', 'invalid.token.value')).status).toBe(401)
    })
  })

  // ───────────────────────────── GET /settings ─────────────────────────────
  describe('GET /settings', () => {
    it.each(['DIRECTRICE', 'RO', 'RH', 'ADMINISTRATRICE', 'SUPERADMIN'] as const)(
      '[rule-evp-settings-payfit-disabled] [rule-evp-attach-formats] %s reads the visible configuration: limits, windows, types, writes disabled',
      async (role) => {
        const acct = { DIRECTRICE: w.dirA, RO: w.roA, RH: w.rh, ADMINISTRATRICE: w.adm, SUPERADMIN: w.sup }[role] as Account
        const res = await GET('/settings', acct.token)
        expect(res.status).toBe(200)
        expect(sortedKeys(res.body)).toEqual(['absenceTypes', 'limits', 'payfitWritesEnabled', 'windows'])
        expect(res.body.payfitWritesEnabled).toBe(false)
        expect(res.body.limits).toEqual({ sessionHours: 8, uploadLinkMinutes: 5, readLinkSeconds: 60, maxFileBytes: 10485760, formats: ['PDF', 'JPEG', 'PNG'] })
        expect(typeof res.body.windows.payfit).toBe('string')
        expect(typeof res.body.windows.aqoona).toBe('string')
        expect(res.body.windows.payfit.length).toBeGreaterThan(0)
        expect(res.body.absenceTypes).toHaveLength(9)
        for (const t of res.body.absenceTypes) expect(sortedKeys(t)).toEqual(['code', 'expectedPiece', 'hrReview', 'label', 'payfitCode', 'privatePiece'])
      },
    )

    it('[rule-evp-settings-no-secret] [rule-evp-sources-credentials] no secret, key or service identifier is readable in settings, profile or sources', async () => {
      const bodies = [(await GET('/settings', w.sup.token)).text, (await GET('/profile', w.sup.token)).text, (await GET('/sources', w.sup.token)).text]
      for (const text of bodies) {
        for (const secret of envSecrets()) expect(text).not.toContain(secret)
        expect(text).not.toMatch(/-----BEGIN|client_secret|private_key|refresh_token|access_token|api[_-]?key/i)
      }
      const keys = allKeys(JSON.parse(bodies[0])).join(' ')
      expect(keys).not.toMatch(/secret|password|token|credential|apikey|privatekey/i)
    })

    it('[rule-evp-settings-payfit-disabled] anonymous gets 401', async () => {
      expect((await GET('/settings')).status).toBe(401)
    })
  })

  // ───────────────────────────── Cache-Control ─────────────────────────────
  describe('Cache-Control', () => {
    it('[rule-evp-no-store] business responses carry Cache-Control: no-store, errors included', async () => {
      const paths: Array<[string, string]> = [
        ['/profile', w.rh.token], ['/settings', w.rh.token], ['/creches', w.rh.token], ['/absences', w.rh.token],
        ['/absence-types', w.rh.token], ['/todo', w.rh.token], ['/notifications', w.rh.token], ['/notifications/unread-count', w.rh.token],
        ['/journal-entries', w.rh.token], ['/sources', w.rh.token], ['/access-accounts', w.rh.token],
        ['/creches/alpha/closures', w.rh.token], ['/absences', w.dirA.token], ['/journal-entries', w.dirA.token],
      ]
      for (const [path, token] of paths) {
        const res = await GET(path, token)
        expect(res.headers.get('cache-control') ?? '').toMatch(/no-store/)
      }
      const notFound = await GET(`/absences/${UNKNOWN_UUID}`, w.rh.token)
      expect(notFound.status).toBe(404)
      expect(notFound.headers.get('cache-control') ?? '').toMatch(/no-store/)
    })
  })

  // ───────────────────────────── GET /access-accounts ─────────────────────────────
  describe('GET /access-accounts', () => {
    it('[rule-evp-access-list-scope] [rule-evp-access-who-manages] RH and ADMINISTRATRICE list ROs only: no directrice, no privileged account', async () => {
      for (const caller of [w.rh, w.adm]) {
        const res = await GET('/access-accounts?size=50', caller.token)
        expect(res.status).toBe(200)
        expect(res.body.items.map((i: any) => i.email).sort()).toEqual([w.roA.email, w.roB.email].sort())
        expect(res.body.total).toBe(2)
        for (const i of res.body.items) expect(i.role).toBe('RO')
      }
    })

    it('[rule-evp-access-who-manages] the superadmin lists ROs and directrices, never RH, ADMINISTRATRICE or SUPERADMIN', async () => {
      const res = await GET('/access-accounts?size=50', w.sup.token)
      expect(res.status).toBe(200)
      expect(res.body.total).toBe(4)
      expect(new Set(res.body.items.map((i: any) => i.role))).toEqual(new Set(['RO', 'DIRECTRICE']))
      expect(res.body.items.map((i: any) => i.email)).not.toContain(w.rh.email)
    })

    it('[rule-evp-access-list-scope] [rule-evp-access-google-linked-visible] an item has exactly id, name, email, role, active, googleLinked (v3) and creches [{code,name}]', async () => {
      const res = await GET('/access-accounts', w.rh.token)
      const item = res.body.items.find((i: any) => i.id === w.roA.id)
      expect(sortedKeys(item)).toEqual(['active', 'creches', 'email', 'googleLinked', 'id', 'name', 'role'])
      expect(typeof item.googleLinked).toBe('boolean')
      expect(item.creches).toEqual([{ code: 'alpha', name: 'Crèche Alpha' }])
    })

    it('[rule-evp-access-who-manages] a role filter that the caller cannot manage answers 403 access.role_not_manageable', async () => {
      for (const caller of [w.rh, w.adm]) {
        const res = await GET('/access-accounts?role=DIRECTRICE', caller.token)
        expect(res.status).toBe(403)
        expect(res.body.code).toBe('access.role_not_manageable')
      }
      const ok = await GET('/access-accounts?role=DIRECTRICE', w.sup.token)
      expect(ok.status).toBe(200)
      expect(ok.body.items.every((i: any) => i.role === 'DIRECTRICE')).toBe(true)
      expect(ok.body.total).toBe(2)
    })

    it('[rule-evp-access-list-scope] role filter RH, ADMINISTRATRICE or SUPERADMIN is refused (400 enum or 403), never listed', async () => {
      for (const role of ['RH', 'ADMINISTRATRICE', 'SUPERADMIN']) {
        const res = await GET(`/access-accounts?role=${role}`, w.sup.token)
        expect([400, 403]).toContain(res.status)
      }
    })

    it('[rule-evp-access-admin] search and active filters narrow the list', async () => {
      await seedAccount('RO', { name: 'Ophélie Unique', email: 'ophelie.unique@micro-stars.fr', creches: ['alpha'], active: false })
      const byName = await GET(`/access-accounts${qs({ search: 'Ophélie' })}`, w.rh.token)
      expect(byName.body.items.map((i: any) => i.email)).toEqual(['ophelie.unique@micro-stars.fr'])
      const byMail = await GET(`/access-accounts${qs({ search: 'ophelie.unique@' })}`, w.rh.token)
      expect(byMail.body.total).toBe(1)
      const inactive = await GET('/access-accounts?active=false', w.rh.token)
      expect(inactive.body.items.map((i: any) => i.email)).toEqual(['ophelie.unique@micro-stars.fr'])
      const active = await GET('/access-accounts?active=true&size=50', w.rh.token)
      expect(active.body.total).toBe(2)
    })

    it('[rule-evp-access-pagination] from and size paginate, total is the full count, default size is 10', async () => {
      for (let i = 0; i < 12; i++) await seedAccount('RO', { name: `RO Page ${i}`, creches: ['alpha'] })
      const def = await GET('/access-accounts', w.rh.token)
      expect(def.body.items).toHaveLength(10)
      expect(def.body.total).toBe(14)
      const p2 = await GET('/access-accounts?from=10&size=10', w.rh.token)
      expect(p2.body.items).toHaveLength(4)
      const ids = new Set([...def.body.items, ...p2.body.items].map((i: any) => i.id))
      expect(ids.size).toBe(14)
      expect((await GET('/access-accounts?size=25', w.rh.token)).body.items).toHaveLength(14)
    })

    it.each(['size=0', 'size=5', 'size=11', 'size=100', 'size=x', 'from=-1', 'from=x', 'search=', `search=${'a'.repeat(101)}`, 'active=maybe', 'role=ADMIN'])(
      '[rule-evp-access-pagination] query %s answers 400 api.validation.incoming_failed',
      async (query) => {
        const res = await GET(`/access-accounts?${query}`, w.rh.token)
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('api.validation.incoming_failed')
      },
    )

    it('[rule-evp-access-pagination] the limits size=10, 25 and 50, from=0 and a 100-character search are accepted', async () => {
      for (const q of ['size=10', 'size=25', 'size=50', 'from=0', `search=${'a'.repeat(100)}`]) expect((await GET(`/access-accounts?${q}`, w.rh.token)).status).toBe(200)
    })

    it('[rule-evp-access-who-manages] DIRECTRICE and RO get 403, anonymous 401', async () => {
      expect((await GET('/access-accounts', w.dirA.token)).status).toBe(403)
      expect((await GET('/access-accounts', w.roA.token)).status).toBe(403)
      expect((await GET('/access-accounts')).status).toBe(401)
    })
  })

  // ───────────────────────────── POST /access-accounts ─────────────────────────────
  describe('POST /access-accounts', () => {
    const body = (over: Record<string, unknown> = {}) => ({
      email: 'nina.ro@micro-stars.fr', name: 'Nina RO', role: 'RO', active: true, crecheCodes: ['alpha'], ...over,
    })

    it('[rule-evp-access-admin] [rule-evp-access-audited] RH creates a RO: account, assignment, technical group membership and one audit entry', async () => {
      const before = await auditCount('access:create')
      const res = await POST('/access-accounts', w.rh.token, body())
      expect(res.status).toBe(201)
      expect(res.body).toMatchObject({ name: 'Nina RO', email: 'nina.ro@micro-stars.fr', role: 'RO', active: true, creches: [{ code: 'alpha', name: 'Crèche Alpha' }] })
      const id = res.body.id
      expect(await countRows('evp_accounts', "user_id = $1 and role = 'RO' and active", [id])).toBe(1)
      expect(await countRows('creche_assignments', 'user_id = $1', [id])).toBe(1)
      expect((await sql('select role from base.users where id = $1', [id]))[0].role).toBe('user')
      expect(await assignmentInvariantViolations()).toEqual([])
      const entries = await auditRows('access:create')
      expect(entries).toHaveLength(before + 1)
      expect(entries[0]).toMatchObject({ actor_id: w.rh.id, object_type: 'Accès' })
      expect(entries[0].summary.length).toBeGreaterThan(0)
      expect(entries[0].summary.length).toBeLessThanOrEqual(500)
    })

    it('[rule-evp-access-admin] the created RO has no usable password: no password login', async () => {
      await POST('/access-accounts', w.rh.token, body())
      const res = await http('POST', '/auth/login', { body: { email: 'nina.ro@micro-stars.fr', password: 'Passw0rd!x', returnToken: true } })
      expect(res.status).toBe(401)
    })

    it('[rule-evp-access-admin] [rule-evp-access-who-manages] ADMINISTRATRICE creates a RO; the superadmin creates a directrice that matches the source table', async () => {
      expect((await POST('/access-accounts', w.adm.token, body())).status).toBe(201)
      const dir = await POST('/access-accounts', w.sup.token, body({ email: 'camille.bis@micro-stars.fr', name: 'Camille Alpha', role: 'DIRECTRICE' }))
      expect(dir.status).toBe(201)
      expect(dir.body.role).toBe('DIRECTRICE')
      expect(await assignmentInvariantViolations()).toEqual([])
    })

    it('[rule-evp-access-who-manages] RH and ADMINISTRATRICE cannot create a directrice: 403 access.role_not_manageable, nothing created', async () => {
      for (const caller of [w.rh, w.adm]) {
        const res = await POST('/access-accounts', caller.token, body({ email: 'd.bis@micro-stars.fr', name: 'Camille Alpha', role: 'DIRECTRICE' }))
        expect(res.status).toBe(403)
        expect(res.body.code).toBe('access.role_not_manageable')
      }
      expect(await countRows('users', "email = 'd.bis@micro-stars.fr'")).toBe(0)
    })

    it('[rule-evp-access-no-privileged] RH, ADMINISTRATRICE and SUPERADMIN cannot be created from this route (400 enum or 403)', async () => {
      for (const role of ['RH', 'ADMINISTRATRICE', 'SUPERADMIN']) {
        const res = await POST('/access-accounts', w.sup.token, body({ email: `${role.toLowerCase()}.new@micro-stars.fr`, role }))
        expect([400, 403]).toContain(res.status)
        expect(await countRows('users', 'email = $1', [`${role.toLowerCase()}.new@micro-stars.fr`])).toBe(0)
      }
    })

    it('[rule-evp-access-admin] 409 access.email_already_exists for an existing account, with no second account and no audit entry', async () => {
      const audits = await auditCount()
      const res = await POST('/access-accounts', w.rh.token, body({ email: w.roA.email }))
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('access.email_already_exists')
      expect(await countRows('users', 'email = $1', [w.roA.email])).toBe(1)
      expect(await auditCount()).toBe(audits)
    })

    it('[rule-evp-access-admin] four parallel creations of the same address give one 201 and three 409, no 5xx', async () => {
      const results = await Promise.all([1, 2, 3, 4].map(() => POST('/access-accounts', w.rh.token, body())))
      expect(results.filter((r) => r.status === 201)).toHaveLength(1)
      expect(results.filter((r) => r.status === 409)).toHaveLength(3)
      expect(await countRows('evp_accounts', "email = 'nina.ro@micro-stars.fr'")).toBe(1)
    })

    it('[rule-evp-login-domain-not-enough] [rule-evp-access-admin] an address outside @micro-stars.fr is refused with 422 access.invalid_domain, including look-alike domains', async () => {
      for (const email of ['nina@gmail.com', 'nina@xmicro-stars.fr', 'nina@micro-stars.fr.evil.com', 'nina@sub.micro-stars.fr']) {
        const res = await POST('/access-accounts', w.rh.token, body({ email }))
        expect(res.status).toBe(422)
        expect(res.body.code).toBe('access.invalid_domain')
      }
      expect(await countRows('evp_accounts', "email like 'nina@%'")).toBe(0)
    })

    it('[rule-evp-access-active-needs-creche] an active account without crèche is refused 422 access.creche_required; an inactive one without crèche is accepted', async () => {
      const refused = await POST('/access-accounts', w.rh.token, body({ crecheCodes: [] }))
      expect(refused.status).toBe(422)
      expect(refused.body.code).toBe('access.creche_required')
      expect(await countRows('users', "email = 'nina.ro@micro-stars.fr'")).toBe(0)
      const ok = await POST('/access-accounts', w.rh.token, body({ crecheCodes: [], active: false }))
      expect(ok.status).toBe(201)
      expect(ok.body.creches).toEqual([])
    })

    it('[rule-evp-access-active-needs-creche] an unknown or unverified crèche is refused 422 access.creche_not_verified, nothing created', async () => {
      await seedCreche('gamma', { name: 'Crèche Gamma', verified: false })
      for (const code of ['gamma', 'does-not-exist']) {
        const res = await POST('/access-accounts', w.rh.token, body({ crecheCodes: ['alpha', code] }))
        expect(res.status).toBe(422)
        expect(res.body.code).toBe('access.creche_not_verified')
      }
      expect(await countRows('users', "email = 'nina.ro@micro-stars.fr'")).toBe(0)
      expect(await countRows('creche_assignments')).toBe(4)
    })

    it('[rule-evp-access-directrice-source] a directrice whose name differs from the source table for one of her crèches is refused 422 access.directrice_source_mismatch', async () => {
      const res = await POST('/access-accounts', w.sup.token, body({ role: 'DIRECTRICE', name: 'Quelqu’un D’autre', crecheCodes: ['alpha'] }))
      expect(res.status).toBe(422)
      expect(res.body.code).toBe('access.directrice_source_mismatch')
      const mixed = await POST('/access-accounts', w.sup.token, body({ role: 'DIRECTRICE', name: 'Camille Alpha', crecheCodes: ['alpha', 'beta'] }))
      expect(mixed.status).toBe(422)
      expect(mixed.body.code).toBe('access.directrice_source_mismatch')
      expect(await countRows('users', "email = 'nina.ro@micro-stars.fr'")).toBe(0)
    })

    it('[rule-evp-access-admin] bounds: name 1..120, e-mail 254 accepted and 255 refused, 51 crèche codes or a 21-character code refused (400)', async () => {
      expect((await POST('/access-accounts', w.rh.token, body({ name: 'x'.repeat(120), email: 'a1@micro-stars.fr' }))).status).toBe(201)
      for (const bad of [
        { name: '' }, { name: 'x'.repeat(121) }, { email: 'pas-un-mail' }, { email: '' }, { email: `${'a'.repeat(250)}@micro-stars.fr` },
        { role: 'CHEF' }, { active: 'oui' }, { crecheCodes: Array.from({ length: 51 }, (_, i) => `c${i}`) }, { crecheCodes: ['x'.repeat(21)] },
        { crecheCodes: [''] }, { crecheCodes: 'alpha' },
      ]) {
        const res = await POST('/access-accounts', w.rh.token, body({ email: 'b1@micro-stars.fr', ...bad }))
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('api.validation.incoming_failed')
      }
      for (const missing of ['email', 'name', 'role', 'active', 'crecheCodes']) {
        const b: any = body({ email: 'c1@micro-stars.fr' })
        delete b[missing]
        expect((await POST('/access-accounts', w.rh.token, b)).status).toBe(400)
      }
      const aMail = `${'a'.repeat(254 - '@micro-stars.fr'.length)}@micro-stars.fr`
      expect(aMail.length).toBe(254)
      expect((await POST('/access-accounts', w.rh.token, body({ email: aMail }))).status).toBe(201)
      const tooLong = `${'a'.repeat(255 - '@micro-stars.fr'.length)}@micro-stars.fr`
      expect(tooLong.length).toBe(255)
      expect((await POST('/access-accounts', w.rh.token, body({ email: tooLong }))).status).toBe(400)
    })

    it('[rule-evp-access-admin] DIRECTRICE, RO get 403, anonymous 401, and nothing is created', async () => {
      expect((await POST('/access-accounts', w.dirA.token, body())).status).toBe(403)
      expect((await POST('/access-accounts', w.roA.token, body())).status).toBe(403)
      expect((await POST('/access-accounts', undefined, body())).status).toBe(401)
      expect(await countRows('users', "email = 'nina.ro@micro-stars.fr'")).toBe(0)
    })

    it('[rule-evp-access-audited] a refused creation leaves no audit entry', async () => {
      const before = await auditCount()
      await POST('/access-accounts', w.rh.token, body({ email: 'nina@gmail.com' }))
      await POST('/access-accounts', w.rh.token, body({ name: '' }))
      await POST('/access-accounts', w.dirA.token, body())
      expect(await auditCount()).toBe(before)
    })
  })

  // ───────────────────────────── PATCH /access-accounts/:id ─────────────────────────────
  describe('PATCH /access-accounts/:id', () => {
    it('[rule-evp-access-admin] [rule-evp-access-audited] RH renames a RO and changes her crèches; assignments and groups follow, one audit entry names fields only', async () => {
      const res = await PATCH(`/access-accounts/${w.roA.id}`, w.rh.token, { name: 'Rosa Renommée', crecheCodes: ['beta'] })
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ id: w.roA.id, name: 'Rosa Renommée', creches: [{ code: 'beta', name: 'Crèche Beta' }] })
      expect((await sql('select creche_code from base.creche_assignments where user_id = $1', [w.roA.id])).map((r) => r.creche_code)).toEqual(['beta'])
      expect(await assignmentInvariantViolations()).toEqual([])
      const entries = await auditRows('access:update')
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ actor_id: w.rh.id, object_type: 'Accès' })
      expect(entries[0].summary).not.toContain('Rosa Renommée')
    })

    it('[rule-evp-access-admin] the former crèche is no longer reachable by the RO, the new one is', async () => {
      await POST('/absences', w.rh.token, { crecheCode: 'alpha', contractId: w.ctA.id, typeCode: 'CONGES_PAYES', startDate: '2026-01-05', startHalf: 'MATIN', endDate: '2026-01-06', endHalf: 'MATIN', justificatifIds: [] })
      expect((await GET('/absences', w.roA.token)).body.items).toHaveLength(1)
      await PATCH(`/access-accounts/${w.roA.id}`, w.rh.token, { crecheCodes: ['beta'] })
      expect((await GET('/absences', w.roA.token)).body.items).toHaveLength(0)
    })

    it('[rule-evp-access-admin] deactivating a RO then reactivating with a crèche works; active without crèche is 422 access.creche_required', async () => {
      expect((await PATCH(`/access-accounts/${w.roA.id}`, w.rh.token, { active: false })).body.active).toBe(false)
      const refused = await PATCH(`/access-accounts/${w.roA.id}`, w.rh.token, { active: true, crecheCodes: [] })
      expect(refused.status).toBe(422)
      expect(refused.body.code).toBe('access.creche_required')
      const ok = await PATCH(`/access-accounts/${w.roA.id}`, w.rh.token, { active: true, crecheCodes: ['alpha'] })
      expect(ok.status).toBe(200)
      expect(ok.body.active).toBe(true)
    })

    it('[rule-evp-access-active-needs-creche] unverified or unknown crèche is 422 access.creche_not_verified and the account is unchanged', async () => {
      await seedCreche('gamma', { name: 'Gamma', verified: false })
      const res = await PATCH(`/access-accounts/${w.roA.id}`, w.rh.token, { crecheCodes: ['gamma'] })
      expect(res.status).toBe(422)
      expect(res.body.code).toBe('access.creche_not_verified')
      expect((await sql('select creche_code from base.creche_assignments where user_id = $1', [w.roA.id])).map((r) => r.creche_code)).toEqual(['alpha'])
    })

    it('[rule-evp-access-directrice-source] the superadmin cannot move a directrice to a crèche whose source directrice has another name', async () => {
      const res = await PATCH(`/access-accounts/${w.dirA.id}`, w.sup.token, { crecheCodes: ['beta'] })
      expect(res.status).toBe(422)
      expect(res.body.code).toBe('access.directrice_source_mismatch')
      const ok = await PATCH(`/access-accounts/${w.dirA.id}`, w.sup.token, { name: 'Camille Alpha', crecheCodes: ['alpha'] })
      expect(ok.status).toBe(200)
    })

    it('[rule-evp-access-who-manages] RH cannot edit a directrice (403 access.role_not_manageable); the superadmin can', async () => {
      const refused = await PATCH(`/access-accounts/${w.dirA.id}`, w.rh.token, { active: false })
      expect(refused.status).toBe(403)
      expect(refused.body.code).toBe('access.role_not_manageable')
      expect((await sql('select active from base.evp_accounts where user_id = $1', [w.dirA.id]))[0].active).toBe(true)
      expect((await PATCH(`/access-accounts/${w.dirA.id}`, w.sup.token, { active: false })).status).toBe(200)
    })

    it('[rule-evp-access-who-manages] a RH cannot turn a RO into a directrice (403 access.role_not_manageable)', async () => {
      const res = await PATCH(`/access-accounts/${w.roA.id}`, w.rh.token, { role: 'DIRECTRICE' })
      expect(res.status).toBe(403)
      expect(res.body.code).toBe('access.role_not_manageable')
      expect((await sql('select role from base.evp_accounts where user_id = $1', [w.roA.id]))[0].role).toBe('RO')
    })

    it('[rule-evp-access-no-privileged] privileged accounts (RH, ADMINISTRATRICE, SUPERADMIN) cannot be modified: 403 access.privileged_account, row unchanged', async () => {
      for (const target of [w.rh, w.adm, w.sup]) {
        const res = await PATCH(`/access-accounts/${target.id}`, w.sup.token, { name: 'Piraté' })
        expect(res.status).toBe(403)
        expect(res.body.code).toBe('access.privileged_account')
        expect((await sql('select name from base.evp_accounts where user_id = $1', [target.id]))[0].name).toBe(target.name)
      }
      const viaRh = await PATCH(`/access-accounts/${w.adm.id}`, w.rh.token, { active: false })
      expect(viaRh.status).toBe(403)
      expect(viaRh.body.code).toBe('access.privileged_account')
    })

    it('[rule-evp-access-no-self-role] a caller cannot change their own role: refused, role unchanged', async () => {
      for (const caller of [w.rh, w.sup, w.adm]) {
        const res = await PATCH(`/access-accounts/${caller.id}`, caller.token, { role: 'RO' })
        expect([403, 409]).toContain(res.status)
        expect(['access.cannot_change_own_role', 'access.privileged_account']).toContain(res.body.code)
        expect((await sql('select role from base.evp_accounts where user_id = $1', [caller.id]))[0].role).toBe(caller.role)
      }
    })

    // v3 (rule-evp-access-address-edit): `email` is an optional field of PATCH, no longer a refused key; its own cases are in acceptance-v3-access.test.ts.
    it('[rule-evp-access-admin] 404 access.not_found for an unknown id, 400 for a malformed id, 400 for unknown or forbidden keys', async () => {
      const unknown = await PATCH(`/access-accounts/${UNKNOWN_UUID}`, w.rh.token, { name: 'x' })
      expect(unknown.status).toBe(404)
      expect(unknown.body.code).toBe('access.not_found')
      expect((await PATCH('/access-accounts/not-a-uuid', w.rh.token, { name: 'x' })).status).toBe(400)
      for (const bad of [{ unknown: 1 }, { id: UNKNOWN_UUID }, { role: 'CHEF' }, { name: '' }, { name: 'x'.repeat(121) }, { active: 'oui' }]) {
        const res = await PATCH(`/access-accounts/${w.roA.id}`, w.rh.token, bad)
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('api.validation.incoming_failed')
      }
      expect((await sql('select email from base.evp_accounts where user_id = $1', [w.roA.id]))[0].email).toBe(w.roA.email)
    })

    it('[rule-evp-access-admin] DIRECTRICE and RO get 403, anonymous 401', async () => {
      expect((await PATCH(`/access-accounts/${w.roA.id}`, w.dirA.token, { name: 'x' })).status).toBe(403)
      expect((await PATCH(`/access-accounts/${w.roA.id}`, w.roB.token, { name: 'x' })).status).toBe(403)
      expect((await PATCH(`/access-accounts/${w.roA.id}`, undefined, { name: 'x' })).status).toBe(401)
    })
  })

  // ───────────────────────────── POST /access-accounts/:id/remove ─────────────────────────────
  describe('POST /access-accounts/:id/remove', () => {
    it('[rule-evp-access-remove-ro] [rule-evp-access-audited] removing a RO deactivates the account, empties assignments and groups, keeps the row and the history', async () => {
      const declared = await POST('/absences', w.roA.token, {
        crecheCode: 'alpha', contractId: w.ctA.id, typeCode: 'CONGES_PAYES', startDate: '2026-01-05', startHalf: 'MATIN', endDate: '2026-01-06', endHalf: 'MATIN', justificatifIds: [],
      })
      expect(declared.status).toBe(201)
      const res = await POST(`/access-accounts/${w.roA.id}/remove`, w.rh.token)
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ id: w.roA.id, active: false, creches: [] })
      const row = (await sql('select active, removed_at from base.evp_accounts where user_id = $1', [w.roA.id]))[0]
      expect(row.active).toBe(false)
      expect(row.removed_at).not.toBeNull()
      expect(await countRows('creche_assignments', 'user_id = $1', [w.roA.id])).toBe(0)
      expect(await countRows('users', 'id = $1', [w.roA.id])).toBe(1)
      expect(await assignmentInvariantViolations()).toEqual([])
      // history kept: the absence she declared is still there with her as author, and the audit trail still names her
      expect(await countRows('absences', 'declared_by = $1', [w.roA.id])).toBe(1)
      expect((await auditRows('absences:create')).some((r) => r.actor_id === w.roA.id)).toBe(true)
      const entries = await auditRows('access:remove')
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ actor_id: w.rh.id, object_type: 'Accès' })
    })

    it('[rule-evp-access-remove-ro] a removed RO no longer appears among active accounts but the row is still listed as inactive', async () => {
      await POST(`/access-accounts/${w.roA.id}/remove`, w.rh.token)
      const inactive = await GET('/access-accounts?active=false', w.rh.token)
      expect(inactive.body.items.map((i: any) => i.id)).toContain(w.roA.id)
    })

    it('[rule-evp-access-who-manages] a directrice cannot be removed by RH (403 access.role_not_manageable) and stays active', async () => {
      const res = await POST(`/access-accounts/${w.dirA.id}/remove`, w.rh.token)
      expect(res.status).toBe(403)
      expect(res.body.code).toBe('access.role_not_manageable')
      expect((await sql('select active from base.evp_accounts where user_id = $1', [w.dirA.id]))[0].active).toBe(true)
      expect(await countRows('creche_assignments', 'user_id = $1', [w.dirA.id])).toBe(1)
    })

    it('[rule-evp-access-no-privileged] a privileged account cannot be removed: 403 access.privileged_account', async () => {
      for (const target of [w.rh, w.adm, w.sup]) {
        const res = await POST(`/access-accounts/${target.id}/remove`, w.sup.token)
        expect(res.status).toBe(403)
        expect(res.body.code).toBe('access.privileged_account')
        expect((await sql('select active from base.evp_accounts where user_id = $1', [target.id]))[0].active).toBe(true)
      }
    })

    it('[rule-evp-access-remove-ro] 404 access.not_found for an unknown id, 400 for a malformed id; DIRECTRICE 403; anonymous 401; no audit entry on refusal', async () => {
      const before = await auditCount()
      const unknown = await POST(`/access-accounts/${UNKNOWN_UUID}/remove`, w.rh.token)
      expect(unknown.status).toBe(404)
      expect(unknown.body.code).toBe('access.not_found')
      expect((await POST('/access-accounts/not-a-uuid/remove', w.rh.token)).status).toBe(400)
      expect((await POST(`/access-accounts/${w.roA.id}/remove`, w.dirA.token)).status).toBe(403)
      expect((await POST(`/access-accounts/${w.roA.id}/remove`)).status).toBe(401)
      expect(await auditCount()).toBe(before)
    })

    it('[rule-evp-access-remove-ro] there is no way to delete an access account: DELETE answers 404 and the account is kept', async () => {
      const res = await http('DELETE', `/access-accounts/${w.roA.id}`, { token: w.rh.token })
      expect(res.status).toBe(404)
      expect(await countRows('evp_accounts', 'user_id = $1', [w.roA.id])).toBe(1)
    })
  })

  // ───────────────────────────── journalisation technique ─────────────────────────────
  describe('technical log', () => {
    it('[rule-evp-declare-no-medical-detail] [rule-evp-login-no-secret-in-studio] an access creation leaves neither the e-mail local part secret nor a bearer token in the server log', async () => {
      const offset = logSize()
      await POST('/access-accounts', w.rh.token, { email: 'journal.test@micro-stars.fr', name: 'Nom Journal', role: 'RO', active: true, crecheCodes: ['alpha'] })
      const log = logSince(offset)
      expect(log).not.toContain(w.rh.token)
      for (const secret of envSecrets()) expect(log).not.toContain(secret)
    })
  })
})
