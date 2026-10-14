import { resetData, closePool, sql } from './harness'
import { logSince, logSize } from './renfort-helpers'
import { GET, POST, http, seedWorld, World, closeEvp, clearFixtures, waitRun, countRows, sortedKeys, auditCount } from './evp-helpers'
import { expectNoNir } from './v3-helpers'
import {
  BAD1, BAD3, CAUSES, Cause, NIR1, NIR2, NIR4, NIR_KO, NO_COMPANY_NAME, PersonItem, RATES_PATH, RateItemV5, SIRET_A, SIRET_B, UNLINKED_PATH, V4_NIRS, addCompany,
  bound, d, deref, expectNoLongDigits, expectedRate, isNullable, kit, normalise, payfitWith, personsOf, rateOfCompany, ratesOf, row, sameName, seedLinked, seedSlot,
  seedUnlinked, slots, spaced, summary, unlinkedOf, variants,
} from './v5-helpers'

// Acceptance suite of version v5-evp-rattachement-nir, part 2: the rates of attachment counted in persons
// (GET /sources/aqoona/matching-rates, new shape linked / unlinked) and the list of the persons not linked
// (GET /sources/aqoona/unlinked-people, new route): rights, states, computation, order, paging, confidentiality, OpenAPI contract.
// Default API variant (fake sources). Slots are posted by SQL where the rule is about the computation, and produced by a real
// (fake-driver) reading where it is about the attachment.
describe('Rates in persons and list of the persons not linked (v5-evp-rattachement-nir)', () => {
  let w: World
  const { readAqoona, sourceOf, anomaliesOf, volume, rates, people } = kit(() => w)
  const pad = (n: number, size = 2): string => String(n).padStart(size, '0')

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

  /** Aqoona read with success and no slot: sets « last successful reading » and the window, without any slot. */
  const readEmpty = async () => {
    payfitWith()
    expect((await readAqoona([])).state).toBe('SUCCEEDED')
  }

  // ───────────────────────────── droits ─────────────────────────────
  describe('access', () => {
    it('[rule-evp-matching-rates-route] [rule-evp-matching-rates-same-rights] [rule-evp-unlinked-list-same-rights] RH and SUPERADMIN read the rates and the list: 200 with exactly the fields of the contract', async () => {
      await readEmpty()
      for (const who of [w.rh, w.sup]) {
        const rate = await ratesOf(who.token)
        expect(rate.status).toBe(200)
        expect(sortedKeys(rate.body)).toEqual(['available', 'items', 'lastReadAt', 'windowFrom', 'windowTo'])
        const list = await unlinkedOf(who.token)
        expect(list.status).toBe(200)
        expect(sortedKeys(list.body)).toEqual(['available', 'items', 'lastReadAt', 'total', 'windowFrom', 'windowTo'])
        expect(typeof list.body.available).toBe('boolean')
        expect(Array.isArray(list.body.items)).toBe(true)
        expect(Number.isInteger(list.body.total)).toBe(true)
      }
    })

    it('[rule-evp-matching-rates-same-rights] [rule-evp-unlinked-list-same-rights] directrice, RO and ADMINISTRATRICE get 403 with a body { status, code, message } and no data; anonymous and invalid token get 401 — on both routes', async () => {
      await readEmpty()
      for (const call of [(t?: string) => ratesOf(t), (t?: string) => unlinkedOf(t)]) {
        for (const who of [w.dirA, w.dirB, w.roA, w.roB, w.adm]) {
          const res = await call(who.token)
          expect(res.status).toBe(403)
          expect(res.body).toEqual({ status: 403, code: expect.any(String), message: expect.any(String) })
          expect(res.text).not.toContain('items')
        }
        const anonymous = await call()
        expect(anonymous.status).toBe(401)
        expect(anonymous.body).toEqual({ status: 401, code: expect.any(String), message: expect.any(String) })
        expect((await call('not-a-token')).status).toBe(401)
      }
    })

    it('[rule-evp-unlinked-list-same-rights] [rule-evp-unlinked-list-paging] the access is decided before the parameters: an invalid size is 401 without session and 403 for a role without the right, 400 only for RH and SUPERADMIN', async () => {
      await readEmpty()
      expect((await unlinkedOf(undefined, { size: 30 })).status).toBe(401)
      for (const who of [w.dirA, w.roA, w.adm]) expect((await unlinkedOf(who.token, { size: 30 })).status).toBe(403)
      for (const who of [w.rh, w.sup]) expect((await unlinkedOf(who.token, { size: 30 })).status).toBe(400)
    })

    it('[rule-evp-unlinked-list] [rule-evp-matching-rates-route] only GET exists on both paths; they do not shadow the neighbouring routes of the sources (reading is awaited: the test leaves no background reading)', async () => {
      await readEmpty()
      for (const path of [RATES_PATH, UNLINKED_PATH]) {
        expect((await http('GET', path, { token: w.rh.token })).status).toBe(200)
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
          const res = await http(method, path, { token: w.sup.token, body: {} })
          expect({ path, method, ok: [404, 405].includes(res.status) }).toEqual({ path, method, ok: true })
        }
      }
      expect((await GET('/sources/payfit/matching-rates', w.rh.token)).status).toBe(404)
      expect((await GET('/sources/payfit/unlinked-people', w.rh.token)).status).toBe(404)
      expect((await GET('/sources/aqoona/anomalies', w.rh.token)).status).toBe(200)
      const started = await POST('/sources/aqoona/refresh', w.rh.token)
      expect(started.status).toBe(202)
      expect((await waitRun(w.rh.token, started.body.runId)).state).toBe('SUCCEEDED')
    })

    it('[rule-evp-matching-rates-live] [rule-evp-unlinked-list-no-nir] [rule-evp-sources-readonly] reading the rates and the list writes nothing: no audit entry, no run, no notification, no new table', async () => {
      await readEmpty()
      const tables = async () => (await sql("select tablename from pg_tables where schemaname = 'base' order by tablename")).map((t) => t.tablename)
      const before = { audit: await auditCount(), runs: await countRows('source_runs'), notifications: await countRows('notifications'), tables: await tables() }
      for (let i = 0; i < 3; i++) {
        await rates()
        await people()
      }
      expect({ audit: await auditCount(), runs: await countRows('source_runs'), notifications: await countRows('notifications'), tables: await tables() }).toEqual(before)
      expect(before.tables.filter((t) => /rate|taux|matching|aggreg|stat|unlinked|people|personne/i.test(t))).toEqual([])
    })
  })

  // ───────────────────────────── états sans taux ─────────────────────────────
  describe('states without rates', () => {
    it('[rule-evp-matching-rates-route] [rule-evp-unlinked-list] Aqoona never read successfully: available false, lastReadAt and window null, no item, total 0 — even if slots are stored', async () => {
      const emptyRates = { available: false, lastReadAt: null, windowFrom: null, windowTo: null, items: [] }
      const emptyList = { ...emptyRates, total: 0 }
      expect(await rates()).toEqual(emptyRates)
      expect(await people()).toEqual(emptyList)
      await seedLinked('co-a', 'emp-ct-a1')
      await seedUnlinked('Personne Seule', 'NIR_ABSENT')
      expect(await rates()).toEqual(emptyRates)
      expect(await people()).toEqual(emptyList)
      expect((await sourceOf()).state).toBe('NEVER_READ')
    })

    it('[rule-evp-matching-rates-route] [rule-evp-unlinked-list] read with success but no person: available true, no item, total 0; lastReadAt and the window are those of GET /sources', async () => {
      await readEmpty()
      const source = await sourceOf()
      for (const body of [await rates(), await people()]) {
        expect(body.available).toBe(true)
        expect(body.items).toEqual([])
        expect(Date.parse(body.lastReadAt)).toBe(Date.parse(source.lastReadAt))
        expect(body.windowFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(body.windowTo).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect({ from: body.windowFrom, to: body.windowTo }).toEqual({ from: source.windowFrom, to: source.windowTo })
      }
      expect((await people()).total).toBe(0)
    })

    it('[rule-evp-matching-rates-unknown-mode] a slot written before v5 (mode NOM, INCONNU or the default value) among slots of the new modes: both routes answer 200, available false, no item, total 0 — no partial rate, no partial list; the last reading and the window are kept', async () => {
      for (const legacy of ['NOM', 'INCONNU', 'DEFAULT'] as const) {
        await resetData()
        clearFixtures()
        w = await seedWorld()
        await readEmpty()
        await seedLinked('co-a', 'emp-ct-a1')
        await seedUnlinked('Personne Seule', 'NIR_ABSENT')
        await seedSlot(legacy, { personRef: 'Ancienne ligne', companyId: 'co-a' })
        const source = await sourceOf()
        for (const res of [await ratesOf(w.rh.token), await unlinkedOf(w.rh.token)]) {
          expect({ legacy, status: res.status }).toEqual({ legacy, status: 200 })
          expect(res.body.available).toBe(false)
          expect(res.body.items).toEqual([])
          expect(Date.parse(res.body.lastReadAt)).toBe(Date.parse(source.lastReadAt))
          expect({ from: res.body.windowFrom, to: res.body.windowTo }).toEqual({ from: source.windowFrom, to: source.windowTo })
          expect(res.text).not.toMatch(/INCONNU|unknown|inconnu/i)
        }
        expect((await unlinkedOf(w.rh.token)).body.total).toBe(0)
      }
    })

    it('[rule-evp-matching-rates-unknown-mode] the next complete reading of Aqoona replaces the slots written before v5: the rates and the list come back', async () => {
      await readEmpty()
      await seedSlot('NOM', { personRef: 'Ancienne ligne', companyId: 'co-a', employeeId: 'emp-ct-a1', employeeCompanyId: 'co-a' })
      expect((await rates()).available).toBe(false)
      expect((await people()).available).toBe(false)
      payfitWith({ 'emp-ct-a1': NIR1 })
      expect((await readAqoona([row({ matricule: NIR1, day: d(-2) })])).state).toBe('SUCCEEDED')
      expect(summary((await rates()).items)).toEqual([['co-a', 1, 0]])
      expect(await people()).toMatchObject({ available: true, total: 0, items: [] })
      expect((await slots()).map((s) => s.match_method)).toEqual(['NIR'])
    })
  })

  // ───────────────────────────── calcul des taux ─────────────────────────────
  describe('computation of the rates', () => {
    it('[rule-evp-matching-rates-people] [rule-evp-matching-rates-company-of-person] persons, not slots: an attached person counts once whatever her slots and crèches, for her reference company; a person not linked counts once per company of the crèches where she was read', async () => {
      await readEmpty()
      // attached: emp-ct-a1 (3 slots in Alpha, 1 in Beta — a floating employee) and emp-ct-a2: two persons of company A, none of company B
      for (const day of [-6, -5, -4]) await seedLinked('co-a', 'emp-ct-a1', { companyId: 'co-a', crecheCode: 'alpha', day: d(day) })
      await seedLinked('co-a', 'emp-ct-a1', { companyId: 'co-b', crecheCode: 'beta', day: d(-6) })
      await seedLinked('co-a', 'emp-ct-a2', { companyId: 'co-a', crecheCode: 'alpha', day: d(-6), start: '13:00', end: '17:00' })
      // not linked: Léa Martin (twice in Alpha, written differently), Zoé Durand (in Alpha and in Beta)
      await seedUnlinked('Léa Martin', 'NIR_ABSENT', { companyId: 'co-a', crecheCode: 'alpha', day: d(-2) })
      await seedUnlinked('LEA  martin', 'NIR_ABSENT', { companyId: 'co-a', crecheCode: 'alpha', day: d(-1) })
      await seedUnlinked('Zoé Durand', 'NIR_UNKNOWN', { companyId: 'co-a', crecheCode: 'alpha', day: d(-2) })
      await seedUnlinked('Zoé Durand', 'NIR_UNKNOWN', { companyId: 'co-b', crecheCode: 'beta', day: d(-2) })
      const body = await rates()
      expect(body.available).toBe(true)
      expect(body.items).toEqual([expectedRate('co-a', SIRET_A, 'Société A', 2, 2), expectedRate('co-b', SIRET_B, 'Société B', 0, 1)])
    })

    it('[rule-evp-matching-rates-people] [rule-evp-matching-rates-company-of-person] an attached person counts for the company of her reference even when every slot was read in another company; no line for a company that has no person', async () => {
      await readEmpty()
      await seedLinked('co-b', 'emp-ct-b1', { companyId: 'co-a', crecheCode: 'alpha', day: d(-2) })
      const body = await rates()
      expect(body.items).toEqual([expectedRate('co-b', SIRET_B, 'Société B', 1, 0)])
      expect(rateOfCompany(body.items, 'co-a')).toBeUndefined()
    })

    it('[rule-evp-matching-rates-percent] the percentage is round(100 × count / total, 1) with exact counts: 1/3 is 33.3, 2/3 is 66.7, 1/6 is 16.7, 5/6 is 83.3, 1/8 is 12.5, all in one part is 100; total is linked + unlinked', async () => {
      await readEmpty()
      const plan: Array<[string, string, string, number, number]> = [
        ['co-t', '33333333333333', 'Tiers', 1, 2],
        ['co-s', '66666666666666', 'Sixième', 1, 5],
        ['co-h', '88888888888888', 'Huitième', 1, 7],
        ['co-u', '99999999999999', 'Unanime', 2, 0],
        ['co-n', '77777777777777', 'Nul', 0, 2],
      ]
      for (const [id, siret, name, linked, unlinked] of plan) {
        await addCompany(id, siret, name)
        for (let i = 0; i < linked; i++) await seedLinked(id, `emp-${id}-${i}`, { companyId: id, crecheCode: null })
        for (let i = 0; i < unlinked; i++) await seedUnlinked(`Personne ${id} ${i}`, 'NIR_ABSENT', { companyId: id, crecheCode: null })
      }
      const items = (await rates()).items as RateItemV5[]
      const byName = (n: string) => items.find((i) => i.name === n)!
      expect(byName('Tiers')).toEqual({ companyId: 'co-t', siret: '33333333333333', name: 'Tiers', total: 3, linked: { count: 1, percent: 33.3 }, unlinked: { count: 2, percent: 66.7 } })
      expect(byName('Sixième')).toMatchObject({ total: 6, linked: { count: 1, percent: 16.7 }, unlinked: { count: 5, percent: 83.3 } })
      expect(byName('Huitième')).toMatchObject({ total: 8, linked: { count: 1, percent: 12.5 }, unlinked: { count: 7, percent: 87.5 } })
      expect(byName('Unanime')).toMatchObject({ total: 2, linked: { count: 2, percent: 100 }, unlinked: { count: 0, percent: 0 } })
      expect(byName('Nul')).toMatchObject({ total: 2, linked: { count: 0, percent: 0 }, unlinked: { count: 2, percent: 100 } })
      for (const item of items) {
        expect(item.total).toBe(item.linked.count + item.unlinked.count)
        expect(item.total).toBeGreaterThanOrEqual(1)
        for (const part of [item.linked, item.unlinked]) expect(Math.round(part.percent * 10) / 10).toBe(part.percent)
      }
    })

    it('[rule-evp-matching-rates-no-company] [rule-evp-matching-rates-company-of-person] persons whose company is unknown (crèche unknown, company absent from PayFit, reference company absent from PayFit) are in the same last line « Sans société identifiée », with no identifier of the vanished company', async () => {
      await readEmpty()
      await seedLinked('co-a', 'emp-ct-a1', { companyId: 'co-gone', crecheCode: null, day: d(-2) }) // read in a vanished company: counts for co-a
      await seedLinked('co-gone', 'emp-ct-gone', { companyId: 'co-a', crecheCode: 'alpha', day: d(-2) }) // her reference company vanished
      await seedUnlinked('Sans Crèche', 'NIR_ABSENT', { companyId: null, crecheCode: null, day: d(-2) })
      await seedUnlinked('Crèche Disparue', 'NIR_UNKNOWN', { companyId: 'co-gone', crecheCode: null, day: d(-2) })
      const items = (await rates()).items as RateItemV5[]
      expect(items).toEqual([expectedRate('co-a', SIRET_A, 'Société A', 1, 0), expectedRate(null, null, NO_COMPANY_NAME, 1, 2)])
      expect(JSON.stringify(items)).not.toContain('co-gone')
    })

    it('[rule-evp-matching-rates-no-company][D-0015] GET /sources/aqoona/matching-rates with two rows, one from an establishment unknown of the referential (no NIR) and one attached by NIR to a collaborator of Alpha, after a reading of Aqoona: 200, items contains the line of Alpha (total 1, linked.count 1) and a line companyId null « Sans société identifiée » (total 1, unlinked.count 1)', async () => {
      payfitWith({ 'emp-ct-a1': NIR1 })
      const run = await readAqoona([
        row({ firstName: 'Prénom', lastName: 'Différent', matricule: NIR1, day: d(-3) }),
        row({ firstName: 'Léa', lastName: 'Martin', crecheName: 'Établissement Inconnu', day: d(-2) }),
      ])
      expect(run.state).toBe('SUCCEEDED')
      const res = await ratesOf(w.rh.token)
      expect(res.status).toBe(200)
      expect(res.body.available).toBe(true)
      expect(res.body.items).toContainEqual(expectedRate('co-a', SIRET_A, 'Société A', 1, 0))
      expect(res.body.items).toContainEqual(expectedRate(null, null, NO_COMPANY_NAME, 0, 1))
      expect(res.body.items).toHaveLength(2)
      expect(res.body.items[0]).toMatchObject({ companyId: 'co-a', total: 1, linked: { count: 1 } })
      expect(res.body.items[1]).toMatchObject({ companyId: null, siret: null, name: 'Sans société identifiée', total: 1, unlinked: { count: 1 } })
      expect(volume((await sourceOf()).volumes, 'Plannings lus')).toEqual({ label: 'Plannings lus', count: 2 })
    })

    it('[rule-evp-matching-rates-company-of-person] [rule-evp-matching-rates-no-company] companies are sorted by name in French order (case and accents ignored), then by identifier; the line without company is last whatever its name would give; only companies with a person are listed', async () => {
      await readEmpty()
      await addCompany('co-z', '10000000000001', 'Zèbre')
      await addCompany('co-e2', '10000000000002', 'eclair')
      await addCompany('co-e1', '10000000000003', 'Éclair')
      await addCompany('co-a0', '10000000000004', 'Abeille')
      await addCompany('co-t', '10000000000005', 'étoile')
      await addCompany('co-empty', '10000000000006', 'Aaa sans personne')
      for (const id of ['co-z', 'co-e2', 'co-e1', 'co-a0', 'co-t']) await seedUnlinked(`Personne ${id}`, 'NIR_ABSENT', { companyId: id, crecheCode: null })
      await seedUnlinked('Personne sans société', 'NIR_ABSENT', { companyId: null, crecheCode: null })
      const items = (await rates()).items as RateItemV5[]
      expect(items.map((i) => [i.companyId, i.name])).toEqual([
        ['co-a0', 'Abeille'],
        ['co-e1', 'Éclair'],
        ['co-e2', 'eclair'],
        ['co-t', 'étoile'],
        ['co-z', 'Zèbre'],
        [null, NO_COMPANY_NAME],
      ])
      expect(items.find((i) => i.companyId === 'co-z')!.siret).toBe('10000000000001')
      // persons, not slots: a second slot of the same person adds nobody
      await seedUnlinked('Personne co-z', 'NIR_ABSENT', { companyId: 'co-z', crecheCode: null, day: d(-1) })
      expect(summary((await rates()).items)).toEqual([['co-a0', 0, 1], ['co-e1', 0, 1], ['co-e2', 0, 1], ['co-t', 0, 1], ['co-z', 0, 1], [null, 0, 1]])
    })

    it('[rule-evp-matching-rates-live] the rates follow the stored slots at once, and a new reading replaces them', async () => {
      payfitWith({ 'emp-ct-a1': NIR1 })
      await readAqoona([row({ matricule: NIR1, day: d(-3) }), row({ firstName: 'Noé', lastName: 'Petit', day: d(-3) })])
      expect(summary((await rates()).items)).toEqual([['co-a', 1, 1]])
      await seedUnlinked('Ajoutée Par Sql', 'NIR_UNKNOWN', { companyId: 'co-a', day: d(-1) })
      expect(summary((await rates()).items)).toEqual([['co-a', 1, 2]])
      expect((await people()).total).toBe(2)
      await sql("delete from base.aqoona_plannings where person_ref = 'Ajoutée Par Sql'")
      expect(summary((await rates()).items)).toEqual([['co-a', 1, 1]])
      await readAqoona([row({ firstName: 'Zoé', lastName: 'Durand', crecheName: 'Crèche Beta', day: d(-1) })])
      expect(summary((await rates()).items)).toEqual([['co-b', 0, 1]])
    })

    it('[rule-evp-matching-rates-people] persons without any name are one person by company and by cause in the list; in the rates they count once per company', async () => {
      payfitWith({ 'emp-ct-a1': NIR1 })
      await readAqoona([
        row({ firstName: '', lastName: '', matricule: NIR4, day: d(-4) }),
        row({ firstName: '', lastName: '', matricule: NIR4, crecheName: 'Crèche Beta', day: d(-3) }),
        row({ firstName: '', lastName: '', matricule: BAD1, day: d(-2) }),
      ])
      const list = await people()
      expect(list.total).toBe(2)
      expect(list.items.map((i: any) => [i.name, i.cause, i.creches])).toEqual([
        ['Personne non nommée', 'NIR_KEY_INVALID', ['Crèche Alpha']],
        ['Personne non nommée', 'NIR_UNKNOWN', ['Crèche Alpha', 'Crèche Beta']],
      ])
      expect(rateOfCompany((await rates()).items, 'co-a')?.unlinked.count).toBe(1)
      expect(rateOfCompany((await rates()).items, 'co-b')?.unlinked.count).toBe(1)
    })
  })

  // ───────────────────────────── cohérence avec une vraie lecture ─────────────────────────────
  describe('consistency with a reading', () => {
    it('[rule-evp-matching-rates-consistency] the sum of linked.count is the number of distinct attached employees, « Plannings rattachés » equals « Rapprochés par NIR » and counts only slots of attached persons, and every person counted as not linked is in the list', async () => {
      payfitWith({ 'emp-ct-a1': NIR1, 'emp-ct-a2': NIR2, 'emp-ct-b1': BAD3 })
      const run = await readAqoona([
        row({ matricule: NIR1, crecheName: 'Crèche Alpha', day: d(-6) }),
        row({ matricule: NIR1, crecheName: 'Crèche Beta', day: d(-5) }),
        row({ matricule: NIR1, crecheName: 'Crèche Alpha', day: d(-4) }),
        row({ firstName: 'Noé', lastName: 'Petit', matricule: NIR2, day: d(-3) }),
        row({ firstName: 'Noé', lastName: 'Petit', matricule: '', crecheName: 'Crèche Beta', day: d(-2) }),
        row({ firstName: 'Zoé', lastName: 'Durand', crecheName: 'Crèche Beta', matricule: BAD3, day: d(-3) }),
        row({ firstName: 'Una', lastName: 'Inconnue', matricule: NIR4, day: d(-2) }),
        row({ firstName: '', lastName: '', matricule: null, day: d(-1) }),
      ])
      expect(run.state).toBe('SUCCEEDED')
      const stored = await slots()
      const attached = stored.filter((s) => s.employee_id !== null)
      const pairs = new Set(attached.map((s) => `${s.employee_company_id}/${s.employee_id}`))
      const body = await rates()
      const sumLinked = (body.items as RateItemV5[]).reduce((n, i) => n + (i.linked?.count ?? 0), 0)
      expect(sumLinked).toBe(pairs.size)
      expect(pairs.size).toBe(2)
      for (const volumes of [run.volumes, (await sourceOf()).volumes]) {
        expect(volume(volumes, 'Plannings lus')).toEqual({ label: 'Plannings lus', count: 8 })
        expect(volume(volumes, 'Plannings rattachés')).toEqual({ label: 'Plannings rattachés', count: attached.length })
        expect(volume(volumes, 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count: attached.length })
      }
      const listed = new Set((await people({ size: 50 })).items.map((i: PersonItem) => normalise(i.name)))
      const notLinked = new Set(stored.filter((s) => s.unlinked_cause !== null).map((s) => normalise(s.person_ref)))
      expect(listed).toEqual(notLinked)
      expect(listed.has('noe petit')).toBe(true) // attached by one row, not by the other
      expect(rateOfCompany(body.items, 'co-a')).toMatchObject({ linked: { count: 2 } })
      expect(Date.parse(body.lastReadAt)).toBe(Date.parse((await sourceOf()).lastReadAt))
    })

  })

  // ───────────────────────────── la liste ─────────────────────────────
  describe('the list of the persons not linked', () => {
    it('[rule-evp-unlinked-list] [rule-evp-unlinked-list-grain] one entry per person and per cause, with the crèches where she was read (name of the referential, sorted, without duplicates), sorted by name in French order then by cause; attached persons are not listed', async () => {
      payfitWith({ 'emp-ct-a1': NIR1 })
      await readAqoona([
        row({ matricule: NIR1, day: d(-7) }), // attached: not listed
        row({ firstName: 'Béa', lastName: 'DUPONT', crecheName: 'Crèche Beta', day: d(-6) }),
        row({ firstName: 'Béa', lastName: 'DUPONT', crecheName: 'Crèche Alpha', day: d(-5) }),
        row({ firstName: 'Béa', lastName: 'DUPONT', crecheName: 'Crèche Alpha', day: d(-4) }),
        row({ firstName: 'Béa', lastName: 'DUPONT', matricule: BAD1, crecheName: 'Crèche Alpha', day: d(-3) }),
        row({ firstName: 'Eva', lastName: 'ZED', matricule: NIR4, day: d(-2) }),
        row({ firstName: 'Émile', lastName: 'ARON', matricule: NIR4, crecheName: 'Crèche Beta', day: d(-2) }),
        row({ firstName: 'Adam', lastName: 'ZED', matricule: NIR_KO, day: d(-1) }),
      ])
      const list = await people()
      expect(list.available).toBe(true)
      expect(list.total).toBe(5)
      expect(list.items.map((i: PersonItem) => [i.name, i.cause, i.creches]).map(([n, c, k]: any) => [normalise(n), c, k])).toEqual([
        ['adam zed', 'NIR_KEY_INVALID', ['Crèche Alpha']],
        ['bea dupont', 'NIR_ABSENT', ['Crèche Alpha', 'Crèche Beta']],
        ['bea dupont', 'NIR_KEY_INVALID', ['Crèche Alpha']],
        ['emile aron', 'NIR_UNKNOWN', ['Crèche Beta']],
        ['eva zed', 'NIR_UNKNOWN', ['Crèche Alpha']],
      ])
      for (const item of list.items) {
        expect(sortedKeys(item)).toEqual(['causeLabel', 'creches', 'cause', 'name'].sort())
        expect(CAUSES).toContain(item.cause)
        expect(item.causeLabel.length).toBeGreaterThan(0)
      }
      expect(list.items.some((i: PersonItem) => sameName(i.name, 'Léa Martin'))).toBe(false)
    })

    it('[rule-evp-unlinked-list-grain] the name is « Prénom NOM » as read in Aqoona, from the first row retained; the same person written differently (case, accents, spaces) is one entry', async () => {
      payfitWith()
      await readAqoona([
        row({ firstName: 'Sarah', lastName: 'LEBRUN', day: d(-5) }),
        row({ firstName: 'SARAH', lastName: ' lebrun ', crecheName: 'Crèche Beta', day: d(-4) }),
        row({ firstName: 'Sàrah', lastName: 'Lebrun', day: d(-3) }),
      ])
      const list = await people()
      expect(list.total).toBe(1)
      expect(sameName(list.items[0].name, 'Sarah Lebrun')).toBe(true)
      expect(list.items[0].creches).toEqual(['Crèche Alpha', 'Crèche Beta'])
    })

    it('[rule-evp-unlinked-list] the crèches of a person: the establishment as read in Aqoona when it is unknown of the referential, an empty list when there is none; at most 50, the first 50 in order', async () => {
      await readEmpty()
      await seedUnlinked('Voyageuse Sans Fin', 'NIR_ABSENT', { companyId: null, crecheCode: null, crecheLabel: null, day: d(-2) })
      await seedUnlinked('Voyageuse Sans Fin', 'NIR_ABSENT', { companyId: null, crecheCode: 'alpha', day: d(-2), start: '14:00', end: '15:00' })
      const named = async (name: string) => (await people()).items.find((i: PersonItem) => sameName(i.name, name))
      expect((await named('Voyageuse Sans Fin'))?.creches).toEqual(['Crèche Alpha'])
      await sql("delete from base.aqoona_plannings where person_ref = 'Voyageuse Sans Fin'")
      await seedUnlinked('Sans Lieu', 'NIR_ABSENT', { companyId: null, crecheCode: null, crecheLabel: null, day: d(-2) })
      expect((await named('Sans Lieu'))?.creches).toEqual([])
      await sql("delete from base.aqoona_plannings where person_ref = 'Sans Lieu'")
      for (let i = 1; i <= 51; i++) {
        const hour = 6 + Math.floor((i - 1) / 6)
        const minute = ((i - 1) % 6) * 10
        await seedUnlinked('Voyageuse Sans Fin', 'NIR_ABSENT', { companyId: null, crecheCode: null, crecheLabel: `Établissement ${pad(i)}`, day: d(-2), start: `${pad(hour)}:${pad(minute)}`, end: '23:00' })
      }
      const item = await named('Voyageuse Sans Fin')
      expect(item?.creches).toHaveLength(50)
      expect(item?.creches[0]).toBe('Établissement 01')
      expect(item?.creches[49]).toBe('Établissement 50')
    })

    it('[rule-evp-unlinked-list-paging] from and size: default 25, sizes 10 and 50, pages are disjoint and complete in the order of the list, from beyond the total gives no item and the exact total', async () => {
      await readEmpty()
      for (let i = 1; i <= 60; i++) await seedUnlinked(`Pers ${pad(i)}`, 'NIR_ABSENT', { companyId: 'co-a', day: d(-2) })
      const names = (b: any) => b.items.map((i: PersonItem) => normalise(i.name))
      const expected = (from: number, size: number) => Array.from({ length: Math.max(0, Math.min(size, 60 - from)) }, (_, k) => `pers ${pad(from + k + 1)}`)
      const first = await people()
      expect(first.total).toBe(60)
      expect(names(first)).toEqual(expected(0, 25))
      expect(names(await people({ size: 10 }))).toEqual(expected(0, 10))
      expect(names(await people({ size: 50 }))).toEqual(expected(0, 50))
      expect(names(await people({ from: 50, size: 25 }))).toEqual(expected(50, 25))
      expect(names(await people({ from: 25 }))).toEqual(expected(25, 25))
      const beyond = await people({ from: 60 })
      expect([beyond.total, beyond.items]).toEqual([60, []])
      const far = await people({ from: 2147483647, size: 10 })
      expect([far.total, far.items]).toEqual([60, []])
      const pages: string[] = []
      for (let from = 0; from < 60; from += 10) pages.push(...names(await people({ from, size: 10 })))
      expect(pages).toEqual(expected(0, 60))
      for (const size of [10, 25, 50]) expect((await people({ size })).items.length).toBeLessThanOrEqual(size)
    })

    it('[rule-evp-unlinked-list-paging] parameters out of bounds are 400 with the validation body: size 0, 30, 100 or not a number; from negative, not an integer or above 2147483647', async () => {
      await readEmpty()
      const bad: Array<Record<string, string | number>> = [{ size: 0 }, { size: 30 }, { size: 100 }, { size: 'abc' }, { size: -10 }, { from: -1 }, { from: 'abc' }, { from: 1.5 }, { from: 2147483648 }]
      for (const query of bad) {
        const res = await unlinkedOf(w.rh.token, query)
        expect({ query, status: res.status }).toEqual({ query, status: 400 })
        expect(res.body).toMatchObject({ status: 400, code: 'api.validation.incoming_failed', message: expect.any(String) })
        expect(res.text).not.toMatch(/at .*\.(ts|js):\d+|select |stack/i)
      }
      for (const query of [{ size: 10 }, { size: 25 }, { size: 50 }, { from: 0 }, { from: 2147483647 }, {}]) {
        expect({ query, status: (await unlinkedOf(w.rh.token, query)).status }).toEqual({ query, status: 200 })
      }
    })

    it('[rule-evp-unlinked-list-grain] the order is by name, then by cause: a person with two causes has her entries next to each other, NIR_ABSENT first', async () => {
      await readEmpty()
      await seedUnlinked('Zora Zed', 'NIR_UNKNOWN', { companyId: 'co-a', day: d(-2) })
      await seedUnlinked('Zora Zed', 'NIR_ABSENT', { companyId: 'co-a', day: d(-3) })
      await seedUnlinked('Étienne Alpha', 'NIR_ABSENT', { companyId: 'co-a', day: d(-2) })
      await seedUnlinked('eve Beta', 'NIR_ABSENT', { companyId: 'co-a', day: d(-2) })
      const list = await people()
      expect(list.items.map((i: PersonItem) => [normalise(i.name), i.cause])).toEqual([
        ['etienne alpha', 'NIR_ABSENT'],
        ['eve beta', 'NIR_ABSENT'],
        ['zora zed', 'NIR_ABSENT'],
        ['zora zed', 'NIR_UNKNOWN'],
      ])
      expect(list.total).toBe(4)
    })
  })

  // ───────────────────────────── confidentialité ─────────────────────────────
  describe('confidentiality', () => {
    it('[rule-evp-matching-rates-no-nir] the rates hold only identifiers, SIRET, company names and counts: no NIR (right or wrong key, any form), no name of a person, no secret, no address', async () => {
      const offset = logSize()
      payfitWith({ 'emp-ct-a1': NIR1, 'emp-ct-a2': BAD3, 'emp-ct-b1': NIR2 })
      const run = await readAqoona([
        row({ matricule: spaced(NIR1), day: d(-3) }),
        row({ firstName: 'Noé', lastName: 'Petit', matricule: BAD3, day: d(-3) }),
        row({ firstName: 'Zoé', lastName: 'Durand', crecheName: 'Crèche Beta', matricule: NIR_KO, day: d(-3) }),
        row({ firstName: 'Inconnue', lastName: 'Total', matricule: NIR2, day: d(-3) }),
        row({ firstName: 'Léa', lastName: 'Martin', matricule: BAD1, crecheName: 'Établissement Fantôme', day: d(-3) }),
      ])
      expect(run.state).toBe('SUCCEEDED')
      const res = await ratesOf(w.rh.token)
      expect(res.status).toBe(200)
      expect(res.body.items.length).toBeGreaterThanOrEqual(2)
      const allowed = ['available', 'lastReadAt', 'windowFrom', 'windowTo', 'items', 'companyId', 'siret', 'name', 'total', 'linked', 'unlinked', 'count', 'percent']
      const keys: string[] = []
      const walk = (v: unknown) => {
        if (Array.isArray(v)) v.forEach(walk)
        else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (keys.push(k), walk(x))
      }
      walk(res.body)
      expect([...new Set(keys)].filter((k) => !allowed.includes(k))).toEqual([])
      expectNoNir('matching-rates', res.text, V4_NIRS)
      expectNoLongDigits('matching-rates', res.text)
      for (const name of ['Léa', 'Martin', 'Noé', 'Petit', 'Zoé', 'Durand', 'Inconnue', 'Total', 'Fantôme', 'Crèche']) expect({ name, found: res.text.includes(name) }).toEqual({ name, found: false })
      expect(res.text).not.toMatch(/https?:|token|apiKey|secret/i)
      expectNoNir('server log', logSince(offset), V4_NIRS)
    })

    it('[rule-evp-unlinked-list-no-nir] the list names the person and never a NIR: no NIR, no fragment, no digit that hints at the key, no expected key, no PayFit identifier, no secret, no address; only the keys of the contract', async () => {
      payfitWith({ 'emp-ct-a1': NIR1, 'emp-ct-a2': NIR1, 'emp-ct-b1': NIR2 })
      const run = await readAqoona([
        row({ firstName: 'Noé', lastName: 'Petit', matricule: BAD3, day: d(-5) }),
        row({ firstName: 'Zoé', lastName: 'Durand', crecheName: 'Crèche Beta', matricule: NIR_KO, day: d(-4) }),
        row({ firstName: 'Une', lastName: 'Ambigue', matricule: NIR1, day: d(-3) }),
        row({ firstName: 'Un', lastName: 'Inconnu', matricule: NIR4, day: d(-2) }),
        row({ firstName: 'Mat', lastName: 'Ricule', matricule: '1850575123456789', day: d(-2) }),
        row({ firstName: '', lastName: '', matricule: NIR4, day: d(-1) }),
        row({ firstName: 'Ici', lastName: 'Ailleurs', matricule: BAD1, crecheName: 'Établissement Fantôme', day: d(-1) }),
      ])
      expect(run.state).toBe('SUCCEEDED')
      const res = await unlinkedOf(w.rh.token, { size: 50 })
      expect(res.status).toBe(200)
      expect(res.body.total).toBe(7)
      const allowed = ['available', 'lastReadAt', 'windowFrom', 'windowTo', 'total', 'items', 'name', 'cause', 'causeLabel', 'creches']
      const keys: string[] = []
      const walk = (v: unknown) => {
        if (Array.isArray(v)) v.forEach(walk)
        else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (keys.push(k), walk(x))
      }
      walk(res.body)
      expect([...new Set(keys)].filter((k) => !allowed.includes(k))).toEqual([])
      expectNoNir('unlinked-people', res.text, V4_NIRS)
      expectNoLongDigits('unlinked-people', res.text, [])
      expect(res.text).not.toMatch(/emp-|co-a|co-b|https?:|token|apiKey|secret/i)
      expect(res.text).not.toMatch(/\d{5,}/)
    })
  })

  // ───────────────────────────── contrat ─────────────────────────────
  describe('contract', () => {
    it('[rule-evp-matching-rates-people] [rule-evp-matching-rates-percent] the OpenAPI document carries the new shape of SourceAqoonaMatchingRatesDto with the bounds of the request (linked / unlinked, no byNir / byName / unmatched)', async () => {
      const doc = (await http('GET', '/api-json')).body
      const operation = doc.paths[RATES_PATH]
      expect(Object.keys(operation)).toEqual(['get'])
      const ok = deref(doc, operation.get.responses['200'].content['application/json'].schema)
      expect(doc.components.schemas.SourceAqoonaMatchingRatesDto).toBeDefined()
      expect(JSON.stringify(operation.get.responses['200'])).toContain('SourceAqoonaMatchingRatesDto')
      expect(Object.keys(ok.properties).sort()).toEqual(['available', 'items', 'lastReadAt', 'windowFrom', 'windowTo'])
      expect([...ok.required].sort()).toEqual(['available', 'items', 'lastReadAt', 'windowFrom', 'windowTo'])
      expect(isNullable(doc, ok.properties.lastReadAt)).toBe(true)
      expect(variants(doc, ok.properties.lastReadAt).some((v) => v.format === 'date-time')).toBe(true)
      for (const key of ['windowFrom', 'windowTo']) {
        expect(isNullable(doc, ok.properties[key])).toBe(true)
        expect(variants(doc, ok.properties[key]).some((v) => v.pattern === '^\\d{4}-\\d{2}-\\d{2}$' || v.format === 'date')).toBe(true)
      }
      const items = deref(doc, ok.properties.items)
      expect(items.type).toBe('array')
      expect(items.maxItems).toBe(200)
      const item = deref(doc, items.items)
      expect(Object.keys(item.properties).sort()).toEqual(['companyId', 'linked', 'name', 'siret', 'total', 'unlinked'])
      expect([...item.required].sort()).toEqual(['companyId', 'linked', 'name', 'siret', 'total', 'unlinked'])
      expect(isNullable(doc, item.properties.companyId)).toBe(true)
      expect(bound(doc, item.properties.companyId, 'minLength')).toBe(1)
      expect(bound(doc, item.properties.companyId, 'maxLength')).toBe(100)
      expect(isNullable(doc, item.properties.siret)).toBe(true)
      expect(bound(doc, item.properties.siret, 'minLength')).toBe(1)
      expect(bound(doc, item.properties.siret, 'maxLength')).toBe(20)
      expect(isNullable(doc, item.properties.name)).toBe(false)
      expect(bound(doc, item.properties.name, 'minLength')).toBe(1)
      expect(bound(doc, item.properties.name, 'maxLength')).toBe(200)
      expect(deref(doc, item.properties.total).type).toBe('integer')
      expect(bound(doc, item.properties.total, 'minimum')).toBe(1)
      for (const part of ['linked', 'unlinked']) {
        const schema = deref(doc, item.properties[part])
        expect(Object.keys(schema.properties).sort()).toEqual(['count', 'percent'])
        expect([...schema.required].sort()).toEqual(['count', 'percent'])
        expect(deref(doc, schema.properties.count).type).toBe('integer')
        expect(bound(doc, schema.properties.count, 'minimum')).toBe(0)
        expect(['number', 'integer']).toContain(deref(doc, schema.properties.percent).type)
        expect(bound(doc, schema.properties.percent, 'minimum')).toBe(0)
        expect(bound(doc, schema.properties.percent, 'maximum')).toBe(100)
      }
    })

    it('[rule-evp-unlinked-list] [rule-evp-unlinked-list-paging] the OpenAPI document carries the new operation GET /sources/aqoona/unlinked-people with SourceAqoonaUnlinkedPeopleDto and the bounds of the request; the paths of the sources are the six known plus this one', async () => {
      const doc = (await http('GET', '/api-json')).body
      expect(Object.keys(doc.paths).filter((p) => p.startsWith('/sources')).sort()).toEqual([
        '/sources', '/sources/aqoona/matching-rates', '/sources/aqoona/unlinked-people', '/sources/refresh-all', '/sources/runs/{id}', '/sources/{key}/anomalies', '/sources/{key}/refresh',
      ])
      const operation = doc.paths[UNLINKED_PATH]
      expect(Object.keys(operation)).toEqual(['get'])
      // like the anomalies, the document may leave the 400 of the validation undocumented; 401 and 403 are declared and nothing else is
      const errors = Object.keys(operation.get.responses).filter((c) => /^4/.test(c))
      expect(errors).toEqual(expect.arrayContaining(['401', '403']))
      expect(errors.filter((c) => !['400', '401', '403'].includes(c))).toEqual([])
      expect(operation.get.requestBody).toBeUndefined()
      const params = (operation.get.parameters ?? []).map((p: any) => ({ ...p, schema: deref(doc, p.schema) }))
      expect(params.map((p: any) => p.name).sort()).toEqual(['from', 'size'])
      for (const p of params) {
        expect(p.in).toBe('query')
        expect(p.required ?? false).toBe(false)
      }
      const from = params.find((p: any) => p.name === 'from').schema
      expect(variants(doc, from).some((v) => v.type === 'integer' || v.type === 'number')).toBe(true)
      expect(bound(doc, from, 'minimum')).toBe(0)
      expect(bound(doc, from, 'maximum')).toBe(2147483647)
      const size = params.find((p: any) => p.name === 'size').schema
      const sizes = variants(doc, size).flatMap((v: any) => v.enum ?? (v.const !== undefined ? [v.const] : []))
      expect([...new Set(sizes.map(Number))].sort((a: number, b: number) => a - b)).toEqual([10, 25, 50])
      const ok = deref(doc, operation.get.responses['200'].content['application/json'].schema)
      expect(doc.components.schemas.SourceAqoonaUnlinkedPeopleDto).toBeDefined()
      expect(JSON.stringify(operation.get.responses['200'])).toContain('SourceAqoonaUnlinkedPeopleDto')
      expect(Object.keys(ok.properties).sort()).toEqual(['available', 'items', 'lastReadAt', 'total', 'windowFrom', 'windowTo'])
      expect([...ok.required].sort()).toEqual(['available', 'items', 'lastReadAt', 'total', 'windowFrom', 'windowTo'])
      expect(deref(doc, ok.properties.total).type).toBe('integer')
      expect(bound(doc, ok.properties.total, 'minimum')).toBe(0)
      expect(isNullable(doc, ok.properties.lastReadAt)).toBe(true)
      const items = deref(doc, ok.properties.items)
      expect(items.type).toBe('array')
      expect(items.maxItems).toBe(50)
      const item = deref(doc, items.items)
      expect(Object.keys(item.properties).sort()).toEqual(['cause', 'causeLabel', 'creches', 'name'])
      expect([...item.required].sort()).toEqual(['cause', 'causeLabel', 'creches', 'name'])
      expect(bound(doc, item.properties.name, 'minLength')).toBe(1)
      expect(bound(doc, item.properties.name, 'maxLength')).toBe(200)
      expect([...(deref(doc, item.properties.cause).enum ?? [])].sort()).toEqual([...CAUSES].sort())
      expect(bound(doc, item.properties.causeLabel, 'minLength')).toBe(1)
      expect(bound(doc, item.properties.causeLabel, 'maxLength')).toBe(100)
      const creches = deref(doc, item.properties.creches)
      expect(creches.type).toBe('array')
      expect(creches.maxItems).toBe(50)
      const crecheItem = deref(doc, creches.items)
      expect(crecheItem.minLength).toBe(1)
      expect(crecheItem.maxLength).toBe(200)
    })

    it('[rule-evp-unlinked-list-same-rights] [rule-evp-matching-rates-same-rights] the operations answer 401 and 403 in the documented error shape', async () => {
      const doc = (await http('GET', '/api-json')).body
      for (const path of [RATES_PATH, UNLINKED_PATH]) {
        expect(Object.keys(doc.paths)).toContain(path)
        const codes = Object.keys(doc.paths[path].get.responses)
        expect({ path, ok: codes.includes('200') && codes.includes('401') && codes.includes('403') }).toEqual({ path, ok: true })
      }
      expect(doc.paths[RATES_PATH].get.parameters ?? []).toEqual([])
      expect(Object.keys(doc.paths[RATES_PATH].get.responses).filter((c) => /^4/.test(c)).sort()).toEqual(['401', '403'])
    })

    it('[rule-evp-matching-rates-people] the rates and the list use the same causes as the anomalies: the cause of a person of the list is the one of the anomaly « Planning non rattaché »', async () => {
      payfitWith({ 'emp-ct-a1': NIR1 })
      await readAqoona([row({ firstName: 'Cora', lastName: 'Cause', matricule: BAD1, day: d(-3) }), row({ firstName: 'Cleo', lastName: 'Cause', matricule: NIR4, day: d(-2) })])
      const list = await people()
      const unmatched = (await anomaliesOf()).items.filter((i: any) => i.type === 'PLANNING_UNMATCHED')
      for (const item of list.items as PersonItem[]) {
        const found = unmatched.find((a: any) => sameName(a.subject, item.name))
        expect(found?.detail.startsWith(item.causeLabel)).toBe(true)
      }
      expect(personsOf(list.items).map(([, c]) => c as Cause).sort()).toEqual(['NIR_KEY_INVALID', 'NIR_UNKNOWN'])
    })
  })
})
