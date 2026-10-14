import { resetData, closePool, sql } from './harness'
import { logSince, logSize } from './renfort-helpers'
import {
  GET, POST, seedWorld, seedContract, seedCreche, World, closeEvp, refresh, waitRun, writeFixture, clearFixtures, payfitFixture, SIRET_A, SIRET_B, countRows, PayfitFixture,
} from './evp-helpers'
import { d, everythingVisible } from './v2-helpers'
import { ALL_NIRS, DIGITS14, NIR1, NIR2, NIR3, NIR4, NIR_2A, allTablesText, expectNoNir, plannings, spaced } from './v3-helpers'
import { ALPHA, BETA, UNAVAILABLE_LABEL, UNMATCHED_LABEL, link, sameName, slots, unmatchedDetail } from './v5-helpers'

// Acceptance suite of version v3-evp-acces-contrats-siret: the NIR as a transient link key between Aqoona « Pros » and PayFit,
// people on several SIRET, de-duplication. Default API variant (fake sources, decision D-0010: the NIR of a PayFit
// collaborator is the optional field `nir` of payfit.json; `nirUnavailable` lists the SIRET whose scope is missing).
// The real-driver side of the same rules (request, mapping, types, lazy PayFit calls, logs) is in acceptance-v3-sources-aqoona.
describe('NIR as transient key and people on several SIRET (v3-evp-acces-contrats-siret)', () => {
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

  /** payfit.json cohérent avec `seedWorld()` ; `nirs` donne le NIR de collaboratrices (par identifiant PayFit), `extra` complète la fixture. */
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
  const volume = (volumes: any[], label: string) => volumes.find((v) => v.label === label)
  const anomalies = async () => (await GET('/sources/aqoona/anomalies?size=50', w.rh.token)).body
  const unmatched = async () => (await anomalies()).items.filter((i: any) => i.type === 'PLANNING_UNMATCHED')

  // ───────────────────────────── rapprochement par NIR ─────────────────────────────
  describe('matching by NIR', () => {
    it('[rule-evp-aqoona-nir-transient-key] [rule-evp-aqoona-nir-over-name] a NIR that matches one collaborator of the company wins even if the names differ; the volume « Rapprochés par NIR » counts those rows and « Matricule écarté » no longer exists', async () => {
      payfitWithNirs({ 'emp-ct-a1': NIR1 })
      const run = await readAqoona([
        row({ firstName: 'Prénom', lastName: 'Différent', matricule: spaced(NIR1), day: d(-3) }),
        row({ firstName: 'Prénom', lastName: 'Différent', matricule: NIR1, day: d(-2) }),
        row({ firstName: 'Noé', lastName: 'Petit', matricule: '', day: d(-1) }),
      ])
      expect(run.state).toBe('SUCCEEDED')
      const rows = await plannings()
      expect(rows).toHaveLength(3)
      expect(rows.filter((r) => r.employee_id === 'emp-ct-a1' && r.company_id === 'co-a' && r.creche_code === 'alpha')).toHaveLength(2)
      // v5 (rule-evp-link-nir-only): the row without NIR is no longer matched by its names
      expect(rows.find((r) => r.day === d(-1))).toEqual(expect.objectContaining({ employee_id: null, company_id: 'co-a', creche_code: 'alpha' }))
      for (const v of [run.volumes, (await aqoonaSource()).volumes]) {
        expect(volume(v, 'Plannings lus')).toEqual({ label: 'Plannings lus', count: 3 })
        expect(volume(v, 'Plannings rattachés')).toEqual({ label: 'Plannings rattachés', count: 2 })
        expect(volume(v, 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count: 2 })
        expect(volume(v, 'Matricule écarté')).toBeUndefined()
      }
      const items = await unmatched()
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({ label: UNMATCHED_LABEL, detail: unmatchedDetail('NIR_ABSENT', 'Crèche Alpha') })
      expect(sameName(items[0].subject, 'Noé Petit')).toBe(true)
    })

    it('[rule-evp-link-nir-only] [rule-evp-link-unusable-nir] there is no fallback by names any more: a row without NIR, with a NIR that matches nobody or with a registration number of another length is not attached, whatever its names, and gives an anomaly', async () => {
      payfitWithNirs({ 'emp-ct-a1': NIR1 })
      const run = await readAqoona([
        row({ matricule: '', day: d(-6) }),
        row({ matricule: NIR4, day: d(-5) }),
        row({ matricule: '12345', day: d(-4) }),
        row({ matricule: '1850575123456789', day: d(-3) }),
        row({ firstName: 'Noé', lastName: 'Petit', matricule: NIR3, day: d(-2) }),
      ])
      expect(run.state).toBe('SUCCEEDED')
      const rows = await plannings()
      expect(rows).toHaveLength(5)
      expect(rows.filter((r) => r.employee_id !== null)).toEqual([])
      expect(volume((await aqoonaSource()).volumes, 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count: 0 })
      // grain of « Planning non rattaché »: one anomaly per person, crèche read and cause, never per slot (the subject and the detail carry no slot);
      // Léa Martin: three rows without usable NIR (one cause) + one unknown NIR; Noé Petit: one unknown NIR
      const items = await unmatched()
      expect(items).toHaveLength(3)
      expect(items.every((i: any) => i.label === UNMATCHED_LABEL)).toBe(true)
      expect(items.find((i: any) => i.detail === unmatchedDetail('NIR_ABSENT', 'Crèche Alpha') && sameName(i.subject, 'Léa Martin'))).toBeDefined()
      expect(new Set(items.map((i: any) => `${i.subject}|${i.detail}`)).size).toBe(items.length)
      expect(items.filter((i: any) => sameName(i.subject, 'Noé Petit'))).toHaveLength(1)
      expect(rows.every((r) => !/\d{5,}/.test(String(r.person_ref)))).toBe(true)
    })

    it('[rule-evp-aqoona-nir-format] spaces, dots and dashes are ignored, 2A/2B stand for the department digits, and 15 characters are compared; 14 digits (SIRET shape) or any other length is not a NIR', async () => {
      payfitWithNirs({ 'emp-ct-a1': NIR_2A, 'emp-ct-a2': DIGITS14 })
      const run = await readAqoona([
        row({ firstName: 'Prénom', lastName: 'Différent', matricule: '1 90 05 2A 123 456 79', day: d(-6) }),
        row({ firstName: 'Prénom', lastName: 'Différent', matricule: '1.90.05.2A.123.456.79', day: d(-5) }),
        row({ firstName: 'Prénom', lastName: 'Différent', matricule: '1-90-05-2A-123-456-79', day: d(-4) }),
        row({ firstName: 'Prénom', lastName: 'Différent', matricule: DIGITS14, day: d(-3) }),
      ])
      expect(run.state).toBe('SUCCEEDED')
      const rows = await plannings()
      expect(rows.filter((r) => r.employee_id === 'emp-ct-a1').map((r) => r.day)).toEqual([d(-6), d(-5), d(-4)])
      expect(rows.find((r) => r.day === d(-3))?.employee_id).toBeNull()
      expect(volume((await aqoonaSource()).volumes, 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count: 3 })
      expectNoNir('tables', await allTablesText(), [NIR_2A])
      expect(JSON.stringify(rows)).not.toContain(DIGITS14)
    })

    it('[rule-evp-link-network-wide] a NIR carried by a collaborator of another company than the crèche is searched across the whole network: the row is attached to her (the names are not looked at), the slot keeps the company of its crèche', async () => {
      payfitWithNirs({ 'emp-ct-b1': NIR2 })
      const run = await readAqoona([
        row({ matricule: NIR2, day: d(-3) }),
        row({ firstName: 'Inconnue', lastName: 'Total', matricule: NIR2, day: d(-2) }),
      ])
      expect(run.state).toBe('SUCCEEDED')
      const all = await slots()
      expect(all.map(link)).toEqual([
        ['co-a', 'alpha', 'co-b', 'emp-ct-b1', 'NIR', null],
        ['co-a', 'alpha', 'co-b', 'emp-ct-b1', 'NIR', null],
      ])
      expect(volume((await aqoonaSource()).volumes, 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count: 2 })
      expect(await unmatched()).toEqual([])
    })

    it('[rule-evp-aqoona-nir-ambiguous][D-0014] a NIR carried by two distinct collaborators of the company, names unique: the slot is stored without employee_id and the anomaly « Planning non rattaché » says « Rattachement par NIR ambigu »', async () => {
      payfitWithNirs({ 'emp-ct-a1': NIR1, 'emp-ct-a2': NIR1 })
      writeFixture('aqoona', { rows: [row({ firstName: 'Léa', lastName: 'Martin', matricule: NIR1 })] })
      const started = await POST('/sources/aqoona/refresh', w.rh.token)
      expect(started.status).toBe(202)
      const run = await waitRun(w.rh.token, started.body.runId)
      expect(run.state).toBe('SUCCEEDED')
      const rows = await plannings()
      expect(rows).toHaveLength(1)
      expect(rows[0].employee_id).toBeNull()
      const items = await unmatched()
      expect(items.length).toBeGreaterThanOrEqual(1)
      // v5: the detail is the label of the cause, then the crèche read; the subject is the person
      const ambiguous = items.filter((i: any) => i.detail === unmatchedDetail('NIR_AMBIGUOUS', 'Crèche Alpha'))
      expect(ambiguous).toHaveLength(1)
      expect(ambiguous[0]).toMatchObject({ type: 'PLANNING_UNMATCHED', label: UNMATCHED_LABEL })
      expect(sameName(ambiguous[0].subject, 'Léa Martin')).toBe(true)
      expect(volume((await aqoonaSource()).volumes, 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count: 0 })
    })

    it('[rule-evp-aqoona-nir-ambiguous] one collaborator carrying two contracts and one NIR is one person: the row is matched, with neither ambiguity nor anomaly', async () => {
      await sql("insert into base.payfit_contracts (company_id, payfit_contract_id, employee_id, start_date, status) values ('co-a', 'ct-a1-bis', 'emp-ct-a1', '2024-01-01', 'ACTIVE')")
      const fixture: any = payfitFixture([])
      fixture.employees = fixture.employees.map((e: any) => (e.id === 'emp-ct-a1' ? { ...e, nir: NIR1 } : e))
      fixture.contracts.push({ companyId: 'co-a', id: 'ct-a1-bis', employeeId: 'emp-ct-a1', startDate: '2024-01-01', endDate: null })
      writeFixture('payfit', fixture)
      const run = await readAqoona([row({ firstName: 'Prénom', lastName: 'Autre', matricule: NIR1 })])
      expect(run.state).toBe('SUCCEEDED')
      expect((await plannings())[0]).toEqual(expect.objectContaining({ employee_id: 'emp-ct-a1', company_id: 'co-a' }))
      expect(await unmatched()).toEqual([])
      expect(volume((await aqoonaSource()).volumes, 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count: 1 })
    })

    it('[rule-evp-aqoona-nir-unavailable] [rule-evp-link-incomplete-read] [rule-evp-company-named-in-anomalies] when the NIR of a company cannot be read, the rows with a NIR are not attached (no fallback by names), they say so and the anomaly « Rapprochement par NIR indisponible » names the company (name and SIRET); the reading is neither FAILED nor PARTIAL for that reason', async () => {
      payfitWithNirs({ 'emp-ct-a1': NIR1 }, { nirUnavailable: [SIRET_A] })
      const run = await readAqoona([
        row({ matricule: NIR1, day: d(-3) }),
        row({ firstName: 'Prénom', lastName: 'Différent', matricule: NIR1, day: d(-2) }),
      ])
      expect(run.state).toBe('SUCCEEDED')
      expect((await aqoonaSource()).state).not.toBe('PARTIAL')
      expect((await slots()).map(link)).toEqual([
        ['co-a', 'alpha', null, null, 'AUCUN', 'PAYFIT_INCOMPLETE'],
        ['co-a', 'alpha', null, null, 'AUCUN', 'PAYFIT_INCOMPLETE'],
      ])
      const items = (await anomalies()).items.filter((i: any) => i.type === 'aqoona_nir_unavailable')
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({ label: UNAVAILABLE_LABEL, subject: ALPHA })
      expect(volume((await aqoonaSource()).volumes, 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count: 0 })
    })

    it('[rule-evp-aqoona-nir-unavailable] [rule-evp-aqoona-nir-lazy] [rule-evp-link-network-read] the PayFit NIRs are read only when a row carries a usable NIR; then every company of the network is read, and each one that cannot be read is reported', async () => {
      payfitWithNirs({ 'emp-ct-b1': NIR2 }, { nirUnavailable: [SIRET_A, SIRET_B] })
      let run = await readAqoona([row({ matricule: '' })])
      expect(run.state).toBe('SUCCEEDED')
      expect((await anomalies()).items.filter((i: any) => i.type === 'aqoona_nir_unavailable')).toEqual([])
      run = await readAqoona([row({ firstName: 'Zoé', lastName: 'Durand', crecheName: 'Crèche Beta', matricule: NIR2 }), row({ matricule: '' })])
      expect(run.state).toBe('SUCCEEDED')
      let items = (await anomalies()).items.filter((i: any) => i.type === 'aqoona_nir_unavailable')
      expect(items.map((i: any) => i.subject).sort()).toEqual([ALPHA, BETA].sort())
      // company A readable again, company B still not: the NIR is searched in the whole network, so the unreadable company B
      // can hold it (D-0021): the row is not attached and says why
      payfitWithNirs({ 'emp-ct-b1': NIR2 }, { nirUnavailable: [SIRET_B] })
      run = await readAqoona([row({ firstName: 'Prénom', lastName: 'Différent', crecheName: 'Crèche Beta', matricule: NIR2 })])
      expect(run.state).toBe('SUCCEEDED')
      items = (await anomalies()).items.filter((i: any) => i.type === 'aqoona_nir_unavailable')
      expect(items.map((i: any) => i.subject)).toEqual([BETA])
      expect((await slots()).map(link)).toEqual([['co-b', 'beta', null, null, 'AUCUN', 'PAYFIT_INCOMPLETE']])
      // both companies readable: the row is attached
      payfitWithNirs({ 'emp-ct-b1': NIR2 })
      run = await readAqoona([row({ firstName: 'Prénom', lastName: 'Différent', crecheName: 'Crèche Beta', matricule: NIR2 })])
      expect(run.state).toBe('SUCCEEDED')
      expect((await anomalies()).items.filter((i: any) => i.type === 'aqoona_nir_unavailable')).toEqual([])
      expect((await slots()).map(link)).toEqual([['co-b', 'beta', 'co-b', 'emp-ct-b1', 'NIR', null]])
    })
  })

  // ───────────────────────────── le NIR n'est jamais conservé ─────────────────────────────
  describe('the NIR is never kept', () => {
    it('[rule-evp-aqoona-nir-never-stored] [rule-evp-secrets-never-exposed] no NIR (nor its spaced form, nor its first 13 digits) appears in any table of the schema, any answer, export, audit entry, notification, anomaly or in the server log — matched, unmatched, ambiguous and unavailable cases together', async () => {
      const offset = logSize()
      payfitWithNirs({ 'emp-ct-a1': NIR1, 'emp-ct-a2': NIR3, 'emp-ct-b1': NIR3 })
      expect((await refresh(w.rh.token, 'payfit')).state).toBe('SUCCEEDED')
      const run = await readAqoona([
        row({ matricule: spaced(NIR1), day: d(-5) }),
        row({ firstName: 'Inconnue', lastName: 'Total', matricule: NIR2, day: d(-4) }),
        row({ firstName: 'Noé', lastName: 'Petit', matricule: NIR4, day: d(-3) }),
        row({ firstName: 'Noé', lastName: 'Petit', matricule: NIR3, day: d(-2) }),
        row({ firstName: 'Zoé', lastName: 'Durand', crecheName: 'Crèche Beta', matricule: NIR3, day: d(-1) }),
      ])
      expect(run.state).toBe('SUCCEEDED')
      // anchor: the guard must not pass before the code. NIR1 → emp-ct-a1 (attached); NIR3 is carried by emp-ct-a2 (company A) and
      // emp-ct-b1 (company B), so since v5 (D-0020) the rows with NIR3 are ambiguous; NIR2 and NIR4 match nobody.
      expect(volume((await aqoonaSource()).volumes, 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count: 1 })
      expect(volume(run.volumes, 'Matricule écarté')).toBeUndefined()
      const token = w.rh.token
      const visible = await everythingVisible(token, {
        GET: (p, t) => GET(p, t),
        POST: (p, t, b) => POST(p, t, b),
        sql: (q) => sql(q),
      })
      expectNoNir('visible', visible)
      expectNoNir('tables', await allTablesText())
      expectNoNir('run', JSON.stringify(run))
      expectNoNir('server log', logSince(offset))
      const rows = await plannings()
      expect(rows.every((r) => !/\d{9,}/.test(String(r.person_ref)))).toBe(true)
    })

    it('[rule-evp-aqoona-nir-never-stored] the PayFit reading never copies the NIR of a collaborator into payfit_employees, even when PayFit delivers it', async () => {
      payfitWithNirs({ 'emp-ct-a1': NIR1, 'emp-ct-a2': NIR2, 'emp-ct-b1': NIR3 })
      expect((await refresh(w.rh.token, 'payfit')).state).toBe('SUCCEEDED')
      expect(await countRows('payfit_employees')).toBeGreaterThanOrEqual(3)
      const columns = await sql("select column_name from information_schema.columns where table_schema = 'base' and table_name = 'payfit_employees'")
      expect(columns.map((c) => c.column_name).join(' ')).not.toMatch(/nir|social|secu|ssn/i)
      expectNoNir('payfit_employees', JSON.stringify(await sql('select e::text as t from base.payfit_employees e')), [NIR1, NIR2, NIR3])
      // new in v3: the NIR delivered by PayFit is nevertheless used, in memory, to match the Aqoona row (names differ on purpose)
      const run = await readAqoona([row({ firstName: 'Prénom', lastName: 'Différent', matricule: NIR1, day: d(-3) })])
      expect(run.state).toBe('SUCCEEDED')
      expect((await plannings())[0]).toEqual(expect.objectContaining({ employee_id: 'emp-ct-a1', company_id: 'co-a' }))
      expectNoNir('payfit_employees after matching', JSON.stringify(await sql('select e::text as t from base.payfit_employees e')), [NIR1, NIR2, NIR3])
    })

    it('[rule-evp-aqoona-nir-never-stored] the table of plannings has no column that could carry a NIR, a digest or a fragment of it', async () => {
      const columns = await sql("select column_name from information_schema.columns where table_schema = 'base' and table_name = 'aqoona_plannings'")
      const names = columns.map((c) => c.column_name)
      expect(names).toEqual(expect.arrayContaining(['person_ref', 'creche_code', 'company_id', 'employee_id', 'day', 'slot_type']))
      expect(names.join(' ')).not.toMatch(/nir|matricule|social|secu|ssn|hash|digest|fingerprint|mat_/i)
    })
  })

  // ───────────────────────────── plusieurs SIRET ─────────────────────────────
  describe('people on several SIRET', () => {
    it('[rule-evp-aqoona-multi-siret-same-day] [rule-evp-link-network-wide] a person in two establishments of two SIRET the same day, same hours included: two series, each kept in the crèche of its establishment, both attached to her one collaborator (a salariée belongs to one company); no anomaly', async () => {
      payfitWithNirs({ 'emp-ct-a1': NIR1 })
      const run = await readAqoona([
        row({ crecheName: 'Crèche Alpha', matricule: NIR1, day: d(-2), start: '08:00', end: '12:00' }),
        row({ crecheName: 'Crèche Beta', matricule: NIR1, day: d(-2), start: '08:00', end: '12:00' }),
        row({ crecheName: 'Crèche Alpha', matricule: NIR1, day: d(-2), start: '13:00', end: '17:00' }),
      ])
      expect(run.state).toBe('SUCCEEDED')
      const rows = await plannings()
      expect(rows.map((r) => [r.creche_code, r.company_id, r.employee_id, r.start])).toEqual([
        ['alpha', 'co-a', 'emp-ct-a1', '08:00'],
        ['beta', 'co-b', 'emp-ct-a1', '08:00'],
        ['alpha', 'co-a', 'emp-ct-a1', '13:00'],
      ])
      expect((await slots()).every((s) => s.employee_company_id === 'co-a')).toBe(true)
      expect(volume((await aqoonaSource()).volumes, 'Plannings lus')).toEqual({ label: 'Plannings lus', count: 3 })
      expect(volume((await aqoonaSource()).volumes, 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count: 3 })
      expect((await anomalies()).total).toBe(0)
    })

    it('[rule-evp-link-nir-two-companies] one person carrying the same NIR in two companies (a collaborator in each) is not attached in either establishment: the rows are ambiguous, never resolved by the crèche', async () => {
      await seedContract('co-b', 'ct-b-lea', 'Léa', 'Martin')
      payfitWithNirs({ 'emp-ct-a1': NIR1 })
      const fixture: any = payfitFixture([])
      fixture.employees = [
        ...fixture.employees.map((e: any) => (e.id === 'emp-ct-a1' ? { ...e, nir: NIR1 } : e)),
        { companyId: 'co-b', id: 'emp-ct-b-lea', firstName: 'Léa', lastName: 'Martin', nir: NIR1 },
      ]
      fixture.contracts.push({ companyId: 'co-b', id: 'ct-b-lea', employeeId: 'emp-ct-b-lea', startDate: '2020-01-01', endDate: null })
      writeFixture('payfit', fixture)
      const run = await readAqoona([
        row({ firstName: 'Prénom', lastName: 'Différent', crecheName: 'Crèche Alpha', matricule: NIR1, day: d(-2) }),
        row({ firstName: 'Prénom', lastName: 'Différent', crecheName: 'Crèche Beta', matricule: NIR1, day: d(-2) }),
      ])
      expect(run.state).toBe('SUCCEEDED')
      expect((await slots()).map(link)).toEqual([
        ['co-a', 'alpha', null, null, 'AUCUN', 'NIR_AMBIGUOUS'],
        ['co-b', 'beta', null, null, 'AUCUN', 'NIR_AMBIGUOUS'],
      ])
      expect((await unmatched()).map((i: any) => i.detail).sort()).toEqual([unmatchedDetail('NIR_AMBIGUOUS', 'Crèche Alpha'), unmatchedDetail('NIR_AMBIGUOUS', 'Crèche Beta')])
      expect(volume((await aqoonaSource()).volumes, 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count: 0 })
    })

    it('[rule-evp-employee-multi-company] two homonymous collaborators of two companies are never merged by name: the contracts offered by each crèche stay those of its own company', async () => {
      await seedContract('co-b', 'ct-b-lea', 'Léa', 'Martin')
      await sql("update base.payfit_contracts set status = 'ACTIVE'")
      const alpha = await GET('/creches/alpha/contracts?search=Martin', w.rh.token)
      const beta = await GET('/creches/beta/contracts?search=Martin', w.rh.token)
      expect(alpha.body.items.map((i: any) => i.payfitContractId)).toEqual(['ct-a1'])
      expect(beta.body.items.map((i: any) => i.payfitContractId)).toEqual(['ct-b-lea'])
      // new in v3: each crèche is alone on its SIRET, the answer says so (v2 had no flag)
      expect(alpha.body.planningRestricted).toBe(false)
      expect(beta.body.planningRestricted).toBe(false)
    })
  })

  // ───────────────────────────── dédoublonnage ─────────────────────────────
  describe('de-duplication', () => {
    it('[rule-evp-aqoona-dedupe] two identical rows (same person, establishment, day, hours) are stored once and counted once; a row that differs by its hours is another slot', async () => {
      payfitWithNirs({})
      const run = await readAqoona([row({}), row({}), row({ start: '13:00', end: '17:00' })])
      expect(run.state).toBe('SUCCEEDED')
      const rows = await plannings()
      expect(rows.map((r) => [r.start, r.end])).toEqual([['08:00', '12:00'], ['13:00', '17:00']])
      expect(volume((await aqoonaSource()).volumes, 'Plannings lus')).toEqual({ label: 'Plannings lus', count: 2 })
    })

    it('[rule-evp-aqoona-dedupe] [rule-evp-aqoona-multi-siret-same-day] the same hours the same day in two establishments, of one SIRET or of two, are two rows: the establishment is part of the key', async () => {
      await seedCreche('alpha2', { name: 'Crèche Alpha Deux', siret: SIRET_A })
      payfitWithNirs({})
      const run = await readAqoona([
        row({ crecheName: 'Crèche Alpha' }),
        row({ crecheName: 'Crèche Alpha Deux' }),
        row({ crecheName: 'Crèche Beta' }),
      ])
      expect(run.state).toBe('SUCCEEDED')
      const rows = await plannings()
      expect(rows.map((r) => r.creche_code).sort()).toEqual(['alpha', 'alpha2', 'beta'])
    })
  })

  // ───────────────────────────── garde-fous ─────────────────────────────
  describe('guards', () => {
    it('[rule-evp-aqoona-nir-transient-key] the reading by NIR is a reading: it creates no dossier, no notification and changes no existing dossier', async () => {
      payfitWithNirs({ 'emp-ct-a1': NIR1 })
      const before = JSON.stringify(await sql('select * from base.absences order by id'))
      await readAqoona([row({ matricule: NIR1 })])
      expect(JSON.stringify(await sql('select * from base.absences order by id'))).toBe(before)
      expect(await countRows('notifications')).toBe(0)
      expect(ALL_NIRS).toHaveLength(5)
    })
  })
})
