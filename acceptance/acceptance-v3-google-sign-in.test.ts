import { resetData, closePool, sql } from './harness'
import { logSince, logSize } from './renfort-helpers'
import { http, GET, POST, PATCH, seedWorld, seedAccount, World, R, auditRows, closeEvp, Account } from './evp-helpers'
import {
  FakeNet, GoogleFake, GoogleKey, Flow, beginFlow, callbackPath, decodePart, describeStandard, googleClaims, newGoogleKey, sessionCookie, signRs256,
} from './v2-helpers'

// Acceptance suite of version v3-evp-acces-contrats-siret: a Google account already bound to an access no longer signs in
// with another address (adresse_modifiee), nor with another Google identifier (compte_recree); the way out is the Accès
// screen (address edit, unlink). Runs against the API of the variant `pros` (real driver, Google endpoints served by the
// fake servers started here on the addresses declared in the environment of the API under test).
describeStandard('Google sign-in of a bound access (v3-evp-acces-contrats-siret)', () => {
  const net = new FakeNet()
  const key1: GoogleKey = newGoogleKey('kid-v3-1')
  const google = new GoogleFake([key1])
  let w: World
  let logOffset = 0
  let codeSeq = 0
  const used: string[] = []

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

  const EMAIL = 'camille.liee@micro-stars.fr'
  const OTHER_EMAIL = 'camille.nouvelle7731@micro-stars.fr'
  const loc = (r: R) => new URL(r.headers.get('location')!, 'http://studio.invalid')
  const header = { alg: 'RS256', typ: 'JWT', kid: key1.kid }
  const camille = (over: Parameters<typeof seedAccount>[1] = {}) => seedAccount('RO', { email: EMAIL, name: 'Camille Test', creches: ['alpha'], ...over })
  const setSub = (userId: string, sub: string | null) => sql('update base.evp_accounts set google_sub = $2 where user_id = $1', [userId, sub])
  const subOf = async (userId: string): Promise<string | null> => (await sql('select google_sub from base.evp_accounts where user_id = $1', [userId]))[0].google_sub

  async function signIn(over: Record<string, unknown> = {}) {
    const flow: Flow = await beginFlow()
    const code = `code-v3-${++codeSeq}-${Date.now()}`
    const idToken = signRs256(header, googleClaims({ nonce: flow.nonce, ...over }), key1.privateKey)
    google.idTokens.set(code, idToken)
    used.push(code, idToken, flow.state)
    const cb = await http('GET', callbackPath(code, flow.state), { headers: { cookie: flow.cookie } })
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
  function expectSignedIn(cb: R): string {
    expect(cb.status).toBe(302)
    expect(loc(cb).pathname).toBe('/')
    expect(loc(cb).search).toBe('')
    const session = sessionCookie(cb)
    expect(session).toBeDefined()
    return session!.value
  }

  /**
   * Ancre sur le comportement nouveau de v3 : un accès lié à un sub qui se présente avec une autre adresse est refusé
   * (adresse_modifiee). En v2 la session s'ouvrait. Les cas de non-régression l'appellent EN DERNIER (elle crée un accès
   * lié et ne doit pas perturber leurs instantanés) pour ne pas passer avant le code de v3.
   */
  async function expectMismatchRefused(): Promise<void> {
    const anchor = await seedAccount('RO', { email: 'ancre.v3@micro-stars.fr', name: 'Ancre V3', creches: ['alpha'] })
    await setSub(anchor.id, 'sub-anchor-v3')
    expectDenied((await signIn({ sub: 'sub-anchor-v3', email: 'ancre.autre.v3@micro-stars.fr' })).cb, 'adresse_modifiee')
    expect(await subOf(anchor.id)).toBe('sub-anchor-v3')
  }

  /** Tout ce qu'un refus ne doit pas toucher : comptes EVP, utilisateurs, affectations, groupes, journal d'audit. */
  const snapshot = async () =>
    JSON.stringify([
      await sql('select * from base.evp_accounts order by user_id'),
      await sql('select id, email, role from base.users order by id'),
      await sql('select * from base.creche_assignments order by user_id, creche_code'),
      await sql('select * from base.group_users order by group_id, user_id'),
      await sql('select count(*)::int as n from base.audit_logs'),
    ])

  // ───────────────────────────── les sept cas ─────────────────────────────
  describe('the seven cases of the decision', () => {
    it('[rule-evp-google-sub-identity] case 1: bound sub, address of the token equal to the registered one (without regard to case), admissible access: the 8 hour session opens', async () => {
      const acct = await camille()
      await setSub(acct.id, 'sub-case-1')
      const token = expectSignedIn((await signIn({ sub: 'sub-case-1', email: 'CAMILLE.Liee@Micro-Stars.FR' })).cb)
      expect(JSON.stringify(decodePart(token.split('.')[1]))).toContain(acct.id)
      expect((await GET('/profile', token)).status).toBe(200)
      expect(await subOf(acct.id)).toBe('sub-case-1')
      await expectMismatchRefused()
    })

    it('[rule-evp-google-sub-email-mismatch] [rule-evp-login-mismatch-no-write] case 2: bound sub, another address, admissible access: no session, erreur=adresse_modifiee, nothing written (account, user, binding, audit)', async () => {
      const acct = await camille()
      await setSub(acct.id, 'sub-case-2')
      const before = await snapshot()
      const r = await signIn({ sub: 'sub-case-2', email: OTHER_EMAIL })
      expectDenied(r.cb, 'adresse_modifiee')
      expect(await snapshot()).toBe(before)
      expect(await subOf(acct.id)).toBe('sub-case-2')
      expect((await sql('select email from base.evp_accounts where user_id = $1', [acct.id]))[0].email).toBe(EMAIL)
    })

    it('[rule-evp-login-mismatch-no-address] neither the registered address, nor the one of the token, nor the sub is in the redirection of the two new refusals', async () => {
      const acct = await camille()
      await setSub(acct.id, 'sub-unique-7731-old')
      const mismatch = await signIn({ sub: 'sub-unique-7731-old', email: OTHER_EMAIL })
      const recreated = await signIn({ sub: 'sub-unique-7731-new', email: EMAIL })
      expectDenied(mismatch.cb, 'adresse_modifiee')
      expectDenied(recreated.cb, 'compte_recree')
      for (const r of [mismatch, recreated]) {
        const location = decodeURIComponent(r.cb.headers.get('location')!).toLowerCase()
        for (const hidden of ['camille', 'micro-stars', 'sub-unique-7731', '7731', r.code.toLowerCase(), r.flow.state.toLowerCase()]) expect(location).not.toContain(hidden)
        expect(r.cb.text).toBe('')
      }
    })

    it('[rule-evp-login-single-denial] [rule-evp-login-mismatch-admissible-only] case 3: bound sub, access not admissible (inactive, removed, without crèche): erreur=non_autorise whatever the address, the same redirection as an unknown address', async () => {
      const inactive = await camille({ email: 'inactive.v3@micro-stars.fr', active: false })
      const removed = await seedAccount('RO', { email: 'removed.v3@micro-stars.fr', creches: [], active: false, removed: true })
      const noCreche = await seedAccount('DIRECTRICE', { email: 'sans.creche.v3@micro-stars.fr', creches: [] })
      const cases: Array<[Account, string]> = [[inactive, 'sub-inactive'], [removed, 'sub-removed'], [noCreche, 'sub-nocreche']]
      for (const [acct, sub] of cases) await setSub(acct.id, sub)
      const unknown = await signIn({ sub: 'sub-unknown-v3', email: 'absente.v3@micro-stars.fr' })
      expectDenied(unknown.cb, 'non_autorise')
      const before = await snapshot()
      for (const [acct, sub] of cases) {
        for (const email of [acct.email, OTHER_EMAIL]) {
          const r = await signIn({ sub, email })
          expectDenied(r.cb, 'non_autorise')
          expect(r.cb.headers.get('location')).toBe(unknown.cb.headers.get('location'))
        }
      }
      expect(await snapshot()).toBe(before)
      await expectMismatchRefused()
    })

    it('[rule-evp-google-sub-binding] [rule-evp-google-sign-in-audit] case 4: unknown sub, registered address, unbound admissible access: the sub is bound, the session opens, one audit entry « Liaison Google enregistrée » without the sub', async () => {
      const acct = await camille()
      const r = await signIn({ sub: 'sub-case-4-hidden', email: 'CAMILLE.LIEE@micro-stars.fr' })
      expectSignedIn(r.cb)
      expect(await subOf(acct.id)).toBe('sub-case-4-hidden')
      const entries = (await auditRows()).filter((e) => JSON.stringify(e).includes('Liaison Google enregistrée'))
      expect(entries).toHaveLength(1)
      expect(JSON.stringify(entries[0])).not.toContain('sub-case-4-hidden')
      await expectMismatchRefused()
    })

    it('[rule-evp-google-sub-recreated][D-0008] case 5: access bound to S1, valid token of the same address with sub S2: 302 to /connexion?erreur=compte_recree, no session cookie, google_sub unchanged, nothing written', async () => {
      const acct = await camille()
      await setSub(acct.id, 'S1')
      const before = await snapshot()
      const r = await signIn({ sub: 'S2', email: EMAIL })
      expectDenied(r.cb, 'compte_recree')
      expect(await subOf(acct.id)).toBe('S1')
      expect(await snapshot()).toBe(before)
    })

    it('[rule-evp-google-sub-recreated] [rule-evp-login-mismatch-admissible-only] case 5 reveals nothing about a non admissible access: a bound but inactive access gets non_autorise for another sub', async () => {
      const inactive = await camille({ active: false })
      await setSub(inactive.id, 'S1')
      expectDenied((await signIn({ sub: 'S2', email: EMAIL })).cb, 'non_autorise')
      expect(await subOf(inactive.id)).toBe('S1')
      await expectMismatchRefused()
    })

    it('[rule-evp-login-single-denial] case 6: unknown sub, registered address, access not admissible: erreur=non_autorise and no binding', async () => {
      const inactive = await camille({ email: 'inactive6@micro-stars.fr', active: false })
      const noCreche = await seedAccount('DIRECTRICE', { email: 'nocreche6@micro-stars.fr', creches: [] })
      const removed = await seedAccount('RO', { email: 'removed6@micro-stars.fr', creches: [], active: false, removed: true })
      for (const [acct, sub] of [[inactive, 'sub-6a'], [noCreche, 'sub-6b'], [removed, 'sub-6c']] as Array<[Account, string]>) {
        expectDenied((await signIn({ sub, email: acct.email })).cb, 'non_autorise')
        expect(await subOf(acct.id)).toBeNull()
      }
      await expectMismatchRefused()
    })

    it('[rule-evp-login-single-denial] case 7: unknown sub, unknown address: erreur=non_autorise', async () => {
      await camille()
      const r = await signIn({ sub: 'sub-case-7', email: 'inconnue.v3@micro-stars.fr' })
      expectDenied(r.cb, 'non_autorise')
      expect(await sql('select 1 from base.evp_accounts where google_sub is not null')).toEqual([])
      await expectMismatchRefused()
    })

    it('[rule-evp-google-sub-email-mismatch] the refusals of the token checks of v2 are unchanged: signature, audience, hosted domain, unverified address', async () => {
      const acct = await camille()
      await setSub(acct.id, 'sub-regression')
      const base = { sub: 'sub-regression', email: EMAIL }
      expectDenied((await signIn({ ...base, email: OTHER_EMAIL })).cb, 'adresse_modifiee')
      expectDenied((await signIn({ ...base, aud: 'autre-client' })).cb, 'echec')
      expectDenied((await signIn({ ...base, hd: 'autre-domaine.fr' })).cb, 'domaine')
      expectDenied((await signIn({ ...base, email_verified: false })).cb, 'echec')
      expectDenied((await signIn({ ...base, iss: 'https://accounts.evil.example' })).cb, 'echec')
      const flow = await beginFlow()
      const code = `code-v3-forged-${++codeSeq}`
      const [h, p] = signRs256(header, googleClaims({ ...base, nonce: flow.nonce }), key1.privateKey).split('.')
      google.idTokens.set(code, `${h}.${p}.${Buffer.from('forged-signature-forged-signature-xx').toString('base64url')}`)
      expectDenied(await http('GET', callbackPath(code, flow.state), { headers: { cookie: flow.cookie } }), 'echec')
      expect(await subOf(acct.id)).toBe('sub-regression')
    })
  })

  // ───────────────────────────── marche à suivre : adresse changée ─────────────────────────────
  describe('way out 1: the address of the Google account changed', () => {
    it('[rule-evp-google-sub-address-fix] [rule-evp-access-address-keeps-link] the manager updates the address of the access: the same sub with the new address then signs in, the binding is kept, the old address no longer matches', async () => {
      const acct = await camille()
      await setSub(acct.id, 'sub-moved')
      expectDenied((await signIn({ sub: 'sub-moved', email: OTHER_EMAIL })).cb, 'adresse_modifiee')
      const patched = await PATCH(`/access-accounts/${acct.id}`, w.rh.token, { email: OTHER_EMAIL })
      expect(patched.status).toBe(200)
      expect(patched.body).toMatchObject({ email: OTHER_EMAIL, googleLinked: true })
      const token = expectSignedIn((await signIn({ sub: 'sub-moved', email: OTHER_EMAIL })).cb)
      expect(JSON.stringify(decodePart(token.split('.')[1]))).toContain(acct.id)
      expect((await GET('/profile', token)).status).toBe(200)
      expect(await subOf(acct.id)).toBe('sub-moved')
      expect((await sql('select email from base.users where id = $1', [acct.id]))[0].email).toBe(OTHER_EMAIL)
      expectDenied((await signIn({ sub: 'sub-moved', email: EMAIL })).cb, 'adresse_modifiee')
    })

    it('[rule-evp-google-sub-address-fix] after the fix, the unbound-address path is closed to everyone else: the new address with another sub is compte_recree, the former address is unknown', async () => {
      const acct = await camille()
      await setSub(acct.id, 'sub-moved')
      await PATCH(`/access-accounts/${acct.id}`, w.rh.token, { email: OTHER_EMAIL })
      expectDenied((await signIn({ sub: 'sub-other', email: OTHER_EMAIL })).cb, 'compte_recree')
      expectDenied((await signIn({ sub: 'sub-other-2', email: EMAIL })).cb, 'non_autorise')
      expect(await subOf(acct.id)).toBe('sub-moved')
    })
  })

  // ───────────────────────────── marche à suivre : compte recréé ─────────────────────────────
  describe('way out 2: the Google account was recreated', () => {
    it('[rule-evp-access-google-rebind] after the unlink, the next valid sign-in of the address binds the new sub and opens the session; the action itself creates no binding', async () => {
      const acct = await camille()
      await setSub(acct.id, 'sub-old-google')
      expectDenied((await signIn({ sub: 'sub-new-google', email: EMAIL })).cb, 'compte_recree')
      const unlinked = await POST(`/access-accounts/${acct.id}/unlink-google`, w.rh.token)
      expect(unlinked.status).toBe(200)
      expect(unlinked.body.googleLinked).toBe(false)
      expect(await subOf(acct.id)).toBeNull()
      expect(await sql('select 1 from base.evp_accounts where google_sub is not null')).toEqual([])
      const token = expectSignedIn((await signIn({ sub: 'sub-new-google', email: EMAIL })).cb)
      expect((await GET('/profile', token)).status).toBe(200)
      expect(await subOf(acct.id)).toBe('sub-new-google')
      const bound = (await auditRows()).filter((e) => JSON.stringify(e).includes('Liaison Google enregistrée'))
      const lifted = (await auditRows()).filter((e) => JSON.stringify(e).includes('Liaison Google levée'))
      expect(bound).toHaveLength(1)
      expect(lifted).toHaveLength(1)
      expectDenied((await signIn({ sub: 'sub-old-google', email: EMAIL })).cb, 'compte_recree')
    })

    it('[rule-evp-access-google-rebind] after the unlink, the old Google account is not privileged: whoever signs in first with the address is bound (the former sub included)', async () => {
      const acct = await camille()
      await setSub(acct.id, 'sub-old-google')
      await POST(`/access-accounts/${acct.id}/unlink-google`, w.rh.token)
      expectSignedIn((await signIn({ sub: 'sub-old-google', email: EMAIL })).cb)
      expect(await subOf(acct.id)).toBe('sub-old-google')
      await expectMismatchRefused()
    })
  })

  // ───────────────────────────── sessions ouvertes ─────────────────────────────
  describe('open sessions when the access is unlinked (D-0011)', () => {
    it('[rule-evp-access-unlink-session][D-0011] GET /profile with the session of the access opened before the unlink: 401 security.invalid_token', async () => {
      const acct = await camille()
      const first = expectSignedIn((await signIn({ sub: 'sub-s1', email: EMAIL })).cb)
      expect(await subOf(acct.id)).toBe('sub-s1')
      expect((await GET('/profile', first)).status).toBe(200)
      expect((await POST(`/access-accounts/${acct.id}/unlink-google`, w.rh.token)).status).toBe(200)
      const cut = await GET('/profile', first)
      expect(cut.status).toBe(401)
      expect(cut.body.code).toBe('security.invalid_token')
    })

    it('[rule-evp-access-unlink-session] the person signs in again: the new session (opened after the unlink) is valid, the old one stays cut', async () => {
      const acct = await camille()
      const first = expectSignedIn((await signIn({ sub: 'sub-s1', email: EMAIL })).cb)
      await POST(`/access-accounts/${acct.id}/unlink-google`, w.rh.token)
      const second = expectSignedIn((await signIn({ sub: 'sub-s2', email: EMAIL })).cb)
      expect((await GET('/profile', second)).status).toBe(200)
      expect((await GET('/profile', first)).status).toBe(401)
      expect(await subOf(acct.id)).toBe('sub-s2')
      // a second cycle cuts the second session in turn
      await POST(`/access-accounts/${acct.id}/unlink-google`, w.rh.token)
      expect((await GET('/profile', second)).status).toBe(401)
      const third = expectSignedIn((await signIn({ sub: 'sub-s3', email: EMAIL })).cb)
      expect((await GET('/profile', third)).status).toBe(200)
    })

    it('[rule-evp-access-unlink-session] the sessions of the other accesses are untouched, an address change and a refused unlink cut nothing', async () => {
      const acct = await camille()
      const other = await seedAccount('RO', { email: 'autre.v3@micro-stars.fr', creches: ['beta'] })
      const mine = expectSignedIn((await signIn({ sub: 'sub-mine', email: EMAIL })).cb)
      const theirs = expectSignedIn((await signIn({ sub: 'sub-theirs', email: other.email })).cb)
      expect((await POST(`/access-accounts/${w.dirA.id}/unlink-google`, w.rh.token)).status).toBe(403)
      expect((await GET('/profile', mine)).status).toBe(200)
      expect((await PATCH(`/access-accounts/${acct.id}`, w.rh.token, { email: OTHER_EMAIL })).status).toBe(200)
      expect((await GET('/profile', mine)).status).toBe(200)
      await POST(`/access-accounts/${acct.id}/unlink-google`, w.rh.token)
      expect((await GET('/profile', mine)).status).toBe(401)
      expect((await GET('/profile', theirs)).status).toBe(200)
      expect((await POST(`/access-accounts/${acct.id}/unlink-google`, w.rh.token)).status).toBe(409)
    })
  })

  // ───────────────────────────── journaux ─────────────────────────────
  describe('logs and audit', () => {
    it('[rule-evp-login-mismatch-no-address] [rule-evp-secrets-never-exposed] neither the sub nor an address of the refusals ends in the audit trail or in the server log', async () => {
      const acct = await camille()
      await setSub(acct.id, 'sub-log-unique-9917')
      expectDenied((await signIn({ sub: 'sub-log-unique-9917', email: 'adresse.jetons.9917@micro-stars.fr' })).cb, 'adresse_modifiee')
      expectDenied((await signIn({ sub: 'sub-log-recree-9917', email: EMAIL })).cb, 'compte_recree')
      const audit = JSON.stringify(await auditRows())
      const log = logSince(logOffset)
      for (const hidden of ['sub-log-unique-9917', 'sub-log-recree-9917', 'adresse.jetons.9917', ...used]) {
        expect(audit).not.toContain(hidden)
        expect(log).not.toContain(hidden)
      }
      expect(log).not.toContain('adresse.jetons.9917')
    })
  })
})
