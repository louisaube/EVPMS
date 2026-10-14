import { resetData, closePool } from './harness'
import { http, GET, POST, seedWorld, World, countRows, closeEvp, refresh, waitRun, clearFixtures, writeFixture, payfitFixture } from './evp-helpers'
import { describeUnconfigured } from './v2-helpers'

// Acceptance suite of version v2-evp-sources, VARIANT « unconfigured ».
// Run it with ACCEPTANCE_VARIANT=unconfigured against a SECOND test API started with EVP_SOURCES_DRIVER=real and WITHOUT
// GOOGLE_CLIENT_SECRET, SHEETS_PRIVATE_KEY, SHEETS_SPREADSHEET_ID, PAYFIT_API_KEYS nor AQOONA_URLS (the process variables
// cannot change while an API runs, decision D-0003). The standard v2 files are skipped in this variant and this file is
// skipped in the standard one. See acceptance/COVERAGE-v2-evp-sources.md.
describeUnconfigured('API started without Google secret nor source configuration (v2-evp-sources)', () => {
  let w: World

  beforeEach(async () => {
    await resetData()
    clearFixtures()
    w = await seedWorld()
  })
  afterAll(async () => {
    clearFixtures()
    await closeEvp()
    await closePool()
  })

  const sourceOf = async (key: string, token = w.sup.token) => (await GET('/sources', token)).body.items.find((i: any) => i.key === key)
  const ERROR_CODES = ['sources.not_configured', 'sources.unreachable', 'sources.refused', 'sources.rate_limited', 'sources.unexpected_format']

  describe('Google sign-in', () => {
    it('[rule-evp-google-endpoints-configurable] [rule-evp-login-service-status] without the Google variables the service is unavailable with google_not_configured, even outside production, and no outgoing call is made', async () => {
      const res = await GET('/service-status')
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ status: 'unavailable', reason: 'google_not_configured' })
      expect(typeof res.body.message).toBe('string')
      expect(res.body.message.length).toBeGreaterThan(0)
      expect(res.body.message.length).toBeLessThanOrEqual(300)
    })

    it('[rule-evp-google-endpoints-configurable] without the Google variables start answers 503 platform.service_unavailable instead of redirecting with placeholder identifiers', async () => {
      const res = await http('GET', '/google-sign-in/start')
      expect(res.status).toBe(503)
      expect(res.body.code).toBe('platform.service_unavailable')
      expect(res.headers.get('location')).toBeNull()
    })

    it('[rule-evp-google-token-verified-server] without the Google variables the callback opens no session: redirection to /connexion?erreur=echec', async () => {
      const res = await http('GET', '/google-sign-in/callback?code=any-code&state=any.state')
      expect(res.status).toBe(302)
      const l = new URL(res.headers.get('location')!, 'http://studio.invalid')
      expect(l.pathname).toBe('/connexion')
      expect(l.searchParams.get('erreur')).toBe('echec')
      expect(res.headers.get('set-cookie') ?? '').not.toMatch(/-jwt-/)
    })
  })

  describe('GET /sources', () => {
    it('[rule-evp-sources-configurable] the Workspace card is UNAVAILABLE without the Google variables and every readable source with an incomplete configuration is UNAVAILABLE, without error and without address', async () => {
      const list = (await GET('/sources', w.sup.token)).body.items
      expect(list.find((i: any) => i.key === 'workspace').state).toBe('UNAVAILABLE')
      for (const key of ['sheets', 'payfit', 'aqoona']) {
        const s = list.find((i: any) => i.key === key)
        expect(s.state).toBe('UNAVAILABLE')
        expect(s.lastError).toBeNull()
        expect(s.addresses).toEqual([])
        expect(s.lastReadAt).toBeNull()
      }
    })
  })

  describe('the readings of a source that is not configured', () => {
    it('[rule-evp-sources-configurable][D-0003] EVP_SOURCES_DRIVER=real and PAYFIT_API_KEYS absent: the reading is accepted (202) and ends FAILED with lastError.code sources.not_configured', async () => {
      const started = await POST('/sources/payfit/refresh', w.rh.token)
      expect(started.status).toBe(202)
      await waitRun(w.rh.token, started.body.runId)
      const run = await GET(`/sources/runs/${started.body.runId}`, w.rh.token)
      expect(run.status).toBe(200)
      expect(run.body.state).toBe('FAILED')
      expect((await sourceOf('payfit', w.rh.token)).lastError.code).toBe('sources.not_configured')
    })

    it.each([
      ['sheets', 'sup'],
      ['payfit', 'rh'],
      ['aqoona', 'rh'],
    ] as const)('[rule-evp-sources-error-codes] [rule-evp-sources-failure-state] the %s reading ends FAILED with sources.not_configured; the message says what to configure without any value; the source stays UNAVAILABLE and nothing was read', async (key, who) => {
      const token = w[who].token
      const run = await refresh(token, key)
      expect(run.state).toBe('FAILED')
      expect(typeof run.errorMessage).toBe('string')
      expect(run.errorMessage.length).toBeGreaterThanOrEqual(1)
      expect(run.errorMessage.length).toBeLessThanOrEqual(200)
      const src = await sourceOf(key, token)
      expect(src.state).toBe('UNAVAILABLE')
      expect(src.lastError.code).toBe('sources.not_configured')
      expect(src.lastError.message).toBe(run.errorMessage)
      expect(ERROR_CODES).toContain(src.lastError.code)
      expect(Date.parse(src.lastError.at)).not.toBeNaN()
      expect(src.lastReadAt).toBeNull()
      expect(run.errorMessage).not.toMatch(/https?:|=|\[|\{/)
    })

    it('[rule-evp-sources-configurable] there is no fallback on the fixtures of v1: with fixtures present, an unconfigured source still ends FAILED sources.not_configured', async () => {
      writeFixture('sheets', { rows: [] })
      writeFixture('payfit', payfitFixture([]))
      writeFixture('aqoona', { rows: [] })
      for (const [key, who] of [['sheets', w.sup], ['payfit', w.rh], ['aqoona', w.rh]] as const) {
        const run = await refresh(who.token, key)
        expect(run.state).toBe('FAILED')
        expect((await sourceOf(key, who.token)).lastError.code).toBe('sources.not_configured')
      }
      expect(await countRows('payfit_absences')).toBe(0)
      expect(await countRows('aqoona_plannings')).toBe(0)
    })

    it('[rule-evp-sources-sheets-superadmin] [rule-evp-sources-failure-state] « Toutes les sources » stops at the first reading that fails: Sheets fails not configured, PayFit and Aqoona are not launched', async () => {
      const started = await POST('/sources/refresh-all', w.sup.token)
      expect(started.status).toBe(202)
      const run = await waitRun(w.sup.token, started.body.runId)
      expect(run.state).toBe('FAILED')
      expect(await countRows('source_runs', "source_key in ('payfit', 'aqoona')")).toBe(0)
    })

    it('[rule-evp-sources-workspace-scope] Workspace still cannot be refreshed: 404', async () => {
      expect((await POST('/sources/workspace/refresh', w.sup.token)).status).toBe(404)
    })
  })
})
