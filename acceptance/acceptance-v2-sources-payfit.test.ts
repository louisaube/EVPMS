import { resetData, closePool, sql } from './harness'
import { logSince, logSize } from './renfort-helpers'
import {
  GET, POST, seedWorld, seedAbsence, createAbsence, World, countRows, closeEvp, refresh, waitRun, SIRET_A, SIRET_B, auditRows,
} from './evp-helpers'
import {
  FakeNet, PayfitFake, PfAbs, d, describeStandard, envOpt, everythingVisible, expectNoSecret, firstOfMonth, lastOfMonth, payfitKey, payfitWorld,
  pfa, withConfigFile, configuredSecrets,
} from './v2-helpers'
import { introspectScopes } from './v4-helpers'

const ERROR_CODES = ['sources.not_configured', 'sources.unreachable', 'sources.refused', 'sources.rate_limited', 'sources.unexpected_format']
const BASE_DELAY = Number(envOpt('PAYFIT_RETRY_DELAY_MS') ?? 1000)

// Acceptance suite of version v2-evp-sources: real, read-only reading of the PayFit partner API (introspection, company,
// collaborators, contracts, absences) and reconciliation of the dossiers with what is read. PayFit is a fake server on the
// addresses of api/.env.test; the keys come from PAYFIT_API_KEYS (one entry per SIRET: SIRET_A and SIRET_B of seedWorld).
describeStandard('PayFit reading (v2-evp-sources)', () => {
  const net = new FakeNet()
  const pf = new PayfitFake()
  let w: World

  beforeAll(async () => {
    await pf.mount(net)
  })
  afterAll(async () => {
    await net.close()
    await closeEvp()
    await closePool()
  })
  beforeEach(async () => {
    await resetData()
    pf.reset()
    // v5 (rule-evp-payfit-scope-every-read): every PayFit reading reports the keys without collaborators:social-security:read; the
    // double grants it, so that the readings below stay free of that anomaly (it is covered by acceptance-v5-*)
    introspectScopes(pf)
    net.clear()
    w = await seedWorld()
    world()
  })

  /** Remplace les données du faux PayFit (deux sociétés alignées sur seedWorld). */
  function world(absencesA: PfAbs[] = [], absencesB: PfAbs[] = []): void {
    pf.companies = payfitWorld(absencesA, absencesB).companies
  }
  const read = () => refresh(w.rh.token, 'payfit')
  async function readSlow() {
    const started = await POST('/sources/payfit/refresh', w.rh.token)
    expect(started.status).toBe(202)
    return waitRun(w.rh.token, started.body.runId, 170_000)
  }
  const sourceOf = async (key = 'payfit') => (await GET('/sources', w.rh.token)).body.items.find((i: any) => i.key === key)
  const anomalies = async () => (await GET('/sources/payfit/anomalies?size=50', w.rh.token)).body
  const labels = (a: any) => a.items.map((i: any) => i.label)
  const detail = async (id: string) => (await GET(`/absences/${id}`, w.rh.token)).body
  const notifKinds = async (id: string) => (await sql('select kind from base.notifications where absence_id = $1 order by created_at, id', [id])).map((r) => r.kind)
  const seedSaisir = (over: Record<string, unknown> = {}) =>
    seedAbsence({ contractId: w.ctA.id, declaredBy: w.dirA.id, status: 'A_SAISIR', startDate: d(-6), endDate: d(-4), ...(over as any) })
  const seedSaisirBeta = (over: Record<string, unknown> = {}) =>
    seedAbsence({ crecheCode: 'beta', contractId: w.ctB.id, declaredBy: w.dirB.id, status: 'A_SAISIR', startDate: d(-6), endDate: d(-4), ...(over as any) })
  const payfitCalls = () => net.calls('payfit')
  const callsTo = (suffix: RegExp) => payfitCalls().filter((r) => suffix.test(r.path))

  // ───────────────────────────── identifiant de société ─────────────────────────────
  describe('company identifier (introspection)', () => {
    it('[rule-evp-payfit-bearer] [rule-evp-payfit-company-id] each key is introspected once: POST with the key as Bearer and {"token": key}; the company_id is kept', async () => {
      await sql('truncate base.payfit_companies cascade')
      const run = await read()
      expect(run.state).toBe('SUCCEEDED')
      const calls = net.calls('payfit-introspect')
      expect(calls).toHaveLength(2)
      for (const c of calls) {
        expect(c.method).toBe('POST')
        const key = String(c.headers.authorization).replace(/^Bearer /, '')
        expect([payfitKey(SIRET_A), payfitKey(SIRET_B)]).toContain(key)
        expect(JSON.parse(c.body)).toEqual({ token: key })
        expect(String(c.headers['content-type'])).toMatch(/application\/json/)
      }
      const companies = await sql('select id, siret from base.payfit_companies order by id')
      expect(companies).toEqual([
        { id: 'co-a', siret: SIRET_A },
        { id: 'co-b', siret: SIRET_B },
      ])
    })

    it('[rule-evp-payfit-company-id] [rule-evp-payfit-scope-one-per-key] the company_id kept is reused for the calls of the following readings, but since v5 every reading introspects every key again (to look at its scope)', async () => {
      await sql('truncate base.payfit_companies cascade')
      await read()
      expect(net.calls('payfit-introspect')).toHaveLength(2)
      await read()
      await read()
      expect(net.calls('payfit-introspect')).toHaveLength(6)
      expect(callsTo(/\/companies-fr\/co-a$/).length).toBe(3)
    })

    it('[rule-evp-payfit-company-id] [rule-evp-sources-error-codes] an introspection answer without company_id ends FAILED with sources.unexpected_format and copies nothing', async () => {
      await sql('truncate base.payfit_companies cascade')
      pf.introspectBody = () => ({ active: true, scope: 'collaborators:read' })
      const run = await read()
      expect(run.state).toBe('FAILED')
      expect((await sourceOf()).lastError.code).toBe('sources.unexpected_format')
      expect(await countRows('payfit_companies')).toBe(0)
      expect(payfitCalls()).toHaveLength(0)
    })
  })

  // ───────────────────────────── requêtes ─────────────────────────────
  describe('the requests sent to PayFit', () => {
    it('[rule-evp-payfit-company] [rule-evp-payfit-collaborators] [rule-evp-payfit-contracts] [rule-evp-payfit-absences] [rule-evp-payfit-bearer] the four resources of each company are read with the exact paths and the key of that company', async () => {
      expect((await read()).state).toBe('SUCCEEDED')
      for (const [id, siret] of [['co-a', SIRET_A], ['co-b', SIRET_B]] as const) {
        const mine = payfitCalls().filter((r) => r.path.includes(`/${id}`))
        expect(mine.map((r) => r.path).sort()).toEqual([`/companies-fr/${id}`, `/companies/${id}/absences`, `/companies/${id}/collaborators`, `/companies/${id}/contracts-fr`].sort())
        for (const r of mine) {
          expect(r.method).toBe('GET')
          expect(r.headers.authorization).toBe(`Bearer ${payfitKey(siret)}`)
        }
      }
    })

    it('[rule-evp-payfit-window] [rule-evp-payfit-status-all] [rule-evp-payfit-pagination] absences are asked with status=all, from the start of M-2 to the end of M+2, 50 per page; lists with 50 per page', async () => {
      await read()
      for (const r of callsTo(/\/absences$/)) {
        const q = new URLSearchParams(r.search)
        expect(q.get('status')).toBe('all')
        expect(q.get('beginDate')).toBe(firstOfMonth(-2))
        expect(q.get('endDate')).toBe(lastOfMonth(2))
        expect(q.get('maxResults')).toBe('50')
      }
      expect(callsTo(/\/absences$/)).toHaveLength(2)
      for (const r of callsTo(/\/(collaborators|contracts-fr)$/)) expect(new URLSearchParams(r.search).get('maxResults')).toBe('50')
      const src = await sourceOf()
      expect(src.windowFrom).toBe(firstOfMonth(-2))
      expect(src.windowTo).toBe(lastOfMonth(2))
    })

    it('[rule-evp-payfit-scopes] [rule-evp-sources-readonly] nothing is ever written in PayFit and no request asks for time:write: GET on the API, POST only for the introspection', async () => {
      await read()
      expect(net.log.length).toBeGreaterThan(0)
      for (const r of net.log) {
        if (r.tag === 'payfit-introspect') expect(r.method).toBe('POST')
        else expect(r.method).toBe('GET')
        expect(`${r.path}${r.search}${r.body}${JSON.stringify(r.headers)}`).not.toContain('time:write')
      }
      expect(net.log.filter((r) => r.tag !== 'payfit' && r.tag !== 'payfit-introspect')).toEqual([])
    })

    it('[rule-evp-payfit-pagination] all pages of collaborators, contracts and absences are read through meta.nextPageToken until null', async () => {
      const a = pf.company(SIRET_A)
      for (let i = 0; i < 120; i++) {
        a.collaborators.push({ id: `emp-bulk-${i}`, firstName: `Prénom${i}`, lastName: `Nom${i}` })
        a.contracts.push({ contractId: `ct-bulk-${i}`, collaboratorId: `emp-bulk-${i}`, startDate: '2020-01-01', endDate: null })
        a.absences.push(pfa({ id: `pf-bulk-${i}`, startDate: d(-5 - (i % 40)), endDate: d(-5 - (i % 40)) }))
      }
      expect((await read()).state).toBe('SUCCEEDED')
      for (const [suffix, table, expected] of [
        [/\/co-a\/collaborators$/, 'payfit_employees', 122],
        [/\/co-a\/contracts-fr$/, 'payfit_contracts', 122],
        [/\/co-a\/absences$/, 'payfit_absences', 120],
      ] as const) {
        const calls = callsTo(suffix)
        expect(calls).toHaveLength(3)
        const tokens = calls.map((c) => new URLSearchParams(c.search).get('nextPageToken'))
        expect(tokens[0]).toBeNull()
        expect(tokens[1]).toBeTruthy()
        expect(tokens[2]).toBeTruthy()
        expect(tokens[2]).not.toBe(tokens[1])
        expect(await countRows(table, "company_id = 'co-a'")).toBe(expected)
      }
    })

    it('[rule-evp-payfit-pagination] [rule-evp-sources-error-codes] a page token that loops forever ends the reading FAILED with sources.unexpected_format instead of looping', async () => {
      pf.cyclic = true
      const run = await readSlow()
      expect(run.state).toBe('FAILED')
      expect((await sourceOf()).lastError.code).toBe('sources.unexpected_format')
    })

    it('[rule-evp-payfit-company] [rule-evp-payfit-siret-check] the SIRET is read from identificationNumber, never from the deprecated siret field; the name is the name of the company, else the SIRET', async () => {
      pf.company(SIRET_B).name = undefined
      expect((await read()).state).toBe('SUCCEEDED')
      const rows = await sql('select id, siret, name from base.payfit_companies order by id')
      expect(rows).toEqual([
        { id: 'co-a', siret: SIRET_A, name: 'Société A' },
        { id: 'co-b', siret: SIRET_B, name: SIRET_B },
      ])
    })

    it('[rule-evp-payfit-siret-check] [rule-evp-sources-partial-failure] a company whose identificationNumber differs from the SIRET of its key is not read: anomaly « SIRET différent de la clé », and the other company is still copied', async () => {
      pf.company(SIRET_A).identificationNumber = '55555555555555'
      const run = await read()
      expect(run.state).toBe('SUCCEEDED')
      expect(callsTo(/\/companies\/co-a\//)).toHaveLength(0)
      expect(callsTo(/\/companies\/co-b\//).length).toBeGreaterThan(0)
      expect(labels(await anomalies())).toEqual(expect.arrayContaining(['SIRET différent de la clé', 'Société inaccessible']))
      expect((await sourceOf()).state).toBe('PARTIAL')
    })
  })

  // ───────────────────────────── données lues ─────────────────────────────
  describe('data read', () => {
    it('[rule-evp-payfit-collaborators] [rule-evp-payfit-contracts] [rule-evp-payfit-contracts-all-statuses] collaborators come with their company from the path, contracts of every status are kept, the name comes from the collaborator and not from the deprecated fields of the contract', async () => {
      const a = pf.company(SIRET_A)
      a.collaborators.push({ id: 'emp-new', firstName: 'Eva', lastName: 'Nouvelle' }, { id: 'emp-arch', firstName: 'Ana', lastName: 'Archivée' }, { id: 'emp-pend', firstName: 'Paul', lastName: 'Attente' })
      a.contracts.push(
        { contractId: 'ct-new', collaboratorId: 'emp-new', startDate: d(-100), endDate: null, status: 'ACTIVE' },
        { contractId: 'ct-arch', collaboratorId: 'emp-arch', startDate: '2020-01-01', endDate: null, status: 'ARCHIVED' },
        { contractId: 'ct-pend', collaboratorId: 'emp-pend', startDate: '2020-01-01', endDate: null, status: 'PENDING' },
      )
      expect((await read()).state).toBe('SUCCEEDED')
      const statuses = await sql("select payfit_contract_id, status from base.payfit_contracts where payfit_contract_id in ('ct-new', 'ct-arch', 'ct-pend') order by payfit_contract_id")
      expect(statuses).toEqual([
        { payfit_contract_id: 'ct-arch', status: 'ARCHIVED' },
        { payfit_contract_id: 'ct-new', status: 'ACTIVE' },
        { payfit_contract_id: 'ct-pend', status: 'PENDING' },
      ])
      const names = async (search: string) => (await GET(`/creches/alpha/contracts?search=${encodeURIComponent(search)}`, w.dirA.token)).body.items.map((i: any) => i.employeeName)
      expect(await names('Nouvelle')).toEqual(['Eva Nouvelle'])
      // v3 (rule-evp-declare-contracts-not-archived): the reading keeps the ARCHIVED contract (checked above), the selector never offers it; PENDING is offered.
      expect(await names('Archivée')).toEqual([])
      expect(await names('Attente')).toEqual(['Paul Attente'])
      expect(await names('Leurre')).toEqual([])
      expect(await countRows('payfit_employees', "last_name = 'Deprecie'")).toBe(0)
    })

    it('[rule-evp-payfit-collaborators] the same collaborator and contract identifiers in two companies stay two local rows; a second reading does not duplicate', async () => {
      for (const s of [SIRET_A, SIRET_B]) {
        pf.company(s).collaborators.push({ id: 'emp-shared', firstName: 'Alice', lastName: 'Identique' })
        pf.company(s).contracts.push({ contractId: 'ct-shared', collaboratorId: 'emp-shared', startDate: '2020-01-01', endDate: null })
      }
      await read()
      await read()
      expect(await countRows('payfit_employees', "employee_id = 'emp-shared'")).toBe(2)
      const rows = await sql("select company_id from base.payfit_contracts where payfit_contract_id = 'ct-shared' order by company_id")
      expect(rows.map((r) => r.company_id)).toEqual(['co-a', 'co-b'])
    })

    it('[rule-evp-payfit-companies-without-creche] a company whose SIRET is the SIRET of no crèche is reported « Société sans crèche (SIRET) »', async () => {
      await sql("update base.creches set siret = '99999999999999' where code = 'beta'")
      expect((await read()).state).toBe('SUCCEEDED')
      expect(labels(await anomalies())).toContain('Société sans crèche (SIRET)')
    })

    it('[rule-evp-sources-readonly] [rule-evp-sources-no-auto-absence] reading PayFit creates no dossier and no notification by itself', async () => {
      world([pfa({ id: 'pf-a' }), pfa({ id: 'pf-b', contractId: 'ct-a2', startDate: d(-30), endDate: d(-29) })])
      await read()
      expect(await countRows('absences')).toBe(0)
      expect(await countRows('notifications')).toBe(0)
    })
  })

  // ───────────────────────────── erreurs ─────────────────────────────
  describe('errors, retries and partial readings', () => {
    it.each([
      ['introspect', 401, 'sources.refused', /Clé PayFit refusée/],
      ['collaborators', 401, 'sources.refused', /Clé PayFit refusée/],
      ['contracts', 403, 'sources.refused', /Portée PayFit manquante/],
      ['absences', 403, 'sources.refused', /Portée PayFit manquante/],
      ['company', 404, 'sources.unreachable', /introuvable/i],
      ['absences', 500, 'sources.unreachable', /./],
    ] as const)('[rule-evp-payfit-errors] [rule-evp-sources-error-codes] [rule-evp-sources-failure-state] when every company answers %s %i the reading ends FAILED with %s and a message without secret', async (endpoint, status, code, message) => {
      for (const s of [SIRET_A, SIRET_B]) pf.failAlways(s, endpoint, status)
      const before = JSON.stringify(await sql('select * from base.payfit_absences order by payfit_absence_id'))
      const run = await read()
      expect(run.state).toBe('FAILED')
      const src = await sourceOf()
      expect(src.state).toBe('ERROR')
      expect(src.lastError.code).toBe(code)
      expect(src.lastError.message).toMatch(message)
      expect(src.lastError.message.length).toBeLessThanOrEqual(200)
      expect(run.errorMessage).toBe(src.lastError.message)
      expect(src.lastReadAt).toBeNull()
      expectNoSecret('lastError', JSON.stringify(src.lastError))
      expect(JSON.stringify(await sql('select * from base.payfit_absences order by payfit_absence_id'))).toBe(before)
      expect(ERROR_CODES).toContain(src.lastError.code)
    }, 120_000)

    it('[rule-evp-payfit-errors] [rule-evp-sources-timeouts] a 4xx other than 429 is not retried: one single attempt', async () => {
      for (const s of [SIRET_A, SIRET_B]) pf.failAlways(s, 'absences', 403)
      await read()
      expect(callsTo(/\/co-a\/absences$/)).toHaveLength(1)
      expect(callsTo(/\/co-b\/absences$/)).toHaveLength(1)
    })

    it('[rule-evp-payfit-errors] [rule-evp-sources-timeouts] a persistent 429 ends FAILED with sources.rate_limited after exactly 3 attempts', async () => {
      for (const s of [SIRET_A, SIRET_B]) pf.failAlways(s, 'absences', 429)
      const run = await readSlow()
      expect(run.state).toBe('FAILED')
      expect((await sourceOf()).lastError.code).toBe('sources.rate_limited')
      expect(callsTo(/\/co-a\/absences$/)).toHaveLength(3)
      expect(callsTo(/\/co-b\/absences$/)).toHaveLength(3)
    }, 180_000)

    it('[rule-evp-payfit-errors] a 429 with Retry-After is waited out for the time announced, then retried and the reading succeeds', async () => {
      pf.fail(SIRET_A, 'absences', { status: 429, headers: { 'retry-after': '2' } })
      const run = await read()
      expect(run.state).toBe('SUCCEEDED')
      expect((await sourceOf()).state).toBe('UP_TO_DATE')
      const calls = callsTo(/\/co-a\/absences$/)
      expect(calls).toHaveLength(2)
      expect(calls[1].at - calls[0].at).toBeGreaterThanOrEqual(1800)
    })

    it('[rule-evp-payfit-errors] a 429 without Retry-After is waited out with PAYFIT_RETRY_DELAY_MS, doubled at each attempt', async () => {
      pf.fail(SIRET_A, 'absences', 429, 429)
      const run = await read()
      expect(run.state).toBe('SUCCEEDED')
      const calls = callsTo(/\/co-a\/absences$/)
      expect(calls).toHaveLength(3)
      expect(calls[1].at - calls[0].at).toBeGreaterThanOrEqual(BASE_DELAY * 0.9)
      expect(calls[2].at - calls[1].at).toBeGreaterThanOrEqual(BASE_DELAY * 2 * 0.9)
    })

    it('[rule-evp-sources-timeouts] a transient 5xx is retried and the reading succeeds', async () => {
      pf.fail(SIRET_B, 'contracts', 503)
      expect((await read()).state).toBe('SUCCEEDED')
      expect(callsTo(/\/co-b\/contracts-fr$/)).toHaveLength(2)
    })

    it('[rule-evp-sources-partial-failure][D-0007] company 1 answers 200, company 2 answers 401 on collaborators: run SUCCEEDED, source in state PARTIAL, one anomaly of type payfit_company_unreachable', async () => {
      pf.failAlways(SIRET_B, 'collaborators', 401)
      const started = await POST('/sources/payfit/refresh', w.rh.token)
      expect(started.status).toBe(202)
      await waitRun(w.rh.token, started.body.runId)
      const runRes = await GET(`/sources/runs/${started.body.runId}`, w.rh.token)
      expect(runRes.status).toBe(200)
      expect(runRes.body.state).toBe('SUCCEEDED')
      expect(runRes.body.errorMessage).toBeNull()
      const list = await GET('/sources', w.rh.token)
      expect(list.body.items.find((i: any) => i.key === 'payfit').state).toBe('PARTIAL')
      const unreachable = (await anomalies()).items.filter((i: any) => i.type === 'payfit_company_unreachable')
      expect(unreachable).toHaveLength(1)
    })

    it('[rule-evp-sources-partial-failure] [rule-evp-payfit-alerts] the company that answers is copied and exhaustive; the company in failure keeps its previous data, is not exhaustive and raises no disappearance alert; the anomaly names the company without secret', async () => {
      const alpha = await seedSaisir()
      const beta = await seedSaisirBeta()
      world([pfa({ id: 'pf-1' })], [pfa({ id: 'pf-b1', contractId: 'ct-b1' })])
      expect((await read()).state).toBe('SUCCEEDED')
      expect((await detail(alpha)).status).toBe('DANS_PAYFIT')
      expect((await detail(beta)).status).toBe('DANS_PAYFIT')
      expect(await sql('select company_id, reachable, exhaustive from base.payfit_coverage order by company_id')).toEqual([
        { company_id: 'co-a', reachable: true, exhaustive: true },
        { company_id: 'co-b', reachable: true, exhaustive: true },
      ])
      const betaBefore = JSON.stringify(await sql("select * from base.payfit_absences where company_id = 'co-b' order by payfit_absence_id"))
      const first = await sourceOf()

      world([pfa({ id: 'pf-1', endDate: d(-3) })], [])
      pf.failAlways(SIRET_B, 'collaborators', 401)
      const run = await read()
      expect(run.state).toBe('SUCCEEDED')
      const src = await sourceOf()
      expect(src.state).toBe('PARTIAL')
      expect(src.lastError).toBeNull()
      expect(Date.parse(src.lastReadAt)).toBeGreaterThan(Date.parse(first.lastReadAt))

      expect((await detail(alpha)).payfitAlert).toMatchObject({ kind: 'MODIFIEE' })
      expect(await sql('select company_id, reachable, exhaustive from base.payfit_coverage order by company_id')).toEqual([
        { company_id: 'co-a', reachable: true, exhaustive: true },
        { company_id: 'co-b', reachable: false, exhaustive: false },
      ])
      expect(JSON.stringify(await sql("select * from base.payfit_absences where company_id = 'co-b' order by payfit_absence_id"))).toBe(betaBefore)
      expect((await detail(beta)).payfitAlert).toBeNull()
      expect(await notifKinds(beta)).toEqual(['CONFIRMATION'])

      const item = (await anomalies()).items.find((i: any) => i.type === 'payfit_company_unreachable')
      expect(item.label).toBe('Société inaccessible')
      expect([SIRET_B, 'Société B']).toContain(item.subject)
      expect(item.detail).toBe('Clé refusée pour une société')
      expectNoSecret('anomaly', JSON.stringify(item))
    })

    it.each([
      ['introspect', 401, 'Clé refusée pour une société'],
      ['collaborators', 401, 'Clé refusée pour une société'],
      ['contracts', 403, 'Portée PayFit manquante'],
      ['absences', 403, 'Portée PayFit manquante'],
      ['company', 404, 'Société introuvable'],
    ] as const)('[rule-evp-sources-partial-failure] a company failing on %s with %i is reported « Société inaccessible » with the detail « %s »; the other one is copied', async (endpoint, status, detailText) => {
      pf.failAlways(SIRET_B, endpoint, status)
      const run = await read()
      expect(run.state).toBe('SUCCEEDED')
      expect((await sourceOf()).state).toBe('PARTIAL')
      const item = (await anomalies()).items.find((i: any) => i.type === 'payfit_company_unreachable')
      expect(item).toBeDefined()
      expect(item.detail).toBe(detailText)
      expect(await countRows('payfit_employees', "company_id = 'co-a'")).toBeGreaterThan(0)
    })

    it('[rule-evp-sources-partial-failure] [rule-evp-sources-failure-state] a company failing in the middle of its pages copies nothing of itself: its previous data stay, the others are copied', async () => {
      world([pfa({ id: 'pf-1' })], [])
      await read()
      const before = JSON.stringify(await sql("select * from base.payfit_absences where company_id = 'co-a' order by payfit_absence_id"))
      const a = pf.company(SIRET_A)
      for (let i = 0; i < 120; i++) a.absences.push(pfa({ id: `pf-bulk-${i}`, startDate: d(-5 - (i % 40)), endDate: d(-5 - (i % 40)) }))
      pf.fail(SIRET_A, 'absences', 'ok', 500, 500, 500)
      const run = await read()
      expect(run.state).toBe('SUCCEEDED')
      expect((await sourceOf()).state).toBe('PARTIAL')
      expect(JSON.stringify(await sql("select * from base.payfit_absences where company_id = 'co-a' order by payfit_absence_id"))).toBe(before)
      expect(await countRows('payfit_absences', "payfit_absence_id like 'pf-bulk-%'")).toBe(0)
    })

    it('[rule-evp-sources-timeouts] [rule-evp-sources-partial-failure] a company whose server never answers is given up after the 30 second delay of the call; the other company is copied (PARTIAL)', async () => {
      pf.failAlways(SIRET_A, 'absences', 'hang')
      const t0 = Date.now()
      const run = await readSlow()
      expect(Date.now() - t0).toBeGreaterThanOrEqual(25_000)
      expect(run.state).toBe('SUCCEEDED')
      expect((await sourceOf()).state).toBe('PARTIAL')
      const item = (await anomalies()).items.find((i: any) => i.type === 'payfit_company_unreachable')
      expect(item).toBeDefined()
    }, 180_000)
  })

  // ───────────────────────────── demi-journées ─────────────────────────────
  describe('half-days', () => {
    it('[rule-evp-payfit-half-day-mapping][D-0006] dossier to enter starting in the afternoon and ending in the afternoon, PayFit approved with start middle-of-day and end end-of-day: run SUCCEEDED, dossier DANS_PAYFIT', async () => {
      const id = await seedSaisir({ startHalf: 'APRES_MIDI', endHalf: 'APRES_MIDI' })
      world([pfa({ startMoment: 'middle-of-day', endMoment: 'end-of-day' })])
      const started = await POST('/sources/payfit/refresh', w.rh.token)
      expect(started.status).toBe(202)
      const run = await waitRun(w.rh.token, started.body.runId)
      expect(run.state).toBe('SUCCEEDED')
      const dossier = await GET(`/absences/${id}`, w.rh.token)
      expect(dossier.status).toBe(200)
      expect(dossier.body.status).toBe('DANS_PAYFIT')
    })

    it.each([
      ['MATIN', 'MATIN', 'beginning-of-day', 'middle-of-day'],
      ['MATIN', 'APRES_MIDI', 'beginning-of-day', 'end-of-day'],
      ['APRES_MIDI', 'MATIN', 'middle-of-day', 'middle-of-day'],
      ['APRES_MIDI', 'APRES_MIDI', 'middle-of-day', 'end-of-day'],
    ] as const)('[rule-evp-payfit-half-day-source] [rule-evp-payfit-half-day-mapping] start %s / end %s corresponds to moments %s / %s', async (startHalf, endHalf, startMoment, endMoment) => {
      const id = await seedSaisir({ startHalf, endHalf })
      world([pfa({ startMoment, endMoment })])
      await read()
      expect((await detail(id)).status).toBe('DANS_PAYFIT')
    })

    it.each([
      ['a start at end-of-day', 'end-of-day', 'end-of-day'],
      ['an end at beginning-of-day', 'beginning-of-day', 'beginning-of-day'],
      ['a start at end-of-day and an end at beginning-of-day', 'end-of-day', 'beginning-of-day'],
    ] as const)('[rule-evp-payfit-half-day-mapping] an absence with %s cannot be interpreted: kept without half-day, never confirms, anomaly « Demi-journée PayFit non interprétable »', async (_name, startMoment, endMoment) => {
      const id = await seedSaisir()
      world([pfa({ startMoment, endMoment })])
      const run = await read()
      expect(run.state).toBe('SUCCEEDED')
      const stored = await sql("select start_half, end_half from base.payfit_absences where payfit_absence_id = 'pf-1'")
      expect(stored).toHaveLength(1)
      expect(stored[0].start_half === null || stored[0].end_half === null).toBe(true)
      expect((await detail(id)).status).toBe('A_SAISIR')
      expect(await countRows('payfit_proofs')).toBe(0)
      expect(labels(await anomalies())).toContain('Demi-journée PayFit non interprétable')
    })
  })

  // ───────────────────────────── statuts ─────────────────────────────
  describe('statuses of the absences', () => {
    it('[rule-evp-payfit-status-admissible] [rule-evp-payfit-proof] an approved absence confirms the dossier; the proof keeps the raw PayFit status', async () => {
      const id = await seedSaisir()
      world([pfa()])
      await read()
      const res = await detail(id)
      expect(res.status).toBe('DANS_PAYFIT')
      expect(res.payfitProof).toMatchObject({ company: 'Société A', code: 'CP', sourceStatus: 'approved' })
      expect(await notifKinds(id)).toEqual(['CONFIRMATION'])
      expect((await sql("select status from base.payfit_absences where payfit_absence_id = 'pf-1'"))[0].status).toBe('approved')
    })

    it.each(['pending_approval', 'declined', 'cancelled', 'pending_cancellation'])('[rule-evp-payfit-status-admissible] an absence read with the status %s is kept but confirms nothing', async (status) => {
      const id = await seedSaisir()
      world([pfa({ status })])
      expect((await read()).state).toBe('SUCCEEDED')
      expect((await detail(id)).status).toBe('A_SAISIR')
      expect(await countRows('payfit_proofs')).toBe(0)
      expect((await sql("select status from base.payfit_absences where payfit_absence_id = 'pf-1'"))[0].status).toBe(status)
    })

    it.each([
      ['cancelled', 'ANNULEE', 'ANNULATION'],
      ['declined', 'ANNULEE', 'ANNULATION'],
      ['pending_approval', 'MODIFIEE', 'MODIFICATION'],
    ] as const)('[rule-evp-payfit-status-alerts] [rule-evp-payfit-status-all] a confirmed dossier whose absence is then read %s raises the alert %s (notification %s); the proof is kept', async (status, kind, notif) => {
      const id = await seedSaisir()
      world([pfa()])
      await read()
      world([pfa({ status })])
      await read()
      const res = await detail(id)
      expect(res.status).toBe('DANS_PAYFIT')
      expect(res.payfitAlert).toMatchObject({ kind })
      expect(res.payfitProof).toMatchObject({ code: 'CP', sourceStatus: 'approved' })
      expect(await notifKinds(id)).toEqual(['CONFIRMATION', notif])
      expect(await countRows('payfit_proofs', 'absence_id = $1', [id])).toBe(1)
    })

    it('[rule-evp-payfit-pending-cancellation][D-0002] dossier DANS_PAYFIT, absence read again as pending_cancellation: no cancellation alert notification is created and the dossier stays DANS_PAYFIT', async () => {
      const id = await seedSaisir()
      world([pfa()])
      await read()
      world([pfa({ status: 'pending_cancellation' })])
      const run = await read()
      expect(run.state).toBe('SUCCEEDED')
      const notifications = (await GET('/notifications', w.rh.token)).body.items
      expect(notifications.filter((n: any) => n.kind === 'ANNULATION' || n.kind === 'ANNULEE')).toEqual([])
      const res = await detail(id)
      expect(res.status).toBe('DANS_PAYFIT')
      expect(res.payfitAlert).toBeNull()
      expect(await notifKinds(id)).toEqual(['CONFIRMATION'])
    })

    it('[rule-evp-payfit-pending-cancellation] pending_cancellation neither raises a modification nor resolves an open alert; the cancellation alert is born when the status becomes cancelled', async () => {
      const id = await seedSaisir()
      world([pfa()])
      await read()
      world([pfa({ endDate: d(-3) })])
      await read()
      expect((await detail(id)).payfitAlert).toMatchObject({ kind: 'MODIFIEE' })
      const kinds = await notifKinds(id)
      world([pfa({ status: 'pending_cancellation' })])
      await read()
      expect((await detail(id)).payfitAlert).toMatchObject({ kind: 'MODIFIEE' })
      expect(await notifKinds(id)).toEqual(kinds)
      world([pfa({ status: 'cancelled' })])
      await read()
      expect((await detail(id)).payfitAlert).toMatchObject({ kind: 'ANNULEE' })
      expect(await notifKinds(id)).toEqual([...kinds, 'ANNULATION'])
    })

    it('[rule-evp-payfit-status-admissible] a proof recorded in the vocabulary of v1 (VALIDATED) read again as approved is not a modification: no alert, no notification', async () => {
      const id = await seedSaisir()
      world([pfa()])
      await read()
      await sql("update base.payfit_proofs set source_status = 'VALIDATED' where absence_id = $1", [id])
      const kinds = await notifKinds(id)
      await read()
      expect((await detail(id)).payfitAlert).toBeNull()
      expect(await notifKinds(id)).toEqual(kinds)
    })

    it('[rule-evp-payfit-alerts] reading the same data again raises nothing new', async () => {
      const id = await seedSaisir()
      world([pfa()])
      await read()
      const before = [await countRows('notifications'), await countRows('payfit_proofs'), await countRows('payfit_alerts'), await countRows('absence_events')]
      await read()
      await read()
      expect([await countRows('notifications'), await countRows('payfit_proofs'), await countRows('payfit_alerts'), await countRows('absence_events')]).toEqual(before)
      expect((await detail(id)).payfitAlert).toBeNull()
    })

    it('[rule-evp-payfit-alerts] [rule-evp-payfit-pagination] an absence no longer returned by a complete reading of its company raises a disappearance alert, and a restoration when it is found again', async () => {
      const id = await seedSaisir()
      world([pfa()])
      await read()
      world([])
      await read()
      expect((await detail(id)).payfitAlert).toMatchObject({ kind: 'DISPARUE' })
      expect(await notifKinds(id)).toEqual(['CONFIRMATION', 'DISPARITION'])
      world([pfa()])
      await read()
      expect(await notifKinds(id)).toEqual(['CONFIRMATION', 'DISPARITION', 'RESTAURATION'])
      expect(await countRows('payfit_proofs', 'absence_id = $1', [id])).toBe(1)
    })

    it.each(['cancelled', 'declined', 'approved'])('[rule-evp-payfit-status-admissible] [rule-evp-declare-overlap-blocks] an absence read as %s blocks an overlapping declaration only when it is approved (overlap_payfit)', async (status) => {
      world([pfa({ id: 'pf-existing', startDate: d(-6), endDate: d(-4), status })])
      await read()
      const res = await createAbsence(w.dirA.token, { contractId: w.ctA.id, startDate: d(-5), endDate: d(-3) })
      expect(res.status).toBe(201)
      const codes = res.body.blockages.map((b: any) => b.code)
      if (status === 'approved') {
        expect(res.body.status).toBe('A_COMPLETER')
        expect(codes).toContain('overlap_payfit')
      } else {
        expect(res.body.status).toBe('A_VALIDER')
        expect(codes).not.toContain('overlap_payfit')
      }
    })
  })

  // ───────────────────────────── types ─────────────────────────────
  describe('absence types', () => {
    it.each([
      ['CONGES_PAYES', 'fr_conges_payes'],
      ['CONGES_PAYES', 'fr_conges_payes_fractionnement'],
      ['ARRET_MALADIE', 'fr_maladie_ordinaire'],
      ['AUTRE', 'other'],
      ['CONGES_PAYES', 'CP'],
      ['CONGES_PAYES', 'CPA'],
    ])('[rule-evp-payfit-type-mapping] the dossier of type %s is confirmed by the PayFit code %s (configuration file and codes already set on the types)', async (typeCode, code) => {
      const id = await seedSaisir({ typeCode })
      world([pfa({ type: code })])
      await read()
      expect((await detail(id)).status).toBe('DANS_PAYFIT')
    })

    it('[rule-evp-payfit-type-mapping] a code that designates another type never confirms the dossier', async () => {
      const id = await seedSaisir({ typeCode: 'CONGES_PAYES' })
      world([pfa({ type: 'fr_maladie_ordinaire' })])
      await read()
      expect((await detail(id)).status).toBe('A_SAISIR')
      expect(await countRows('payfit_proofs')).toBe(0)
    })

    it('[rule-evp-payfit-type-unmapped] a code absent from the configuration is kept as it is, confirms nothing, and raises one single anomaly per code with the number of absences', async () => {
      const id = await seedSaisir()
      world([
        pfa({ id: 'pf-u1', type: 'fr_inconnu_x' }),
        pfa({ id: 'pf-u2', type: 'fr_inconnu_x', startDate: d(-20), endDate: d(-19) }),
        pfa({ id: 'pf-u3', type: 'fr_inconnu_x', startDate: d(-30), endDate: d(-29) }),
        pfa({ id: 'pf-u4', type: 'zz_autre', startDate: d(-40), endDate: d(-39) }),
      ])
      expect((await read()).state).toBe('SUCCEEDED')
      expect(await countRows('payfit_absences', "payfit_absence_id in ('pf-u1', 'pf-u2', 'pf-u3', 'pf-u4')")).toBe(4)
      expect((await detail(id)).status).toBe('A_SAISIR')
      const items = (await anomalies()).items.filter((i: any) => i.label === "Type d'absence PayFit non configuré")
      expect(items.map((i: any) => i.subject).sort()).toEqual(['fr_inconnu_x', 'zz_autre'])
      expect(items.find((i: any) => i.subject === 'fr_inconnu_x').detail).toContain('3')
    })

    it('[rule-evp-payfit-type-mapping] [rule-evp-sources-error-codes] a configuration file where one PayFit code designates two types is invalid: the reading ends FAILED with sources.not_configured and copies nothing', async () => {
      world([pfa()])
      await withConfigFile('PAYFIT_ABSENCE_TYPES_FILE', { CONGES_PAYES: ['fr_conflit'], AUTRE: ['fr_conflit'] }, async () => {
        const run = await read()
        expect(run.state).toBe('FAILED')
        expect((await sourceOf()).lastError.code).toBe('sources.not_configured')
        expect(await countRows('payfit_absences')).toBe(0)
      })
    })

    it('[rule-evp-payfit-type-mapping] the one-code-one-type rule also holds against the codes already set on the types: a file code already compatible with another type is invalid', async () => {
      world([pfa()])
      await withConfigFile('PAYFIT_ABSENCE_TYPES_FILE', { AUTRE: ['CP'] }, async () => {
        const run = await read()
        expect(run.state).toBe('FAILED')
        expect((await sourceOf()).lastError.code).toBe('sources.not_configured')
      })
    })

    it('[rule-evp-payfit-type-mapping] [rule-evp-sources-error-codes] a configuration file that is not JSON ends the reading FAILED with sources.not_configured, without quoting its content', async () => {
      world([pfa()])
      await withConfigFile('PAYFIT_ABSENCE_TYPES_FILE', 'ceci-n-est-pas-du-json', async () => {
        const run = await read()
        expect(run.state).toBe('FAILED')
        const src = await sourceOf()
        expect(src.lastError.code).toBe('sources.not_configured')
        expect(JSON.stringify(src.lastError)).not.toContain('ceci-n-est-pas-du-json')
      })
    })

    it('[rule-evp-payfit-type-mapping] GET /settings shows the code set on the type when there is one, else the first code of the configuration file', async () => {
      await sql("update base.absence_types set payfit_code = null, payfit_compatible_codes = '{}' where code = 'CONGES_PAYES'")
      const res = await GET('/settings', w.rh.token)
      expect(res.status).toBe(200)
      const byCode = (code: string) => res.body.absenceTypes.find((t: any) => t.code === code)
      expect(byCode('CONGES_PAYES').payfitCode).toBe('fr_conges_payes')
      expect(byCode('ARRET_MALADIE').payfitCode).toBe('MAL')
    })
  })

  // ───────────────────────────── droits et secrets ─────────────────────────────
  describe('rights and secrets', () => {
    it('[rule-evp-sources-manual] RH and the superadmin launch the PayFit reading; directrice, RO and administratrice are refused (403), anonymous 401, and PayFit is never called for them', async () => {
      for (const who of [w.dirA, w.roA, w.adm]) expect((await POST('/sources/payfit/refresh', who.token)).status).toBe(403)
      expect((await POST('/sources/payfit/refresh')).status).toBe(401)
      expect(net.log).toHaveLength(0)
      const started = await POST('/sources/payfit/refresh', w.sup.token)
      expect(started.status).toBe(202)
      expect((await waitRun(w.sup.token, started.body.runId)).state).toBe('SUCCEEDED')
    })

    it('[rule-evp-sources-refresh-audited] [rule-evp-secrets-never-exposed] each reading launched leaves an audit entry without key', async () => {
      await read()
      const entries = await auditRows('sources:refresh')
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ actor_id: w.rh.id, object_type: 'Lecture de source' })
      expectNoSecret('audit', JSON.stringify(entries))
    })

    it('[rule-evp-secrets-never-exposed] neither the keys nor the answers of PayFit appear in the run, the source, the anomalies, the audit trail, the notifications, the exports or the server log, after a success and after a failure', async () => {
      const offset = logSize()
      await seedSaisir()
      world([pfa()])
      await read()
      for (const s of [SIRET_A, SIRET_B]) pf.failAlways(s, 'collaborators', 401)
      const failed = await read()
      expect(failed.state).toBe('FAILED')
      expectNoSecret('run', JSON.stringify(failed))
      expectNoSecret('visible', await everythingVisible(w.sup.token, { GET, POST, sql }))
      expectNoSecret('server log', logSince(offset), [...configuredSecrets(), 'detail":"Bearer'])
    })
  })
})
