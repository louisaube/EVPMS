import { createHash, createHmac } from 'node:crypto'
import { resetData, closePool, sql } from './harness'
import { logSince, logSize, sleep } from './renfort-helpers'
import { http, GET, seedWorld, seedAccount, World, R, auditRows, countRows, closeEvp } from './evp-helpers'
import {
  FakeNet, GoogleFake, GoogleKey, Flow, b64u, beginFlow, callbackPath, decodePart, describeStandard, envReq, googleClaims, googleClientId,
  googleDomain, googleRedirectUri, newGoogleKey, sessionCookie, setCookies, signRs256,
} from './v2-helpers'

// Acceptance suite of version v2-evp-sources: Google sign-in with an identity token verified by the server.
// The Google endpoints (GOOGLE_AUTH_URL, GOOGLE_TOKEN_URL, GOOGLE_CERTS_URL) are served by fake servers started here
// on the fixed addresses declared in api/.env.test. Run with `--runInBand` (the keys cache of the API is shared).
describeStandard('Google sign-in: identity token verified by the server (v2-evp-sources)', () => {
  const net = new FakeNet()
  const key1: GoogleKey = newGoogleKey('kid-test-1')
  const google = new GoogleFake([key1])
  let w: World
  let logOffset = 0
  let codeSeq = 0
  const usedCodes: string[] = []
  const usedIdTokens: string[] = []

  beforeAll(async () => {
    logOffset = logSize()
    await google.mount(net)
  })
  afterAll(async () => {
    await net.close()
    await closeEvp()
    await closePool()
  })
  beforeEach(async () => {
    await resetData()
    google.reset([key1])
    net.clear()
    w = await seedWorld()
  })

  const EMAIL = 'camille@micro-stars.fr'
  const camille = (over: Record<string, unknown> = {}) => seedAccount('DIRECTRICE', { email: EMAIL, name: 'Camille Test', creches: ['alpha'], ...over })
  const subOf = async (userId: string): Promise<string | null> => (await sql('select google_sub from base.evp_accounts where user_id = $1', [userId]))[0].google_sub
  const setSub = (userId: string, sub: string | null) => sql('update base.evp_accounts set google_sub = $2 where user_id = $1', [userId, sub])
  const loc = (r: R) => new URL(r.headers.get('location')!, 'http://studio.invalid')
  const header = (key: GoogleKey = key1) => ({ alg: 'RS256', typ: 'JWT', kid: key.kid })

  interface SignInOptions {
    key?: GoogleKey
    redirection?: string
    forge?: (claims: Record<string, unknown>, flow: Flow) => string
    cookie?: string | null
    state?: string
  }

  /** Flux complet : start, jeton servi par le faux Google à l'échange du code, callback. */
  async function signIn(over: Record<string, unknown> = {}, o: SignInOptions = {}) {
    const flow = await beginFlow(o.redirection)
    const code = `code-${++codeSeq}-${Date.now()}`
    const claims = googleClaims({ nonce: flow.nonce, ...over })
    const idToken = o.forge ? o.forge(claims, flow) : signRs256(header(o.key), claims, (o.key ?? key1).privateKey)
    google.idTokens.set(code, idToken)
    usedCodes.push(code)
    usedIdTokens.push(idToken)
    const cb = await http('GET', callbackPath(code, o.state ?? flow.state), { headers: o.cookie === null ? {} : { cookie: o.cookie ?? flow.cookie } })
    return { flow, code, idToken, cb }
  }

  function expectDenied(cb: R, erreur: string): void {
    expect(cb.status).toBe(302)
    const l = loc(cb)
    expect(l.pathname).toBe('/connexion')
    expect([...l.searchParams.keys()]).toEqual(['erreur'])
    expect(l.searchParams.get('erreur')).toBe(erreur)
    expect(cb.text).toBe('')
    expect(sessionCookie(cb)).toBeUndefined()
  }

  function expectSignedIn(r: { cb: R; code: string; idToken: string; flow: Flow }, pathname = '/'): string {
    expect(r.cb.status).toBe(302)
    const l = loc(r.cb)
    expect(l.pathname).toBe(pathname)
    expect(l.search).toBe('')
    expect(r.cb.headers.get('location')).not.toContain(r.code)
    expect(r.cb.headers.get('location')).not.toContain(r.flow.state)
    expect(r.cb.headers.get('location')).not.toContain(r.idToken)
    expect(r.cb.text).toBe('')
    const session = sessionCookie(r.cb)
    expect(session).toBeDefined()
    return session!.value
  }

  // ───────────────────────────── start ─────────────────────────────
  describe('GET /google-sign-in/start', () => {
    it('[rule-evp-google-flow-redirect] [rule-evp-google-endpoints-configurable] [rule-evp-google-domain-configurable] [rule-evp-google-scopes-minimal] redirects to the configured authorization endpoint with client_id, redirect_uri, hd, state, nonce and PKCE S256', async () => {
      const res = await http('GET', '/google-sign-in/start')
      expect(res.status).toBe(302)
      const l = new URL(res.headers.get('location')!)
      const auth = new URL(envReq('GOOGLE_AUTH_URL'))
      expect(l.origin + l.pathname).toBe(auth.origin + auth.pathname)
      const p = l.searchParams
      expect(p.get('client_id')).toBe(googleClientId())
      expect(p.get('redirect_uri')).toBe(googleRedirectUri())
      expect(p.get('response_type')).toBe('code')
      expect(p.get('hd')).toBe(googleDomain())
      expect((p.get('scope') ?? '').split(/\s+/).sort()).toEqual(['email', 'openid', 'profile'])
      expect(p.get('state')!.length).toBeGreaterThanOrEqual(16)
      expect(p.get('nonce')!.length).toBeGreaterThanOrEqual(16)
      expect(p.get('nonce')).not.toBe(p.get('state'))
      expect(p.get('code_challenge_method')).toBe('S256')
      expect(p.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(setCookies(res).join('\n')).toMatch(/HttpOnly/i)
      expect(res.headers.get('location')).not.toContain(envReq('GOOGLE_CLIENT_SECRET'))
    })

    it('[rule-evp-google-flow-redirect] [rule-evp-google-endpoints-configurable] the redirect_uri is the configured return address of the API and each start has its own state, nonce and challenge', async () => {
      const a = await beginFlow()
      const b = await beginFlow()
      expect(a.redirectUri).toMatch(/\/google-sign-in\/callback$/)
      expect(a.redirectUri).toBe(b.redirectUri)
      expect(a.state).not.toBe(b.state)
      expect(a.nonce).not.toBe(b.nonce)
      expect(a.challenge).not.toBe(b.challenge)
    })

    it('[rule-evp-google-token-verified-server] starting a sign-in and reading the service status make no outgoing call to Google', async () => {
      await beginFlow()
      const status = await GET('/service-status')
      expect(status.status).toBe(200)
      expect(status.body).toMatchObject({ status: 'ready', reason: null })
      expect(net.log).toHaveLength(0)
    })
  })

  // ───────────────────────────── nominal ─────────────────────────────
  describe('GET /google-sign-in/callback: nominal', () => {
    it('[rule-evp-google-token-verified-server] [rule-evp-google-flow-redirect] [rule-evp-session-8h] a valid identity token of an active, registered account opens an 8 hour session and redirects to the safe path; the code is exchanged with the client secret and the PKCE verifier', async () => {
      const acct = await camille()
      const r = await signIn({}, { redirection: '/absences' })
      const token = expectSignedIn(r, '/absences')
      expect((await GET('/profile', token)).status).toBe(200)
      const session = sessionCookie(r.cb)!
      const claims = decodePart(token.split('.')[1])
      expect(claims.exp - claims.iat).toBe(8 * 3600)
      const maxAge = /max-age=(\d+)/i.exec(session.attrs)
      if (maxAge) expect(Math.abs(Number(maxAge[1]) - 8 * 3600)).toBeLessThanOrEqual(60)
      expect(JSON.stringify(claims)).toContain(acct.id)

      expect(google.tokenRequests).toHaveLength(1)
      const req = google.tokenRequests[0]
      expect(req.headers['content-type']).toMatch(/application\/x-www-form-urlencoded/)
      expect(req.form.get('grant_type')).toBe('authorization_code')
      expect(req.form.get('code')).toBe(r.code)
      expect(req.form.get('client_id')).toBe(googleClientId())
      expect(req.form.get('client_secret')).toBe(envReq('GOOGLE_CLIENT_SECRET'))
      expect(req.form.get('redirect_uri')).toBe(r.flow.redirectUri)
      const verifier = req.form.get('code_verifier')!
      expect(createHash('sha256').update(verifier).digest('base64url')).toBe(r.flow.challenge)
      expect(net.calls('google-certs').length).toBeGreaterThanOrEqual(1)
    })

    it('[rule-evp-google-flow-redirect] [rule-evp-login-safe-redirect] without redirection the person lands on /', async () => {
      await camille()
      expectSignedIn(await signIn(), '/')
    })

    it('[rule-evp-session-8h] [rule-evp-login-domain-not-enough] the role of the session comes from the registered account, not from the token', async () => {
      const rh = await seedAccount('RH', { email: 'marine@micro-stars.fr', name: 'Marine Test' })
      const token = expectSignedIn(await signIn({ email: 'marine@micro-stars.fr', sub: 'sub-rh-1', name: 'Quelqu un d autre' }))
      expect(JSON.stringify(decodePart(token.split('.')[1]))).toContain(rh.id)
      expect((await GET('/sources', token)).status).toBe(200)
    })

    it('[rule-evp-google-iss] both forms of the issuer are accepted: accounts.google.com and https://accounts.google.com', async () => {
      await camille()
      expectSignedIn(await signIn({ iss: 'accounts.google.com' }))
      expectSignedIn(await signIn({ iss: 'https://accounts.google.com' }))
    })

    it('[rule-evp-google-hd] the hosted domain is compared by the code itself, without regard to case', async () => {
      await camille()
      expectSignedIn(await signIn({ hd: googleDomain().toUpperCase() }))
    })

    it('[rule-evp-google-exp] an expiry inside the 60 second clock tolerance is accepted', async () => {
      await camille()
      const now = Math.floor(Date.now() / 1000)
      expectSignedIn(await signIn({ iat: now - 3630, exp: now - 30 }))
    })
  })

  // ───────────────────────────── contrôles du jeton ─────────────────────────────
  describe('GET /google-sign-in/callback: checks of the identity token', () => {
    async function expectRefused(over: Record<string, unknown>, erreur: string, o: SignInOptions = {}) {
      const acct = await camille()
      const r = await signIn(over, o)
      expectDenied(r.cb, erreur)
      expect(await subOf(acct.id)).toBeNull()
    }

    it('[rule-evp-google-signature] a token signed by a key that Google does not publish (same kid) is refused: erreur=echec, no session, nothing bound', async () => {
      await expectRefused({}, 'echec', { key: { ...newGoogleKey(key1.kid) } })
    })

    it('[rule-evp-google-signature] [rule-evp-google-token-verified-server] a token whose payload was altered after signing is refused', async () => {
      await expectRefused({}, 'echec', {
        forge: (claims) => {
          const [h, , s] = signRs256(header(), claims, key1.privateKey).split('.')
          return `${h}.${b64u(JSON.stringify({ ...claims, email: 'ceo@micro-stars.fr', sub: 'forged-sub' }))}.${s}`
        },
      })
    })

    it.each([
      ['alg none', (claims: Record<string, unknown>) => `${b64u(JSON.stringify({ alg: 'none', typ: 'JWT', kid: key1.kid }))}.${b64u(JSON.stringify(claims))}.`],
      ['alg none without trailing dot', (claims: Record<string, unknown>) => `${b64u(JSON.stringify({ alg: 'none', typ: 'JWT', kid: key1.kid }))}.${b64u(JSON.stringify(claims))}`],
      [
        'alg HS256 signed with a symmetric secret',
        (claims: Record<string, unknown>) => {
          const input = `${b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: key1.kid }))}.${b64u(JSON.stringify(claims))}`
          return `${input}.${createHmac('sha256', String(key1.jwk.n)).update(input).digest('base64url')}`
        },
      ],
    ])('[rule-evp-google-signature] %s is refused: the algorithm of the header is not obeyed', async (_name, make) => {
      await expectRefused({}, 'echec', { forge: (claims) => make(claims) })
    })

    it.each([
      ['another client id', 'autre-client.apps.googleusercontent.com'],
      ['no audience', undefined],
    ])('[rule-evp-google-aud] a token with %s as audience is refused', async (_name, aud) => {
      await expectRefused({ aud }, 'echec')
    })

    it.each([
      ['another host', 'https://evil.example'],
      ['a lookalike host', 'accounts.google.com.evil.example'],
      ['plain http', 'http://accounts.google.com'],
      ['no issuer', undefined],
    ])('[rule-evp-google-iss] a token issued by %s is refused', async (_name, iss) => {
      await expectRefused({ iss }, 'echec')
    })

    it('[rule-evp-google-exp] a token expired beyond the 60 second tolerance is refused', async () => {
      const now = Math.floor(Date.now() / 1000)
      await expectRefused({ iat: now - 3720, exp: now - 120 }, 'echec')
    })

    it('[rule-evp-google-exp] a token without expiry is refused', async () => {
      await expectRefused({ exp: undefined }, 'echec')
    })

    it.each([
      ['no hosted domain (personal Google account)', undefined],
      ['another hosted domain', 'gmail.com'],
      ['a lookalike hosted domain', `${googleDomain()}.evil.example`],
    ])('[rule-evp-google-hd] a token with %s is refused as erreur=domaine, even if the address ends with the allowed domain', async (_name, hd) => {
      await expectRefused({ hd }, 'domaine')
    })

    it.each([
      ['false', false],
      ['absent', undefined],
    ])('[rule-evp-google-email-verified] a token whose email_verified is %s is refused', async (_name, email_verified) => {
      await expectRefused({ email_verified }, 'echec')
    })

    it.each([
      ['different from the one of the flow', 'nonce-of-another-flow'],
      ['absent', undefined],
    ])('[rule-evp-google-flow-redirect] a token whose nonce is %s is refused', async (_name, nonce) => {
      await expectRefused({ nonce }, 'echec')
    })

    it('[rule-evp-google-token-verified-server] an id_token or credential sent by the browser in the callback address is ignored: only the token returned by Google for the code counts', async () => {
      const acct = await camille()
      const flow = await beginFlow()
      const forged = signRs256(header(), googleClaims({ nonce: flow.nonce }), key1.privateKey)
      const res = await http('GET', `${callbackPath('code-unknown-to-google', flow.state)}&id_token=${forged}&credential=${forged}`, { headers: { cookie: flow.cookie } })
      expectDenied(res, 'echec')
      expect(await subOf(acct.id)).toBeNull()
    })

    it('[rule-evp-google-flow-redirect] [rule-evp-google-error-causes] a state that does not match the flow cookie is refused: altered state, missing cookie, cookie of another flow', async () => {
      const acct = await camille()
      expectDenied((await signIn({}, { state: 'altered-state-value' })).cb, 'echec')
      expectDenied((await signIn({}, { cookie: null })).cb, 'echec')
      const other = await beginFlow()
      expectDenied((await signIn({}, { cookie: other.cookie })).cb, 'echec')
      expect(await subOf(acct.id)).toBeNull()
    })

    it('[rule-evp-google-error-causes] a refusal from Google (error parameter) is erreur=annule, without exchanging the code', async () => {
      await camille()
      const flow = await beginFlow()
      const res = await http('GET', `/google-sign-in/callback?error=access_denied&state=${encodeURIComponent(flow.state)}&code=x`, { headers: { cookie: flow.cookie } })
      expectDenied(res, 'annule')
      expect(google.tokenRequests).toHaveLength(0)
    })

    it.each([
      ['Google refuses the code (400 invalid_grant)', () => { google.tokenMode = { status: 400, body: { error: 'invalid_grant' } } }],
      ['the token endpoint fails (500)', () => { google.tokenMode = { status: 500, body: { error: 'server_error' } } }],
      ['the response has no id_token', () => { google.tokenTransform = () => ({ access_token: 'ya29.fake-access', token_type: 'Bearer' }) }],
      ['the id_token is not a token', () => { google.tokenTransform = () => ({ access_token: 'ya29.fake-access', id_token: 'not-a-jwt' }) }],
      ['the id_token is not a string', () => { google.tokenTransform = () => ({ access_token: 'ya29.fake-access', id_token: 12345 }) }],
    ])('[rule-evp-google-error-causes] when %s, the sign-in is erreur=echec', async (_name, arrange) => {
      const acct = await camille()
      arrange()
      expectDenied((await signIn()).cb, 'echec')
      expect(await subOf(acct.id)).toBeNull()
    })

    it('[rule-evp-google-error-causes] a token endpoint that never answers ends in erreur=echec after the 10 second delay, not a hung request', async () => {
      await camille()
      google.tokenMode = 'hang'
      const t0 = Date.now()
      const r = await signIn()
      expect(Date.now() - t0).toBeLessThan(25_000)
      expectDenied(r.cb, 'echec')
    }, 60_000)
  })

  // ───────────────────────────── clés publiques ─────────────────────────────
  describe('Google public keys: cache, rotation, fail closed', () => {
    it('[rule-evp-google-certs-cache] the keys are cached according to Cache-Control max-age and read again once it has expired', async () => {
      await camille()
      google.certsCacheControl = 'public, max-age=2, must-revalidate'
      expectSignedIn(await signIn())
      expectSignedIn(await signIn())
      expect(net.calls('google-certs')).toHaveLength(1)
      await sleep(2500)
      expectSignedIn(await signIn())
      expect(net.calls('google-certs')).toHaveLength(2)
      await sleep(2300)
    }, 30_000)

    it('[rule-evp-google-certs-cache] without a usable max-age the keys are not kept beyond the request', async () => {
      await camille()
      google.certsCacheControl = undefined
      expectSignedIn(await signIn())
      expectSignedIn(await signIn())
      expect(net.calls('google-certs')).toHaveLength(2)
      google.certsCacheControl = 'no-cache'
      expectSignedIn(await signIn())
      expect(net.calls('google-certs')).toHaveLength(3)
    })

    it.each([
      ['the keys endpoint answers 500', { status: 500, body: '{"error":"down"}' }],
      ['the keys are not JSON', { status: 200, body: '<html>maintenance</html>' }],
      ['the keys document has no list of keys', { status: 200, body: '{"keys":"oops"}' }],
    ])('[rule-evp-google-certs-fail-closed] when %s the sign-in is refused (erreur=echec), never accepted by default', async (_name, override) => {
      const acct = await camille()
      google.certsOverride = override
      expectDenied((await signIn()).cb, 'echec')
      expect(await subOf(acct.id)).toBeNull()
    })

    it('[rule-evp-google-certs-fail-closed] [rule-evp-google-certs-cache] an expired cache is not reused when the keys cannot be read again', async () => {
      await camille()
      google.certsCacheControl = 'public, max-age=2'
      expectSignedIn(await signIn())
      await sleep(2500)
      google.certsOverride = { status: 500, body: '{}' }
      expectDenied((await signIn()).cb, 'echec')
    }, 30_000)

    it('[rule-evp-google-certs-rotation] an unknown kid triggers one single re-read of the keys (a rotated key is then accepted) and never more than one forced re-read per minute', async () => {
      // une relecture forcée par minute au plus : attendre que celle d'une exécution précédente soit échue
      await sleep(61_000)
      await camille()
      const key2 = newGoogleKey('kid-test-2')
      const key3 = newGoogleKey('kid-test-3')
      google.certsCacheControl = 'public, max-age=8'
      google.keys = [key1]
      expectSignedIn(await signIn())
      expect(net.calls('google-certs')).toHaveLength(1)

      google.keys = [key1, key2]
      expectSignedIn(await signIn({}, { key: key2 }))
      expect(net.calls('google-certs')).toHaveLength(2)

      // kid-test-3 n'est publié nulle part : refusé, et pas de nouvelle relecture dans la minute
      const refused = await signIn({}, { key: key3 })
      expectDenied(refused.cb, 'echec')
      expect(net.calls('google-certs')).toHaveLength(2)
      await sleep(8500)
    }, 150_000)
  })

  // ───────────────────────────── comptes et sub ─────────────────────────────
  describe('accounts and the sub identifier', () => {
    it('[rule-evp-login-domain-not-enough] [rule-evp-login-single-denial] an absent account, an inactive account, a removed account and a directrice without crèche all get the very same refusal non_autorise', async () => {
      await seedAccount('DIRECTRICE', { email: 'inactive@micro-stars.fr', creches: ['alpha'], active: false })
      await seedAccount('RO', { email: 'removed@micro-stars.fr', creches: [], active: false, removed: true })
      await seedAccount('DIRECTRICE', { email: 'sans.creche@micro-stars.fr', creches: [] })
      const locations: string[] = []
      for (const [i, email] of ['absente@micro-stars.fr', 'inactive@micro-stars.fr', 'removed@micro-stars.fr', 'sans.creche@micro-stars.fr'].entries()) {
        const r = await signIn({ email, sub: `sub-denied-${i}` })
        expectDenied(r.cb, 'non_autorise')
        locations.push(r.cb.headers.get('location')!)
      }
      expect(new Set(locations).size).toBe(1)
      expect(await sql('select google_sub from base.evp_accounts where google_sub is not null')).toEqual([])
    })

    it('[rule-evp-google-sub-binding] [rule-evp-google-sub-identity] [rule-evp-google-sign-in-audit] the first valid sign-in of a registered, unbound account (address compared without regard to case) binds the sub and traces it without the sub', async () => {
      const acct = await camille()
      expect(await subOf(acct.id)).toBeNull()
      const before = (await auditRows()).length
      const r = await signIn({ email: 'CAMILLE@Micro-Stars.FR', sub: 'sub-bind-1' })
      expectSignedIn(r)
      expect(await subOf(acct.id)).toBe('sub-bind-1')
      const entries = (await auditRows()).filter((e) => JSON.stringify(e).includes('Liaison Google enregistrée'))
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ actor_id: '00000000-0000-0000-0000-000000000000', object_type: 'Accès' })
      expect(JSON.stringify(entries[0])).not.toContain('sub-bind-1')
      expect((await auditRows()).length).toBeGreaterThan(before)
      expectSignedIn(await signIn({ sub: 'sub-bind-1' }))
      expect((await auditRows()).filter((e) => JSON.stringify(e).includes('Liaison Google enregistrée'))).toHaveLength(1)
    })

    // v3: replaces the v2 test of rule-evp-google-sub-email-change (the session used to open); the full table of cases is in acceptance-v3-google-sign-in.test.ts.
    it('[rule-evp-google-sub-identity] [rule-evp-google-sub-email-mismatch] a bound sub that comes with another address opens no session (erreur=adresse_modifiee); the administered address and the binding are not changed', async () => {
      const acct = await camille()
      await setSub(acct.id, 'sub-moved-1')
      const r = await signIn({ email: 'camille.nouvelle@micro-stars.fr', sub: 'sub-moved-1' })
      expectDenied(r.cb, 'adresse_modifiee')
      const row = (await sql('select email from base.evp_accounts where user_id = $1', [acct.id]))[0]
      expect(row.email).toBe(EMAIL)
      expect(await subOf(acct.id)).toBe('sub-moved-1')
    })

    it('[rule-evp-google-sub-identity] [rule-evp-google-sub-unique] [rule-evp-google-sub-email-mismatch] once a sub is bound, only the sub with the registered address opens the session: another registered address presented with that sub opens nothing (erreur=adresse_modifiee) and binds nothing', async () => {
      const a = await camille()
      const b = await seedAccount('DIRECTRICE', { email: 'dana@micro-stars.fr', name: 'Dana Test', creches: ['beta'] })
      await setSub(b.id, 'sub-of-dana')
      const r = await signIn({ email: EMAIL, sub: 'sub-of-dana' })
      expectDenied(r.cb, 'adresse_modifiee')
      expect(await subOf(a.id)).toBeNull()
      expect(await subOf(b.id)).toBe('sub-of-dana')
    })

    it('[rule-evp-google-sub-mismatch] [rule-evp-google-sub-recreated] an account bound to a sub refuses any other sub, even with the same address: compte_recree, binding unchanged, no session', async () => {
      const acct = await camille()
      await setSub(acct.id, 'sub-S1')
      const r = await signIn({ sub: 'sub-S2' })
      expectDenied(r.cb, 'compte_recree')
      expect(await subOf(acct.id)).toBe('sub-S1')
    })

    it('[rule-evp-google-sub-mismatch][D-0008][rule-evp-google-sub-recreated] account bound to S1, valid token of the same address with sub S2: 302 to /connexion?erreur=compte_recree, no session cookie, google_sub unchanged', async () => {
      const acct = await camille()
      await setSub(acct.id, 'S1')
      const flow = await beginFlow()
      const code = `code-${++codeSeq}-${Date.now()}`
      const idToken = signRs256(header(), googleClaims({ nonce: flow.nonce, sub: 'S2', email: EMAIL }), key1.privateKey)
      google.idTokens.set(code, idToken)
      usedCodes.push(code)
      usedIdTokens.push(idToken)
      const cb = await http('GET', `/google-sign-in/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(flow.state)}`, { headers: { cookie: flow.cookie } })
      expect(cb.status).toBe(302)
      expect(loc(cb).pathname).toBe('/connexion')
      expect(loc(cb).searchParams.get('erreur')).toBe('compte_recree')
      expect(sessionCookie(cb)).toBeUndefined()
      expect(await subOf(acct.id)).toBe('S1')
    })

    it('[rule-evp-google-flow-redirect][D-0005] valid code, the fake Google returns an identity token with an altered signature: 302 to /connexion?erreur=echec without session cookie; POST /google-sign-in/credential does not exist (404)', async () => {
      await camille()
      const flow = await beginFlow()
      const code = `code-${++codeSeq}-${Date.now()}`
      const [h, p] = signRs256(header(), googleClaims({ nonce: flow.nonce }), key1.privateKey).split('.')
      const idToken = `${h}.${p}.${b64u('altered-signature-bytes-altered-signature-bytes')}`
      google.idTokens.set(code, idToken)
      usedCodes.push(code)
      usedIdTokens.push(idToken)
      const cb = await http('GET', `/google-sign-in/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(flow.state)}`, { headers: { cookie: flow.cookie } })
      expect(cb.status).toBe(302)
      expect(loc(cb).pathname).toBe('/connexion')
      expect(loc(cb).searchParams.get('erreur')).toBe('echec')
      expect(sessionCookie(cb)).toBeUndefined()
      const credential = await http('POST', '/google-sign-in/credential', { body: { credential: idToken, g_csrf_token: 'x' }, headers: { cookie: 'g_csrf_token=x' } })
      expect(credential.status).toBe(404)
    })

    it('[rule-evp-google-sub-unique] a sub never binds two accounts: the database refuses a duplicate', async () => {
      const a = await camille()
      const b = await seedAccount('DIRECTRICE', { email: 'dana@micro-stars.fr', creches: ['beta'] })
      await setSub(a.id, 'sub-dup')
      await expect(setSub(b.id, 'sub-dup')).rejects.toThrow()
      expect(await subOf(b.id)).toBeNull()
    })

    it('[rule-evp-google-sub-binding] two simultaneous first sign-ins of the same account with different subs bind exactly one sub; the other one is refused', async () => {
      const acct = await camille()
      const make = async (sub: string) => {
        const flow = await beginFlow()
        const code = `code-par-${++codeSeq}-${sub}`
        const idToken = signRs256(header(), googleClaims({ nonce: flow.nonce, sub }), key1.privateKey)
        google.idTokens.set(code, idToken)
        usedCodes.push(code)
        usedIdTokens.push(idToken)
        return { flow, code, idToken }
      }
      const [x, y] = [await make('sub-race-1'), await make('sub-race-2')]
      const [rx, ry] = await Promise.all([
        http('GET', callbackPath(x.code, x.flow.state), { headers: { cookie: x.flow.cookie } }),
        http('GET', callbackPath(y.code, y.flow.state), { headers: { cookie: y.flow.cookie } }),
      ])
      const signedIn = [rx, ry].filter((r) => sessionCookie(r))
      const denied = [rx, ry].filter((r) => !sessionCookie(r))
      expect(signedIn).toHaveLength(1)
      expect(denied).toHaveLength(1)
      expectDenied(denied[0], 'compte_recree')
      const bound = await subOf(acct.id)
      expect(['sub-race-1', 'sub-race-2']).toContain(bound)
      expect(sessionCookie(bound === 'sub-race-1' ? rx : ry)).toBeDefined()
      expect(await countRows('evp_accounts', 'google_sub is not null')).toBe(1)
    })

    it('[rule-evp-google-sub-binding] [rule-evp-google-error-causes] a token without sub, with an empty sub or with a sub longer than 255 characters is refused (erreur=echec); a sub of exactly 255 characters is bound', async () => {
      const acct = await camille()
      for (const sub of [undefined, '', 's'.repeat(256)]) expectDenied((await signIn({ sub })).cb, 'echec')
      expect(await subOf(acct.id)).toBeNull()
      expectSignedIn(await signIn({ sub: 's'.repeat(255) }))
      expect(await subOf(acct.id)).toBe('s'.repeat(255))
    })

    it('[rule-evp-session-8h] [rule-evp-login-domain-not-enough] the session opened by Google gives access to the business data of the account only', async () => {
      await camille()
      const token = expectSignedIn(await signIn())
      const creches = await GET('/creches', token)
      expect(creches.status).toBe(200)
      expect(creches.body.items.map((c: any) => c.code)).toEqual(['alpha'])
      expect((await GET('/sources', token)).status).toBe(403)
    })
  })

  // ───────────────────────────── secrets ─────────────────────────────
  describe('secrets', () => {
    it('[rule-evp-secrets-never-exposed] no redirection address, audit entry or server log line carries the client secret, a code, a state or an identity token', async () => {
      const acct = await camille()
      const ok = await signIn({ sub: 'sub-secret-1' })
      expectSignedIn(ok)
      const refused = await signIn({ aud: 'autre' })
      expectDenied(refused.cb, 'echec')
      const secrets = [envReq('GOOGLE_CLIENT_SECRET'), ok.code, ok.flow.state, ok.idToken, refused.code, refused.flow.state, refused.idToken, 'ya29.fake-access']
      const audit = JSON.stringify(await auditRows())
      for (const s of secrets) {
        expect(audit).not.toContain(s)
        expect(ok.cb.headers.get('location')).not.toContain(s)
        expect(refused.cb.headers.get('location')).not.toContain(s)
      }
      expect(acct.id).toBeTruthy()
      const log = logSince(logOffset)
      for (const s of [envReq('GOOGLE_CLIENT_SECRET'), ...usedCodes, ...usedIdTokens, 'ya29.fake-access']) expect(log).not.toContain(s)
    })
  })
})
