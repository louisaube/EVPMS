import { resetData, closePool, sql } from './harness'
import {
  GET, POST, http, seedWorld, World, closeEvp, refresh, writeFixture, clearFixtures, payfitFixture, PayfitFixture, countRows, sortedKeys, auditCount, waitRun,
} from './evp-helpers'
import { RATES_PATH, d, insertSlot, ratesOf } from './v4-helpers'

// Acceptance suite of version v4-evp-fiabilite-nir, part 1: GET /sources/aqoona/matching-rates (access, states, read-only).
// Default API variant (fake sources).
// v5-evp-rattachement-nir: the rates are now counted in persons per company, with the parts « linked » and « unlinked », and the
// stored mode is NIR or AUCUN (NOM and INCONNU only remain on rows older than v5, which make the rates unavailable). The tests of this file that described the v4 shape (three parts byNir / byName / unmatched,
// mode NOM / AUCUN, name fallback) were replaced by those of acceptance-v5-people-rates and acceptance-v5-linking (request v5,
// « les tests anciens fondés sur le nom sont réécrits par QA »). What stays here does not depend on the parts.
describe('Aqoona matching rates per company (v4-evp-fiabilite-nir)', () => {
  let w: World

  beforeEach(async () => {
    await resetData()
    clearFixtures()
    w = await seedWorld()
    await sql("update base.payfit_contracts set status = 'ACTIVE'")
  })
  afterAll(async () => {
    await closeEvp()
    await closePool()
  })

  type Row = Record<string, unknown>
  const row = (over: Row = {}): Row => ({ firstName: 'Léa', lastName: 'Martin', matricule: null, crecheName: 'Crèche Alpha', day: d(-3), start: '08:00', end: '12:00', ...over })

  /** payfit.json cohérent avec `seedWorld()` ; `nirs` donne le NIR de collaboratrices (par identifiant PayFit). */
  function payfitWithNirs(nirs: Record<string, string>, extra: Partial<PayfitFixture> & Row = {}): void {
    const fixture: any = payfitFixture([], extra as any)
    fixture.employees = fixture.employees.map((e: any) => (nirs[e.id] ? { ...e, nir: nirs[e.id] } : e))
    writeFixture('payfit', fixture)
  }
  const readAqoona = async (rows: Row[]) => {
    writeFixture('aqoona', { rows })
    return refresh(w.rh.token, 'aqoona')
  }
  const aqoonaSource = async () => (await GET('/sources', w.rh.token)).body.items.find((i: any) => i.key === 'aqoona')
  const rates = async (token = w.rh.token) => {
    const res = await ratesOf(token)
    expect({ status: res.status, text: res.status === 200 ? '' : res.text }).toEqual({ status: 200, text: '' })
    return res.body
  }
  /** Lecture d'Aqoona vide : positionne « dernière lecture réussie » et la fenêtre, sans créneau. */
  const readEmpty = async () => {
    payfitWithNirs({})
    expect((await readAqoona([])).state).toBe('SUCCEEDED')
  }

  // ───────────────────────────── droits ─────────────────────────────
  describe('access', () => {
    it('[rule-evp-matching-rates-route] [rule-evp-matching-rates-same-rights] RH and SUPERADMIN read the rates: 200 with exactly the fields of the contract', async () => {
      await readEmpty()
      for (const who of [w.rh, w.sup]) {
        const res = await ratesOf(who.token)
        expect(res.status).toBe(200)
        expect(sortedKeys(res.body)).toEqual(['available', 'items', 'lastReadAt', 'windowFrom', 'windowTo'])
        expect(typeof res.body.available).toBe('boolean')
        expect(Array.isArray(res.body.items)).toBe(true)
      }
    })

    it('[rule-evp-matching-rates-same-rights] directrice, RO and ADMINISTRATRICE get 403 with a body { status, code, message } and no data; anonymous and invalid token get 401', async () => {
      await readEmpty()
      for (const who of [w.dirA, w.dirB, w.roA, w.roB, w.adm]) {
        const res = await ratesOf(who.token)
        expect(res.status).toBe(403)
        expect(res.body).toEqual({ status: 403, code: expect.any(String), message: expect.any(String) })
        expect(res.text).not.toContain('items')
      }
      const anonymous = await ratesOf()
      expect(anonymous.status).toBe(401)
      expect(anonymous.body).toEqual({ status: 401, code: expect.any(String), message: expect.any(String) })
      expect((await ratesOf('not-a-token')).status).toBe(401)
    })

    it('[rule-evp-matching-rates-route] only GET exists on the path; it does not shadow the neighbouring routes of the sources', async () => {
      await readEmpty()
      // the path exists for GET (the other methods below answer 404/405 even before the route is written)
      const get = await ratesOf(w.rh.token)
      expect(get.status).toBe(200)
      expect(sortedKeys(get.body)).toEqual(['available', 'items', 'lastReadAt', 'windowFrom', 'windowTo'])
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const res = await http(method, RATES_PATH, { token: w.sup.token, body: {} })
        expect([404, 405]).toContain(res.status)
      }
      expect((await GET('/sources/payfit/matching-rates', w.rh.token)).status).toBe(404)
      expect((await GET('/sources/aqoona/anomalies', w.rh.token)).status).toBe(200)
      // v5: the launched run is awaited, so that it never overlaps with the next test (the answer stays 202)
      const started = await POST('/sources/aqoona/refresh', w.rh.token)
      expect(started.status).toBe(202)
      await waitRun(w.rh.token, started.body.runId)
    })

    it('[rule-evp-matching-rates-live] [rule-evp-sources-readonly] reading the rates writes nothing: no audit entry, no run, no notification, no new table', async () => {
      await readEmpty()
      const tables = async () => (await sql("select tablename from pg_tables where schemaname = 'base' order by tablename")).map((t) => t.tablename)
      const before = { audit: await auditCount(), runs: await countRows('source_runs'), notifications: await countRows('notifications'), tables: await tables() }
      for (let i = 0; i < 3; i++) await rates()
      expect({ audit: await auditCount(), runs: await countRows('source_runs'), notifications: await countRows('notifications'), tables: await tables() }).toEqual(before)
      // no stored aggregate: no table is named after the rates
      expect(before.tables.filter((t) => /rate|taux|matching|aggreg|stat/i.test(t))).toEqual([])
    })
  })

  // ───────────────────────────── états sans taux ─────────────────────────────
  describe('states without rates', () => {
    it('[rule-evp-matching-rates-route] Aqoona never read successfully: available false, lastReadAt and window null, no item — even if slots are stored', async () => {
      const empty = { available: false, lastReadAt: null, windowFrom: null, windowTo: null, items: [] }
      expect(await rates()).toEqual(empty)
      await insertSlot('NIR', { companyId: 'co-a' })
      await insertSlot('NIR', { companyId: 'co-b', crecheCode: 'beta' })
      expect(await rates()).toEqual(empty)
      expect((await aqoonaSource()).state).toBe('NEVER_READ')
    })

    it('[rule-evp-matching-rates-route] read with success but no slot in the window: available true and no item; lastReadAt and the window are those of GET /sources', async () => {
      await readEmpty()
      const body = await rates()
      const source = await aqoonaSource()
      expect(body.available).toBe(true)
      expect(body.items).toEqual([])
      expect(body.lastReadAt).not.toBeNull()
      expect(Date.parse(body.lastReadAt)).toBe(Date.parse(source.lastReadAt))
      expect(body.windowFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(body.windowTo).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect({ from: body.windowFrom, to: body.windowTo }).toEqual({ from: source.windowFrom, to: source.windowTo })
    })
  })

  // ───────────────────────────── contrat ─────────────────────────────
  describe('contract', () => {
    it('[rule-evp-matching-rates-same-rights] the operation answers 401 and 403 in the documented error shape and declares no other error (no input to validate)', async () => {
      const doc = (await http('GET', '/api-json')).body
      // the operation must exist before its details are read: a missing route is a red assertion, not a crash
      expect(Object.keys(doc.paths)).toContain(RATES_PATH)
      const get = doc.paths[RATES_PATH]?.get
      expect(get).toBeDefined()
      const codes = Object.keys(get.responses)
      expect(codes).toEqual(expect.arrayContaining(['200', '401', '403']))
      expect(codes.filter((c) => /^4/.test(c)).sort()).toEqual(['401', '403'])
      expect(get.parameters ?? []).toEqual([])
      expect(get.requestBody).toBeUndefined()
    })
  })
})
