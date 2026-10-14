import { resetData, closePool, sql } from './harness'
import { logSince, logSize, sleep } from './renfort-helpers'
import { GET, POST, seedWorld, World, countRows, closeEvp, refresh, waitRun, SIRET_A, SIRET_B, assignmentInvariantViolations } from './evp-helpers'
import { FakeNet, SheetsFake, GAMMA, SHEET_HEADER, describeStandard, expectNoSecret, everythingVisible, configuredSecrets, sheetsEnv } from './v2-helpers'

const ERROR_CODES = ['sources.not_configured', 'sources.unreachable', 'sources.refused', 'sources.rate_limited', 'sources.unexpected_format']
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'

// Acceptance suite of version v2-evp-sources: real, read-only reading of the Google Sheets table « Contacts des crèches ».
// The Sheets API and the token endpoint of the service account are fake servers on the addresses of api/.env.test.
describeStandard('Google Sheets reading (v2-evp-sources)', () => {
  const net = new FakeNet()
  const sheets = new SheetsFake()
  let w: World

  beforeAll(async () => {
    await sheets.mount(net)
  })
  afterAll(async () => {
    await net.close()
    await closeEvp()
    await closePool()
  })
  beforeEach(async () => {
    await resetData()
    sheets.reset()
    net.clear()
    w = await seedWorld()
  })

  const sourceOf = async (key = 'sheets') => (await GET('/sources', w.sup.token)).body.items.find((i: any) => i.key === key)
  const anomalies = async () => (await GET('/sources/sheets/anomalies?size=50', w.sup.token)).body
  const labels = (a: any) => a.items.map((i: any) => i.label)
  const read = () => refresh(w.sup.token, 'sheets')
  const gammaRow = (over: Partial<Record<number, string>> = {}) => GAMMA.map((v, i) => over[i] ?? v)

  // ───────────────────────────── requête ─────────────────────────────
  describe('the request sent to the Sheets API', () => {
    it('[rule-evp-sheets-values-get] [rule-evp-sheets-formatted-values] [rule-evp-sheets-configurable] one GET spreadsheets.values.get on the configured workbook, tab and range, with formatted values by rows', async () => {
      const run = await read()
      expect(run.state).toBe('SUCCEEDED')
      const calls = net.calls('sheets')
      expect(calls).toHaveLength(1)
      const e = sheetsEnv()
      expect(calls[0].method).toBe('GET')
      expect(decodeURIComponent(calls[0].path)).toBe(`${new URL(e.baseUrl).pathname.replace(/\/+$/, '')}/v4/spreadsheets/${e.id}/values/'${e.tab}'!${e.range}`)
      expect(calls[0].path).not.toContain(' ')
      const q = new URLSearchParams(calls[0].search)
      expect(q.get('valueRenderOption')).toBe('FORMATTED_VALUE')
      expect(q.get('majorDimension')).toBe('ROWS')
      expect(String(calls[0].headers.authorization)).toMatch(/^Bearer fake-sheets-token-\d+$/)
    })

    it('[rule-evp-sheets-service-account][D-0009] the fake token server receives grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer with an RS256 assertion carrying the scope spreadsheets.readonly', async () => {
      const started = await POST('/sources/sheets/refresh', w.sup.token)
      expect(started.status).toBe(202)
      expect((await waitRun(w.sup.token, started.body.runId)).state).toBe('SUCCEEDED')
      expect(sheets.assertions.length).toBeGreaterThanOrEqual(1)
      const a = sheets.assertions[0]
      expect(a.grantType).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')
      expect(a.header.alg).toBe('RS256')
      expect(a.valid).toBe(true)
      expect(String(a.claims.scope).split(/\s+/)).toEqual([SCOPE])
      expect(a.claims.scope).toContain('spreadsheets.readonly')
      expect(a.form.get('refresh_token')).toBeNull()
    })

    it('[rule-evp-sheets-scope-readonly] [rule-evp-sheets-service-account] the assertion names the service account, is short-lived and asks for the read-only scope and nothing else', async () => {
      await read()
      const { claims } = sheets.assertions[0]
      expect(claims.scope).toBe(SCOPE)
      expect(claims.scope).not.toMatch(/spreadsheets(?!\.readonly)|drive|gmail|calendar/)
      const email = sheetsEnv().clientEmail
      if (email) expect(claims.iss).toBe(email)
      expect(claims.exp - claims.iat).toBeGreaterThan(0)
      expect(claims.exp - claims.iat).toBeLessThanOrEqual(3600)
    })

    it('[rule-evp-sheets-service-account] the access token is cached until expires_in minus 60 seconds, then obtained again', async () => {
      sheets.expiresIn = 64
      await read()
      await read()
      expect(sheets.assertions).toHaveLength(1)
      await sleep(4500)
      await read()
      expect(sheets.assertions).toHaveLength(2)
    })

    it('[rule-evp-sources-readonly] only reading calls are made: GET on the Sheets API, POST only to the token endpoint of the service account', async () => {
      await read()
      expect(net.calls('sheets').every((r) => r.method === 'GET')).toBe(true)
      expect(net.calls('sheets-token').every((r) => r.method === 'POST')).toBe(true)
      expect(net.log.filter((r) => r.tag !== 'sheets' && r.tag !== 'sheets-token')).toEqual([])
    })
  })

  // ───────────────────────────── analyse du tableau ─────────────────────────────
  describe('reading the table', () => {
    it('[rule-evp-sources-sheets] [rule-evp-sheets-columns] [rule-evp-creche-readonly] the reading builds the crèche referential: code normalised to lower case, SIRET kept as text, directrice and RO recorded, verified', async () => {
      const run = await read()
      expect(run.state).toBe('SUCCEEDED')
      const row = (await sql("select * from base.creches where code = 'gamma'"))[0]
      expect(row).toMatchObject({ name: 'Crèche Gamma', siret: '03333333333333', directrice_name: 'Gaby Gamma', verified: true, scope_code: 'gamma' })
      expect(row.ro_names).toEqual(['Rita Gamma'])
      const listed = (await GET('/creches', w.rh.token)).body.items.find((c: any) => c.code === 'gamma')
      expect(listed).toMatchObject({ code: 'gamma', name: 'Crèche Gamma', siret: '03333333333333', directriceName: 'Gaby Gamma', roNames: ['Rita Gamma'], verified: true })
      expect(await assignmentInvariantViolations()).toEqual([])
    })

    it('[rule-evp-sheets-header-driven] columns are found by their heading (case ignored, any order, extra columns tolerated), not by their position', async () => {
      sheets.table = [
        ['Commentaires', 'DIRECTRICE', ' ro e-mail ', 'code', 'Siret', 'NOM', 'adresse de connexion', 'ro nom'],
        ['sans intérêt', 'Gaby Gamma', 'rita.gamma@micro-stars.fr', 'GAMMA', '03333333333333', 'Crèche Gamma', 'gamma@micro-stars.fr', 'Rita Gamma'],
      ]
      const run = await read()
      expect(run.state).toBe('SUCCEEDED')
      const row = (await sql("select * from base.creches where code = 'gamma'"))[0]
      expect(row).toMatchObject({ name: 'Crèche Gamma', siret: '03333333333333', directrice_name: 'Gaby Gamma', verified: true })
      expect(row.ro_names).toEqual(['Rita Gamma'])
    })

    it.each(SHEET_HEADER.map((h, i) => [h, i] as [string, number]))('[rule-evp-sheets-header-driven] [rule-evp-sources-error-codes] a table without the heading « %s » ends FAILED with sources.unexpected_format and changes nothing', async (_h, i) => {
      sheets.table = [SHEET_HEADER.filter((_, j) => j !== i), GAMMA.filter((_, j) => j !== i)]
      const before = JSON.stringify(await sql('select * from base.creches order by code'))
      const run = await read()
      expect(run.state).toBe('FAILED')
      const src = await sourceOf()
      expect(src.state).toBe('ERROR')
      expect(src.lastError.code).toBe('sources.unexpected_format')
      expect(JSON.stringify(await sql('select * from base.creches order by code'))).toBe(before)
    })

    it('[rule-evp-sheets-formatted-values] a response without values is an empty range, not an error: the reading succeeds and creates no crèche', async () => {
      sheets.omitValues = true
      const run = await read()
      expect(run.state).toBe('SUCCEEDED')
      expect(run.errorMessage).toBeNull()
      expect(await countRows('creches', "code not in ('alpha', 'beta')")).toBe(0)
      expect((await sourceOf()).lastError).toBeNull()
    })

    it('[rule-evp-sources-error-codes] a 200 answer that is not JSON ends FAILED with sources.unexpected_format', async () => {
      sheets.rawBody = '<html><body>Sign in</body></html>'
      const run = await read()
      expect(run.state).toBe('FAILED')
      expect((await sourceOf()).lastError.code).toBe('sources.unexpected_format')
    })

    it('[rule-evp-sources-ro-gaps-not-overwritten] [rule-evp-sources-sheets] a RO gap read from the table is an anomaly: no account, assignment or group is created, changed or removed', async () => {
      const snapshot = async () =>
        JSON.stringify([
          await sql('select * from base.users order by id'),
          await sql('select * from base.evp_accounts order by user_id'),
          await sql('select * from base.creche_assignments order by user_id, creche_code'),
          await sql('select * from base.group_users order by group_id, user_id'),
        ])
      const before = await snapshot()
      sheets.table = [
        SHEET_HEADER,
        ['Crèche Alpha', 'alpha', SIRET_A, 'alpha@micro-stars.fr', 'Camille Alpha', 'Autre Personne', 'autre.personne@micro-stars.fr'],
        ['Crèche Beta', 'beta', SIRET_B, 'beta@micro-stars.fr', 'Dana Beta', 'Robin Beta', w.roB.email],
      ]
      expect((await read()).state).toBe('SUCCEEDED')
      expect(labels(await anomalies())).toContain('Écart RO')
      expect(await snapshot()).toBe(before)
    })

    it('[rule-evp-sources-sheets-superadmin] a code outside the format and a missing SIRET are reported as anomalies and not turned into crèches', async () => {
      sheets.table = [SHEET_HEADER, GAMMA, gammaRow({ 0: 'Mauvais code', 1: 'Bad Code!', 2: '44444444444444' }), gammaRow({ 0: 'Sans SIRET', 1: 'delta', 2: '' })]
      await read()
      expect((await sql('select code from base.creches order by code')).map((r) => r.code)).toEqual(['alpha', 'beta', 'gamma'])
      expect(labels(await anomalies())).toEqual(expect.arrayContaining(['Code de crèche invalide', 'SIRET manquant ou invalide']))
    })
  })

  // ───────────────────────────── erreurs ─────────────────────────────
  describe('failures of the source', () => {
    it.each([
      [400, 'sources.unexpected_format'],
      [401, 'sources.refused'],
      [403, 'sources.refused'],
      [404, 'sources.unreachable'],
    ])('[rule-evp-sources-error-codes] [rule-evp-sources-failure-state] an answer %i from Sheets ends FAILED with %s, without retry, and the source shows ERROR with its cause', async (status, code) => {
      sheets.failValuesAlways(status)
      const run = await read()
      expect(run.state).toBe('FAILED')
      expect(typeof run.errorMessage).toBe('string')
      expect(run.errorMessage.length).toBeGreaterThanOrEqual(1)
      expect(run.errorMessage.length).toBeLessThanOrEqual(200)
      const src = await sourceOf()
      expect(src.state).toBe('ERROR')
      expect(src.lastError.code).toBe(code)
      expect(src.lastError.message).toBe(run.errorMessage)
      expect(src.lastReadAt).toBeNull()
      expect(net.calls('sheets')).toHaveLength(1)
      expect(await countRows('creches', "code = 'gamma'")).toBe(0)
    })

    it('[rule-evp-sheets-values-get] [rule-evp-sources-timeouts] a 429 is waited out and retried: the second attempt succeeds', async () => {
      sheets.failValues({ status: 429, headers: { 'retry-after': '1' } })
      const run = await read()
      expect(run.state).toBe('SUCCEEDED')
      const calls = net.calls('sheets')
      expect(calls).toHaveLength(2)
      expect(calls[1].at - calls[0].at).toBeGreaterThanOrEqual(200)
      expect((await sourceOf()).lastError).toBeNull()
    })

    it('[rule-evp-sources-error-codes] [rule-evp-sources-timeouts] a persistent 429 ends FAILED with sources.rate_limited after at most 3 attempts', async () => {
      sheets.failValuesAlways(429)
      const run = await read()
      expect(run.state).toBe('FAILED')
      expect((await sourceOf()).lastError.code).toBe('sources.rate_limited')
      const n = net.calls('sheets').length
      expect(n).toBeGreaterThanOrEqual(2)
      expect(n).toBeLessThanOrEqual(3)
    }, 100_000)

    it('[rule-evp-sources-error-codes] [rule-evp-sources-timeouts] a persistent 5xx ends FAILED with sources.unreachable after at most 3 attempts; a transient 5xx is retried', async () => {
      sheets.failValuesAlways(503)
      expect((await read()).state).toBe('FAILED')
      expect((await sourceOf()).lastError.code).toBe('sources.unreachable')
      const n = net.calls('sheets').length
      expect(n).toBeGreaterThanOrEqual(2)
      expect(n).toBeLessThanOrEqual(3)
      sheets.reset()
      net.clear()
      sheets.failValues(500)
      expect((await read()).state).toBe('SUCCEEDED')
      expect(net.calls('sheets')).toHaveLength(2)
    }, 100_000)

    it('[rule-evp-sources-timeouts] [rule-evp-sources-error-codes] a server that never answers ends FAILED with sources.unreachable after the 30 second delay of the call', async () => {
      sheets.failValuesAlways('hang')
      const t0 = Date.now()
      const run = await read()
      expect(run.state).toBe('FAILED')
      expect(Date.now() - t0).toBeGreaterThanOrEqual(25_000)
      expect((await sourceOf()).lastError.code).toBe('sources.unreachable')
    }, 170_000)

    it.each([
      ['refuses the assertion (400 invalid_grant)', 400],
      ['refuses the service account (401)', 401],
      ['fails (500)', 500],
    ])('[rule-evp-sheets-service-account] [rule-evp-sources-failure-state] when the token endpoint %s the reading ends FAILED with a classified cause, without reading the workbook', async (_name, status) => {
      sheets.failToken(status, status, status)
      const run = await read()
      expect(run.state).toBe('FAILED')
      expect(ERROR_CODES).toContain((await sourceOf()).lastError.code)
      expect(net.calls('sheets')).toHaveLength(0)
    }, 100_000)

    it('[rule-evp-sources-failure-state] after a failure the data and the date of the last success are kept; a later success clears the error', async () => {
      expect((await read()).state).toBe('SUCCEEDED')
      const first = await sourceOf()
      expect(first.lastReadAt).not.toBeNull()
      expect(first.state).toBe('UP_TO_DATE')
      expect(first.lastError).toBeNull()
      const creches = JSON.stringify(await sql('select * from base.creches order by code'))
      sheets.failValuesAlways(403)
      expect((await read()).state).toBe('FAILED')
      const failed = await sourceOf()
      expect(failed.state).toBe('ERROR')
      expect(failed.lastReadAt).toBe(first.lastReadAt)
      expect(failed.volumes).toEqual(first.volumes)
      expect(failed.lastError).toMatchObject({ code: 'sources.refused' })
      expect(Date.parse(failed.lastError.at)).not.toBeNaN()
      expect(JSON.stringify(await sql('select * from base.creches order by code'))).toBe(creches)
      sheets.reset()
      expect((await read()).state).toBe('SUCCEEDED')
      const healed = await sourceOf()
      expect(healed.state).toBe('UP_TO_DATE')
      expect(healed.lastError).toBeNull()
      expect(Date.parse(healed.lastReadAt)).toBeGreaterThan(Date.parse(first.lastReadAt))
    })
  })

  // ───────────────────────────── droits, secrets ─────────────────────────────
  describe('rights and secrets', () => {
    it('[rule-evp-sources-sheets-superadmin] the Sheets reading is reserved to the superadmin: RH and the other roles are refused (403), anonymous 401, and the workbook is never called', async () => {
      for (const who of [w.rh, w.dirA, w.roA, w.adm]) expect((await POST('/sources/sheets/refresh', who.token)).status).toBe(403)
      expect((await POST('/sources/sheets/refresh')).status).toBe(401)
      await sleep(500)
      expect(net.log).toHaveLength(0)
      expect(await countRows('source_runs')).toBe(0)
    })

    it('[rule-evp-sources-no-scheduler] nothing is read by itself: with no human action no call reaches the Sheets API or its token endpoint', async () => {
      await sleep(3000)
      await GET('/sources', w.sup.token)
      expect(net.log).toHaveLength(0)
      expect(await countRows('source_runs')).toBe(0)
    })

    it('[rule-evp-secrets-never-exposed] a failing reading never shows the token, the private key, the assertion or the answer of Google in the run, the source, the anomalies, the audit trail, the notifications, the exports or the server log', async () => {
      const offset = logSize()
      sheets.failValuesAlways(403)
      const started = await POST('/sources/sheets/refresh', w.sup.token)
      expect(started.status).toBe(202)
      const run = await waitRun(w.sup.token, started.body.runId)
      expect(run.state).toBe('FAILED')
      const secrets = [...configuredSecrets(), sheets.assertions[0]?.form.get('assertion') ?? 'no-assertion-value']
      expectNoSecret('run', JSON.stringify(run), secrets)
      expectNoSecret('visible', await everythingVisible(w.sup.token, { GET, POST, sql }), secrets)
      expectNoSecret('server log', logSince(offset), secrets)
    })
  })
})
