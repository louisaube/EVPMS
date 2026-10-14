import { resetData, closePool, sql } from './harness'
import { sleep } from './renfort-helpers'
import { http, GET, POST, seedWorld, World, countRows, closeEvp, refresh, waitRun, sortedKeys, SIRET_B, auditRows } from './evp-helpers'
import {
  AqoonaFake, FakeNet, PayfitFake, SheetsFake, aqBody, aqRow, d, describeStandard, expectNoSecret, payfitWorld, pfa, configuredSecrets,
} from './v2-helpers'
import { introspectScopes } from './v4-helpers'

const ERROR_CODES = ['sources.not_configured', 'sources.unreachable', 'sources.refused', 'sources.rate_limited', 'sources.unexpected_format']
const STATES = ['UP_TO_DATE', 'NEVER_READ', 'RUNNING', 'ERROR', 'UNAVAILABLE', 'PARTIAL']

// ─── lecture du document OpenAPI ───
const deref = (doc: any, node: any): any => {
  let cur = node
  while (cur && cur.$ref) cur = cur.$ref.replace(/^#\//, '').split('/').reduce((a: any, p: string) => a?.[decodeURIComponent(p)], doc)
  return cur
}
const variants = (doc: any, node: any): any[] => {
  const n = deref(doc, node)
  if (!n) return []
  const subs = [...(n.anyOf ?? []), ...(n.oneOf ?? []), ...(n.allOf ?? [])]
  return subs.length ? [n, ...subs.flatMap((s: any) => variants(doc, s))] : [n]
}

// Acceptance suite of version v2-evp-sources: state of the sources (GET /sources), runs, chaining « Toutes les sources »
// and contract of the responses, against the real driver and the fake servers of api/.env.test.
describeStandard('Sources state, runs and contract (v2-evp-sources)', () => {
  const net = new FakeNet()
  const sheets = new SheetsFake()
  const pf = new PayfitFake()
  let aq: AqoonaFake
  let w: World

  beforeAll(async () => {
    aq = new AqoonaFake()
    await sheets.mount(net)
    await pf.mount(net)
    await aq.mount(net)
  })
  afterAll(async () => {
    await net.close()
    await closeEvp()
    await closePool()
  })
  beforeEach(async () => {
    await resetData()
    sheets.reset()
    pf.reset()
    // v5 (rule-evp-payfit-scope-every-read): the double grants collaborators:social-security:read, so no scope anomaly disturbs this suite
    introspectScopes(pf)
    aq.reset()
    net.clear()
    w = await seedWorld()
    pf.companies = payfitWorld([pfa()], []).companies
  })

  const items = async (token = w.rh.token) => (await GET('/sources', token)).body.items as any[]
  const sourceOf = async (key: string, token = w.rh.token) => (await items(token)).find((i) => i.key === key)
  const firstCall = (re: RegExp) => net.log.find((r) => re.test(r.tag))?.seq ?? Infinity

  // ───────────────────────────── GET /sources ─────────────────────────────
  describe('GET /sources', () => {
    it('[rule-evp-sources-failure-state] [rule-evp-aqoona-mask] every source has the fields of v1 plus lastError and addresses; nothing has been read yet; the Aqoona addresses are listed masked, the others have none; no outgoing call is made', async () => {
      const list = await items()
      expect(list.map((i) => i.key).sort()).toEqual(['aqoona', 'payfit', 'sheets', 'workspace'])
      for (const i of list) {
        expect(sortedKeys(i)).toEqual(['addresses', 'anomalyCount', 'canRefresh', 'currentRunId', 'key', 'label', 'lastError', 'lastReadAt', 'state', 'volumes', 'windowFrom', 'windowTo'])
        expect(STATES).toContain(i.state)
        expect(i.lastError).toBeNull()
      }
      expect(list.find((i) => i.key === 'workspace').state).toBe('UP_TO_DATE')
      for (const key of ['sheets', 'payfit', 'aqoona']) {
        const s = list.find((i) => i.key === key)
        expect(s.state).toBe('NEVER_READ')
        expect(s.lastReadAt).toBeNull()
        if (key !== 'aqoona') expect(s.addresses).toEqual([])
      }
      const addresses = list.find((i) => i.key === 'aqoona').addresses
      expect(addresses).toEqual(aq.entries.map((e) => ({ label: e.label, masked: e.masked })))
      for (const a of addresses) {
        expect(a.label.length).toBeGreaterThanOrEqual(1)
        expect(a.label.length).toBeLessThanOrEqual(100)
        expect(a.masked.length).toBeGreaterThanOrEqual(1)
        expect(a.masked.length).toBeLessThanOrEqual(300)
        expect(a.masked).toMatch(/\?…$/)
        expect(a.masked.split('?')).toHaveLength(2)
      }
      await sleep(500)
      expect(net.log).toHaveLength(0)
    })

    it('[rule-evp-aqoona-url-secret] [rule-evp-aqoona-mask] the token and the complete address never appear in the answer of GET /sources, before or after a reading', async () => {
      const before = (await GET('/sources', w.rh.token)).text
      await refresh(w.rh.token, 'aqoona')
      const after = (await GET('/sources', w.rh.token)).text
      for (const text of [before, after]) expectNoSecret('GET /sources', text, aq.entries.flatMap((e) => e.secrets))
    })

    it('[rule-evp-sources-manual] only RH and the superadmin read the state of the sources (403 for the others, 401 anonymous), so the masked addresses are seen by them only', async () => {
      for (const who of [w.dirA, w.roA, w.adm]) {
        const res = await GET('/sources', who.token)
        expect(res.status).toBe(403)
        expect(res.text).not.toContain('masked')
      }
      expect((await GET('/sources')).status).toBe(401)
      for (const who of [w.rh, w.sup]) expect((await GET('/sources', who.token)).status).toBe(200)
    })

    it('[rule-evp-sources-failure-state] [rule-evp-sources-error-codes] a failed reading shows ERROR with lastError { code, message 1..200, at }, keeps the figures of the last success and clears the error at the next success', async () => {
      aq.set(0, { body: aqBody([aqRow({ matricule: 'MAT-1', day: d(-3) })]) })
      expect((await refresh(w.rh.token, 'aqoona')).state).toBe('SUCCEEDED')
      const ok = await sourceOf('aqoona')
      expect(ok).toMatchObject({ state: 'UP_TO_DATE', lastError: null })
      aq.setAll({ status: 403 })
      const failed = await refresh(w.rh.token, 'aqoona')
      expect(failed.state).toBe('FAILED')
      const bad = await sourceOf('aqoona')
      expect(bad.state).toBe('ERROR')
      expect(sortedKeys(bad.lastError)).toEqual(['at', 'code', 'message'])
      expect(ERROR_CODES).toContain(bad.lastError.code)
      expect(bad.lastError.message.length).toBeGreaterThanOrEqual(1)
      expect(bad.lastError.message.length).toBeLessThanOrEqual(200)
      expect(Date.parse(bad.lastError.at)).toBeGreaterThanOrEqual(Date.parse(failed.startedAt))
      expect(bad.lastReadAt).toBe(ok.lastReadAt)
      expect(bad.volumes).toEqual(ok.volumes)
      expect(failed.errorMessage).toBe(bad.lastError.message)
      aq.reset()
      expect((await refresh(w.rh.token, 'aqoona')).state).toBe('SUCCEEDED')
      expect(await sourceOf('aqoona')).toMatchObject({ state: 'UP_TO_DATE', lastError: null })
    })

    it('[rule-evp-sources-run-single] while a reading runs the source is RUNNING with its currentRunId; a second launch of the same source is refused 409 sources.run_in_progress while another source can still be read', async () => {
      for (const s of pf.companies) pf.fail(s.siret, 'company', { delayMs: 2500 })
      const first = await POST('/sources/payfit/refresh', w.rh.token)
      expect(first.status).toBe(202)
      expect(first.body.state).toBe('RUNNING')
      const running = await sourceOf('payfit')
      expect(running.state).toBe('RUNNING')
      expect(running.currentRunId).toBe(first.body.runId)
      const second = await POST('/sources/payfit/refresh', w.rh.token)
      expect(second.status).toBe(409)
      expect(second.body.code).toBe('sources.run_in_progress')
      const other = await POST('/sources/aqoona/refresh', w.rh.token)
      expect(other.status).toBe(202)
      await waitRun(w.rh.token, other.body.runId)
      expect((await waitRun(w.rh.token, first.body.runId)).state).toBe('SUCCEEDED')
      const done = await sourceOf('payfit')
      expect(done.state).toBe('UP_TO_DATE')
      expect(done.currentRunId).toBeNull()
    })

    it('[rule-evp-sources-run-single] [rule-evp-sources-failure-state] a run that has ended has an error message of 1..200 characters only when it failed; an unknown run is 404, a malformed identifier 400', async () => {
      const ok = await refresh(w.rh.token, 'aqoona')
      expect(ok.errorMessage).toBeNull()
      aq.setAll({ status: 401 })
      const ko = await refresh(w.rh.token, 'aqoona')
      expect(ko.errorMessage.length).toBeGreaterThanOrEqual(1)
      expect(ko.errorMessage.length).toBeLessThanOrEqual(200)
      expect((await GET('/sources/runs/00000000-0000-4000-8000-000000000000', w.rh.token)).status).toBe(404)
      expect((await GET('/sources/runs/nope', w.rh.token)).status).toBe(400)
    })
  })

  // ───────────────────────────── Toutes les sources ─────────────────────────────
  describe('POST /sources/refresh-all', () => {
    it('[rule-evp-sources-sheets-superadmin] [rule-evp-sources-refresh-audited] the superadmin chains Sheets, PayFit then Aqoona, in that order; every reading launched is traced without address or key', async () => {
      const started = await POST('/sources/refresh-all', w.sup.token)
      expect(started.status).toBe(202)
      expect(started.body.steps).toEqual(['sheets', 'payfit', 'aqoona'])
      const run = await waitRun(w.sup.token, started.body.runId)
      expect(run.state).toBe('SUCCEEDED')
      const s = firstCall(/^sheets/)
      const p = firstCall(/^payfit/)
      const a = firstCall(/^aqoona-/)
      expect(s).toBeLessThan(p)
      expect(p).toBeLessThan(a)
      for (const key of ['sheets', 'payfit', 'aqoona']) expect((await sourceOf(key, w.sup.token)).state).toBe('UP_TO_DATE')
      const traced = await auditRows()
      const entries = traced.filter((e) => String(e.action).startsWith('sources:refresh'))
      expect(entries.length).toBeGreaterThanOrEqual(1)
      for (const e of entries) expect(e).toMatchObject({ actor_id: w.sup.id, object_type: 'Lecture de source' })
      expectNoSecret('audit', JSON.stringify(traced), configuredSecrets())
    })

    it('[rule-evp-sources-sheets-superadmin] [rule-evp-sources-manual] RH and the others are refused 403 on « Toutes les sources », anonymous 401, and no source is called', async () => {
      for (const who of [w.rh, w.dirA, w.roA, w.adm]) expect((await POST('/sources/refresh-all', who.token)).status).toBe(403)
      expect((await POST('/sources/refresh-all')).status).toBe(401)
      expect(net.log).toHaveLength(0)
      expect(await countRows('source_runs')).toBe(0)
    })

    it('[rule-evp-sources-failure-state] [rule-evp-sources-sheets-superadmin] the first reading that fails stops the chain: PayFit and Aqoona are not read and keep their state', async () => {
      sheets.failValuesAlways(403)
      const started = await POST('/sources/refresh-all', w.sup.token)
      const run = await waitRun(w.sup.token, started.body.runId)
      expect(run.state).toBe('FAILED')
      expect(net.calls(/^payfit/)).toHaveLength(0)
      expect(net.calls(/^aqoona-/)).toHaveLength(0)
      expect((await sourceOf('sheets', w.sup.token)).state).toBe('ERROR')
      expect((await sourceOf('payfit', w.sup.token)).state).toBe('NEVER_READ')
      expect((await sourceOf('aqoona', w.sup.token)).state).toBe('NEVER_READ')
      expect(await countRows('source_runs', "source_key in ('payfit', 'aqoona')")).toBe(0)
    })

    it('[rule-evp-sources-partial-failure] [rule-evp-sources-sheets-superadmin] a partial PayFit reading does not stop the chain: Aqoona is read after it', async () => {
      pf.failAlways(SIRET_B, 'collaborators', 401)
      const started = await POST('/sources/refresh-all', w.sup.token)
      await waitRun(w.sup.token, started.body.runId)
      expect((await sourceOf('payfit', w.sup.token)).state).toBe('PARTIAL')
      expect((await sourceOf('aqoona', w.sup.token)).state).toBe('UP_TO_DATE')
      expect(net.calls(/^aqoona-/).length).toBeGreaterThanOrEqual(1)
    })

    it('[rule-evp-sources-failure-state] [rule-evp-sources-sheets-superadmin] a PayFit reading that fails entirely stops the chain before Aqoona', async () => {
      for (const s of pf.companies) pf.failAlways(s.siret, 'collaborators', 401)
      const started = await POST('/sources/refresh-all', w.sup.token)
      const run = await waitRun(w.sup.token, started.body.runId)
      expect(run.state).toBe('FAILED')
      expect((await sourceOf('payfit', w.sup.token)).state).toBe('ERROR')
      expect(net.calls(/^aqoona-/)).toHaveLength(0)
      expect((await sourceOf('aqoona', w.sup.token)).state).toBe('NEVER_READ')
    })
  })

  // ───────────────────────────── contrat ─────────────────────────────
  describe('contract of the responses', () => {
    it('[rule-evp-sources-error-codes] [rule-evp-aqoona-mask] the OpenAPI document carries the bounds of lastError.message (1..200), addresses[].label (1..100), addresses[].masked (1..300) and the states of the source, PARTIAL included', async () => {
      const res = await http('GET', '/api-json')
      expect(res.status).toBe(200)
      const doc = res.body
      const ok = doc.paths['/sources'].get.responses['200'].content['application/json'].schema
      const list = deref(doc, deref(doc, ok).properties.items)
      const item = deref(doc, list.items)
      const props = item.properties
      expect(item.required ?? []).toEqual(expect.arrayContaining(['lastError', 'addresses']))

      const lastError = variants(doc, props.lastError).find((v) => v.properties?.message)
      expect(lastError).toBeDefined()
      expect(lastError.properties.message).toMatchObject({ minLength: 1, maxLength: 200 })
      expect(deref(doc, lastError.properties.code).enum).toEqual(expect.arrayContaining(ERROR_CODES))
      expect(variants(doc, props.lastError).some((v) => v.type === 'null' || v.nullable === true)).toBe(true)

      const address = deref(doc, deref(doc, props.addresses).items)
      expect(address.properties.label).toMatchObject({ minLength: 1, maxLength: 100 })
      expect(address.properties.masked).toMatchObject({ minLength: 1, maxLength: 300 })

      expect(deref(doc, props.state).enum).toEqual(expect.arrayContaining(STATES))
    })

    it('[rule-evp-google-flow-redirect][D-0005] no route POST /google-sign-in/credential is part of the contract; the server flow routes are', async () => {
      const doc = (await http('GET', '/api-json')).body
      expect(doc.paths['/google-sign-in/credential']).toBeUndefined()
      expect(doc.paths['/google-sign-in/start']?.get).toBeDefined()
      expect(doc.paths['/google-sign-in/callback']?.get).toBeDefined()
    })

    it('[rule-evp-sources-manual] the operations of the sources keep their access: sources:list, sources:refresh and sources:refresh-all are declared on the same routes as in v1 (no operation added)', async () => {
      const doc = (await http('GET', '/api-json')).body
      const sourcesPaths = Object.keys(doc.paths).filter((p) => p.startsWith('/sources')).sort()
      // v4 adds the read-only GET /sources/aqoona/matching-rates (rule-evp-matching-rates-route): a route, not an operation of the sources
      // v5 adds the read-only GET /sources/aqoona/unlinked-people (rule-evp-unlinked-list)
      expect(sourcesPaths).toEqual(['/sources', '/sources/aqoona/matching-rates', '/sources/aqoona/unlinked-people', '/sources/refresh-all', '/sources/runs/{id}', '/sources/{key}/anomalies', '/sources/{key}/refresh'])
    })
  })

  describe('nothing runs by itself', () => {
    it('[rule-evp-sources-no-scheduler] after the processes have been idle, no reading was started and no external call was made', async () => {
      await sleep(3000)
      expect(net.log).toHaveLength(0)
      expect(await countRows('source_runs')).toBe(0)
      expect(await sql("select count(*)::int as n from base.audit_logs where action like 'sources:%'")).toEqual([{ n: 0 }])
    })
  })
})
