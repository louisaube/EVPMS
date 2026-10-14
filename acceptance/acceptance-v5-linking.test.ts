import { resetData, closePool, sql } from './harness'
import { logSince, logSize } from './renfort-helpers'
import { GET, seedWorld, seedCreche, seedContract, World, closeEvp, clearFixtures, SIRET_A, SIRET_B, countRows } from './evp-helpers'
import { DIGITS14, NIR_2A, expectNoNir } from './v3-helpers'
import { BAD1_00 } from './v4-helpers'
import {
  ALPHA, AQ_SCOPE_DETAIL, AQ_UNAVAILABLE_DETAIL, BAD1, BAD3, BAD4, BETA, CAUSE_LABELS, CAUSES, Cause, KEY_AQOONA_DETAIL, KEY_AQOONA_LABEL, KEY_PAYFIT_DETAIL,
  KEY_PAYFIT_LABEL, NIR1, NIR2, NIR3, NIR4, NIR_KO, NIR_OK, NO_IDENTITY_LABEL, NO_NAME, UNAVAILABLE_LABEL, UNMATCHED_LABEL, V4_NIRS, d, everythingV5,
  expectNoLongDigits, kit, link, noIdentityDetail, payfitWith, personsOf, rateOfCompany, row, sameName, seedSlot, slotOfDay, slots, spaced, summary, unmatchedDetail,
  writeUnreadablePayfit,
} from './v5-helpers'

// Acceptance suite of version v5-evp-rattachement-nir, part 1: a row of Aqoona is attached to a PayFit collaborator by its NIR alone,
// across the whole network; the five causes of a row that is not attached; the decisions D-0020 to D-0024; the stored columns.
// Default API variant (fake sources: payfit.json carries the optional field `nir` of a collaborator and the lists `nirScopeMissing` /
// `nirUnavailable`; aqoona.json carries the rows). The real-driver side (introspection of every key) is in acceptance-v5-sources-introspection.
describe('Attachment by the NIR alone across the network (v5-evp-rattachement-nir)', () => {
  let w: World
  const { readAqoona, readPayfit, sourceOf, anomaliesOf, ofType, volume, rates, people } = kit(() => w)
  const SIRET_C = '33333333333333'
  const DIFFERENT = { firstName: 'Prénom', lastName: 'Différent' }

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

  /** The anomaly « Planning non rattaché » of a person, with the cause and the crèche read in its detail (never a NIR). */
  async function expectUnmatched(person: string, cause: Cause, creche: string): Promise<void> {
    const found = (await ofType('PLANNING_UNMATCHED')).filter((i: any) => sameName(i.subject, person))
    expect({ person, cause, count: found.length > 0 }).toEqual({ person, cause, count: true })
    expect(found.map((i: any) => i.detail)).toContain(unmatchedDetail(cause, creche))
    for (const i of found) expect(i.label).toBe(UNMATCHED_LABEL)
  }

  // ───────────────────────────── le NIR seul ─────────────────────────────
  describe('the NIR alone', () => {
    it('[rule-evp-link-nir-only] [rule-evp-link-unusable-nir] a row with the exact first and last name of a collaborator but no NIR is not attached: no employee, mode AUCUN, cause NIR_ABSENT, nothing counted as attached, and the anomaly gives the cause', async () => {
      payfitWith({ 'emp-ct-a1': NIR1 })
      const run = await readAqoona([row({ day: d(-3) })])
      expect(run.state).toBe('SUCCEEDED')
      const stored = await slots()
      expect(stored).toHaveLength(1)
      expect(link(stored[0])).toEqual(['co-a', 'alpha', null, null, 'AUCUN', 'NIR_ABSENT'])
      for (const volumes of [run.volumes, (await sourceOf()).volumes]) {
        expect(volume(volumes, 'Plannings lus')).toEqual({ label: 'Plannings lus', count: 1 })
        expect(volume(volumes, 'Plannings rattachés')).toEqual({ label: 'Plannings rattachés', count: 0 })
        expect(volume(volumes, 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count: 0 })
      }
      await expectUnmatched('Léa Martin', 'NIR_ABSENT', 'Crèche Alpha')
    })

    it('[rule-evp-link-nir-only] the NIR designates the collaborator whatever the names say: other names with the right NIR are attached, the names of a collaborator with the NIR of another one are attached to the other', async () => {
      payfitWith({ 'emp-ct-a1': NIR1, 'emp-ct-a2': NIR3 })
      const run = await readAqoona([
        row({ ...DIFFERENT, matricule: spaced(NIR1), day: d(-3) }),
        row({ firstName: 'Léa', lastName: 'Martin', matricule: NIR3, day: d(-2) }), // the names point at emp-ct-a1, the NIR at emp-ct-a2
        row({ firstName: 'Noé', lastName: 'Petit', matricule: NIR1, day: d(-1) }), // the names point at emp-ct-a2, the NIR at emp-ct-a1
        row({ ...DIFFERENT, matricule: NIR1, crecheName: 'Crèche Beta', day: d(-1), start: '13:00', end: '17:00' }), // another company's crèche: the NIR still designates her
      ])
      expect(run.state).toBe('SUCCEEDED')
      const stored = await slots()
      expect(stored.map((s) => s.employee_id)).toEqual(['emp-ct-a1', 'emp-ct-a2', 'emp-ct-a1', 'emp-ct-a1'])
      expect(stored.map((s) => s.match_method)).toEqual(['NIR', 'NIR', 'NIR', 'NIR'])
      expect(stored.map((s) => [s.company_id, s.employee_company_id])).toEqual([['co-a', 'co-a'], ['co-a', 'co-a'], ['co-a', 'co-a'], ['co-b', 'co-a']])
      expect(await ofType('PLANNING_UNMATCHED')).toEqual([])
    })

    it('[rule-evp-link-nir-only] [rule-evp-link-unusable-nir] there is no fallback on the names whatever the reason: no NIR, an ill-formed value, a wrong key, an unknown NIR, an ambiguous NIR — a unique name that designates one collaborator never attaches the row', async () => {
      payfitWith({ 'emp-ct-a1': NIR1, 'emp-ct-a2': NIR3, 'emp-ct-b1': NIR3 })
      const run = await readAqoona([
        row({ matricule: '', day: d(-8) }),
        row({ matricule: 'MAT-42', day: d(-7) }),
        row({ matricule: BAD1, day: d(-6) }),
        row({ matricule: NIR4, day: d(-5) }),
        row({ firstName: 'Noé', lastName: 'Petit', matricule: NIR3, day: d(-4) }),
      ])
      expect(run.state).toBe('SUCCEEDED')
      const stored = await slots()
      expect(stored).toHaveLength(5)
      expect(stored.map((s) => s.employee_id)).toEqual([null, null, null, null, null])
      expect(stored.map((s) => s.employee_company_id)).toEqual([null, null, null, null, null])
      expect(stored.map((s) => s.match_method)).toEqual(['AUCUN', 'AUCUN', 'AUCUN', 'AUCUN', 'AUCUN'])
      expect(volume((await sourceOf()).volumes, 'Plannings rattachés')).toEqual({ label: 'Plannings rattachés', count: 0 })
    })

    it('[rule-evp-link-nir-only] « Plannings rattachés » and « Rapprochés par NIR » are always equal, in the run and in GET /sources, with the three labels in their order', async () => {
      payfitWith({ 'emp-ct-a1': NIR1, 'emp-ct-a2': NIR3 })
      const run = await readAqoona([
        row({ matricule: NIR1, day: d(-6) }),
        row({ firstName: 'Noé', lastName: 'Petit', matricule: NIR3, day: d(-5) }),
        row({ ...DIFFERENT, matricule: NIR1, crecheName: 'Crèche Beta', day: d(-4) }),
        row({ firstName: 'Noé', lastName: 'Petit', day: d(-3) }),
        row({ firstName: 'Zoé', lastName: 'Durand', crecheName: 'Crèche Beta', day: d(-2) }),
      ])
      expect(run.state).toBe('SUCCEEDED')
      for (const volumes of [run.volumes, (await sourceOf()).volumes]) {
        expect(volumes.map((v: any) => v.label)).toEqual(['Plannings lus', 'Plannings rattachés', 'Rapprochés par NIR'])
        expect(volume(volumes, 'Plannings lus')).toEqual({ label: 'Plannings lus', count: 5 })
        expect(volume(volumes, 'Plannings rattachés')).toEqual({ label: 'Plannings rattachés', count: 3 })
        expect(volume(volumes, 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count: 3 })
      }
    })

    it('[rule-evp-aqoona-nir-format] spaces, dots and dashes are ignored, 2A stands for the department digits and 15 characters are compared; 14 digits (the shape of a SIRET) or any other length is not a NIR: cause NIR_ABSENT', async () => {
      payfitWith({ 'emp-ct-a1': NIR_2A, 'emp-ct-a2': DIGITS14 })
      const run = await readAqoona([
        row({ ...DIFFERENT, matricule: '1 90 05 2A 123 456 79', day: d(-8) }),
        row({ ...DIFFERENT, matricule: '1.90.05.2A.123.456.79', day: d(-7) }),
        row({ ...DIFFERENT, matricule: '1-90-05-2A-123-456-79', day: d(-6) }),
        row({ ...DIFFERENT, matricule: DIGITS14, day: d(-5) }),
        row({ ...DIFFERENT, matricule: '12345', day: d(-4) }),
        row({ ...DIFFERENT, matricule: '1850575123456789', day: d(-3) }),
        row({ ...DIFFERENT, matricule: 'ABC', day: d(-2) }),
      ])
      expect(run.state).toBe('SUCCEEDED')
      const stored = await slots()
      expect(stored.slice(0, 3).map((s) => [s.employee_id, s.match_method])).toEqual([['emp-ct-a1', 'NIR'], ['emp-ct-a1', 'NIR'], ['emp-ct-a1', 'NIR']])
      expect(stored.slice(3).map((s) => [s.employee_id, s.match_method, s.unlinked_cause])).toEqual(Array(4).fill([null, 'AUCUN', 'NIR_ABSENT']))
      expect(volume((await sourceOf()).volumes, 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count: 3 })
      expectNoNir('tables', JSON.stringify(stored), [NIR_2A])
      expect(JSON.stringify(stored)).not.toContain(DIGITS14)
    })

    it('[rule-evp-link-nir-only] a row without name but with a NIR of a collaborator is attached to her (the name is not needed); a row with a NIR of nobody and no name is « Personne non nommée »', async () => {
      payfitWith({ 'emp-ct-a1': NIR1 })
      const run = await readAqoona([
        row({ firstName: '', lastName: '', matricule: NIR1, day: d(-3) }),
        row({ firstName: '', lastName: '', matricule: NIR4, day: d(-2) }),
      ])
      expect(run.state).toBe('SUCCEEDED')
      const stored = await slots()
      expect(link(slotOfDay(stored, d(-3)))).toEqual(['co-a', 'alpha', 'co-a', 'emp-ct-a1', 'NIR', null])
      expect(link(slotOfDay(stored, d(-2)))).toEqual(['co-a', 'alpha', null, null, 'AUCUN', 'NIR_UNKNOWN'])
      await expectUnmatched(NO_NAME, 'NIR_UNKNOWN', 'Crèche Alpha')
    })
  })

  // ───────────────────────────── tout le réseau ─────────────────────────────
  describe('the whole network', () => {
    it('[rule-evp-link-network-wide] a NIR carried only by a collaborator of another company than the crèche is attached to her: the collaborator is searched in the whole network', async () => {
      payfitWith({ 'emp-ct-b1': NIR2 })
      const run = await readAqoona([row({ ...DIFFERENT, matricule: NIR2, day: d(-3) })])
      expect(run.state).toBe('SUCCEEDED')
      expect((await slots()).map(link)).toEqual([['co-a', 'alpha', 'co-b', 'emp-ct-b1', 'NIR', null]])
      expect(await ofType('PLANNING_UNMATCHED')).toEqual([])
      expect(volume((await sourceOf()).volumes, 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count: 1 })
    })

    it('[rule-evp-link-network-wide] [rule-evp-link-one-establishment] a floating employee (volante): Léa of company A read in a crèche of company B keeps the crèche and the company where she was read, and counts for her reference company A, once', async () => {
      payfitWith({ 'emp-ct-a1': NIR1 })
      const run = await readAqoona([
        row({ matricule: NIR1, crecheName: 'Crèche Alpha', day: d(-3) }),
        row({ matricule: NIR1, crecheName: 'Crèche Beta', day: d(-2) }),
        row({ matricule: NIR1, crecheName: 'Crèche Beta', day: d(-1) }),
      ])
      expect(run.state).toBe('SUCCEEDED')
      expect((await slots()).map(link)).toEqual([
        ['co-a', 'alpha', 'co-a', 'emp-ct-a1', 'NIR', null],
        ['co-b', 'beta', 'co-a', 'emp-ct-a1', 'NIR', null],
        ['co-b', 'beta', 'co-a', 'emp-ct-a1', 'NIR', null],
      ])
      const items = (await rates()).items
      expect(summary(items)).toEqual([['co-a', 1, 0]])
      expect(rateOfCompany(items, 'co-b')).toBeUndefined()
    })

    it('[rule-evp-link-network-wide] a company that has no collaborator with a NIR in its own crèche is still found: the collaborator of each company is attached whatever the crèche of the row', async () => {
      payfitWith({ 'emp-ct-a1': NIR1, 'emp-ct-a2': NIR3, 'emp-ct-b1': NIR2 })
      await readAqoona([
        row({ ...DIFFERENT, matricule: NIR2, crecheName: 'Crèche Alpha', day: d(-3) }),
        row({ ...DIFFERENT, matricule: NIR1, crecheName: 'Crèche Beta', day: d(-2) }),
        row({ ...DIFFERENT, matricule: NIR3, crecheName: 'Établissement Inconnu', day: d(-1) }),
      ])
      expect((await slots()).map((s) => [s.employee_company_id, s.employee_id])).toEqual([['co-b', 'emp-ct-b1'], ['co-a', 'emp-ct-a1'], ['co-a', 'emp-ct-a2']])
    })

    it('[rule-evp-link-network-wide] [rule-evp-employee-multi-company] two homonymous collaborators of two companies are never merged by the name: each NIR designates its own collaborator', async () => {
      await seedContract('co-b', 'ct-b-lea', 'Léa', 'Martin')
      await sql("update base.payfit_contracts set status = 'ACTIVE'")
      const homonym = { companyId: 'co-b', id: 'emp-ct-b-lea', firstName: 'Léa', lastName: 'Martin' }
      payfitWith({ 'co-a/emp-ct-a1': NIR1, 'co-b/emp-ct-b-lea': NIR2 }, { employees: [homonym], contracts: [{ companyId: 'co-b', id: 'ct-b-lea', employeeId: 'emp-ct-b-lea', startDate: '2020-01-01', endDate: null }] })
      const run = await readAqoona([row({ matricule: NIR2, day: d(-3) }), row({ matricule: NIR1, day: d(-2) }), row({ matricule: '', day: d(-1) })])
      expect(run.state).toBe('SUCCEEDED')
      expect((await slots()).map((s) => [s.employee_company_id, s.employee_id])).toEqual([['co-b', 'emp-ct-b-lea'], ['co-a', 'emp-ct-a1'], [null, null]])
    })

    it('[rule-evp-link-network-wide] [rule-evp-link-one-establishment] two rows with the same NIR in two establishments of two companies attach to the same collaborator, the slots keep their own company and crèche', async () => {
      payfitWith({ 'emp-ct-a1': NIR1 })
      await readAqoona([
        row({ ...DIFFERENT, matricule: NIR1, crecheName: 'Crèche Alpha', day: d(-2) }),
        row({ ...DIFFERENT, matricule: NIR1, crecheName: 'Crèche Beta', day: d(-2) }),
      ])
      expect((await slots()).map(link)).toEqual([
        ['co-a', 'alpha', 'co-a', 'emp-ct-a1', 'NIR', null],
        ['co-b', 'beta', 'co-a', 'emp-ct-a1', 'NIR', null],
      ])
      expect(await ofType('PLANNING_UNMATCHED')).toEqual([])
    })

    it('[rule-evp-link-causes] [rule-evp-link-nir-two-companies] one collaborator carrying two contracts and one NIR is one person: the row is attached, with neither ambiguity nor anomaly', async () => {
      await sql("insert into base.payfit_contracts (company_id, payfit_contract_id, employee_id, start_date, status) values ('co-a', 'ct-a1-bis', 'emp-ct-a1', '2024-01-01', 'ACTIVE')")
      payfitWith({ 'emp-ct-a1': NIR1 }, { contracts: [{ companyId: 'co-a', id: 'ct-a1-bis', employeeId: 'emp-ct-a1', startDate: '2024-01-01', endDate: null }] })
      const run = await readAqoona([row({ ...DIFFERENT, matricule: NIR1 })])
      expect(run.state).toBe('SUCCEEDED')
      expect((await slots()).map(link)).toEqual([['co-a', 'alpha', 'co-a', 'emp-ct-a1', 'NIR', null]])
      expect(await ofType('PLANNING_UNMATCHED')).toEqual([])
      expect(volume((await sourceOf()).volumes, 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count: 1 })
    })
  })

  // ───────────────────────────── les cinq causes ─────────────────────────────
  describe('the five causes of a row that is not attached', () => {
    it('[rule-evp-link-causes] NIR_ABSENT: no NIR, or a value that does not have the shape of a NIR of 15 characters', async () => {
      payfitWith({ 'emp-ct-a1': NIR1 })
      const values: unknown[] = [null, '', 'MAT-42', '12345', DIGITS14, '1850575123456789', 'ABC']
      const run = await readAqoona(values.map((matricule, i) => row({ firstName: 'Zita', lastName: `Absente${i}`, matricule, day: d(-10 + i) })))
      expect(run.state).toBe('SUCCEEDED')
      const stored = await slots()
      expect(stored).toHaveLength(values.length)
      expect(stored.map((s) => [s.employee_id, s.match_method, s.unlinked_cause])).toEqual(values.map(() => [null, 'AUCUN', 'NIR_ABSENT']))
      for (let i = 0; i < values.length; i += 1) await expectUnmatched(`Zita Absente${i}`, 'NIR_ABSENT', 'Crèche Alpha')
    })

    it('[rule-evp-link-causes] NIR_KEY_INVALID: a NIR whose check key is wrong (also the key 00), in any written form', async () => {
      payfitWith({ 'emp-ct-a1': NIR1 })
      const run = await readAqoona([
        row({ firstName: 'Kim', lastName: 'Fausse', matricule: BAD1, day: d(-6) }),
        row({ firstName: 'Kim', lastName: 'Autre', matricule: spaced(BAD1), crecheName: 'Crèche Beta', day: d(-5) }),
        row({ firstName: 'Kim', lastName: 'Zero', matricule: BAD1_00, day: d(-4) }),
        row({ firstName: 'Kim', lastName: 'Neuf', matricule: NIR_KO, day: d(-3) }),
      ])
      expect(run.state).toBe('SUCCEEDED')
      expect((await slots()).map((s) => [s.employee_id, s.match_method, s.unlinked_cause])).toEqual(Array(4).fill([null, 'AUCUN', 'NIR_KEY_INVALID']))
      await expectUnmatched('Kim Fausse', 'NIR_KEY_INVALID', 'Crèche Alpha')
      await expectUnmatched('Kim Autre', 'NIR_KEY_INVALID', 'Crèche Beta')
      await expectUnmatched('Kim Zero', 'NIR_KEY_INVALID', 'Crèche Alpha')
      await expectUnmatched('Kim Neuf', 'NIR_KEY_INVALID', 'Crèche Alpha')
    })

    it('[rule-evp-link-causes] NIR_UNKNOWN: a NIR of right key that no collaborator of the network carries, all the companies being read', async () => {
      payfitWith({ 'emp-ct-a1': NIR1, 'emp-ct-b1': NIR2 })
      const run = await readAqoona([row({ firstName: 'Una', lastName: 'Inconnue', matricule: NIR4, day: d(-3) })])
      expect(run.state).toBe('SUCCEEDED')
      expect((await slots()).map(link)).toEqual([['co-a', 'alpha', null, null, 'AUCUN', 'NIR_UNKNOWN']])
      await expectUnmatched('Una Inconnue', 'NIR_UNKNOWN', 'Crèche Alpha')
      expect(await ofType('aqoona_nir_unavailable')).toEqual([])
    })

    it('[rule-evp-link-causes] NIR_AMBIGUOUS: a NIR of right key carried by two collaborators of the same company; none is attached, the names are not used to choose between them', async () => {
      payfitWith({ 'emp-ct-a1': NIR1, 'emp-ct-a2': NIR1 })
      const run = await readAqoona([row({ firstName: 'Léa', lastName: 'Martin', matricule: NIR1, day: d(-3) })])
      expect(run.state).toBe('SUCCEEDED')
      expect((await slots()).map(link)).toEqual([['co-a', 'alpha', null, null, 'AUCUN', 'NIR_AMBIGUOUS']])
      await expectUnmatched('Léa Martin', 'NIR_AMBIGUOUS', 'Crèche Alpha')
      expect(volume((await sourceOf()).volumes, 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count: 0 })
    })

    it('[rule-evp-link-causes] [rule-evp-link-nir-two-companies] NIR_AMBIGUOUS also for a NIR carried by one collaborator of company A and one of company B, whatever the crèche of the row', async () => {
      payfitWith({ 'emp-ct-a1': NIR1, 'emp-ct-b1': NIR1 })
      const run = await readAqoona([
        row({ ...DIFFERENT, matricule: NIR1, crecheName: 'Crèche Alpha', day: d(-3) }),
        row({ ...DIFFERENT, matricule: NIR1, crecheName: 'Crèche Beta', day: d(-2) }),
      ])
      expect(run.state).toBe('SUCCEEDED')
      expect((await slots()).map(link)).toEqual([
        ['co-a', 'alpha', null, null, 'AUCUN', 'NIR_AMBIGUOUS'],
        ['co-b', 'beta', null, null, 'AUCUN', 'NIR_AMBIGUOUS'],
      ])
    })

    it('[rule-evp-link-causes] [rule-evp-link-incomplete-read] PAYFIT_INCOMPLETE: a NIR of right key that nobody readable carries while a company of the network lacks the scope, or cannot be read', async () => {
      for (const options of [{ scopeMissing: [SIRET_B] }, { unavailable: [SIRET_B] }, { scopeMissing: [SIRET_A] }]) {
        await resetData()
        clearFixtures()
        w = await seedWorld()
        payfitWith({ 'emp-ct-a1': NIR1 }, options)
        const run = await readAqoona([row({ firstName: 'Ines', lastName: 'Incomplete', matricule: NIR4, day: d(-3) })])
        expect({ options, state: run.state }).toEqual({ options, state: 'SUCCEEDED' })
        expect({ options, stored: (await slots()).map(link) }).toEqual({ options, stored: [['co-a', 'alpha', null, null, 'AUCUN', 'PAYFIT_INCOMPLETE']] })
        await expectUnmatched('Ines Incomplete', 'PAYFIT_INCOMPLETE', 'Crèche Alpha')
      }
    })

    it('[rule-evp-link-causes] the order of the causes: absent or ill-formed, then wrong key, then ambiguous, then incomplete read, then unknown — one cause per row', async () => {
      payfitWith({ 'emp-ct-a1': NIR1, 'emp-ct-a2': NIR1 }, { scopeMissing: [SIRET_B] })
      const run = await readAqoona([
        row({ firstName: 'Ordre', lastName: 'Un', matricule: 'MAT-1', day: d(-6) }), // ill-formed, although a company is unreadable
        row({ firstName: 'Ordre', lastName: 'Deux', matricule: BAD3, day: d(-5) }), // wrong key, although a company is unreadable
        row({ firstName: 'Ordre', lastName: 'Trois', matricule: NIR1, day: d(-4) }), // ambiguous among readable collaborators, although a company is unreadable
        row({ firstName: 'Ordre', lastName: 'Quatre', matricule: NIR4, day: d(-3) }), // not found, a company is unreadable
      ])
      expect(run.state).toBe('SUCCEEDED')
      expect((await slots()).map((s) => s.unlinked_cause)).toEqual(['NIR_ABSENT', 'NIR_KEY_INVALID', 'NIR_AMBIGUOUS', 'PAYFIT_INCOMPLETE'])
    })

    it('[rule-evp-link-incomplete-read] a NIR found among the readable companies is attached even when another company of the network cannot be read', async () => {
      payfitWith({ 'emp-ct-a1': NIR1 }, { scopeMissing: [SIRET_B], unavailable: [] })
      const run = await readAqoona([row({ ...DIFFERENT, matricule: NIR1, day: d(-3) })])
      expect(run.state).toBe('SUCCEEDED')
      expect((await slots()).map(link)).toEqual([['co-a', 'alpha', 'co-a', 'emp-ct-a1', 'NIR', null]])
    })

    it('[rule-evp-link-unusable-nir] [rule-evp-nir-key-never-shown] the anomaly « Planning non rattaché » gives the cause and the crèche and never a NIR, a fragment or a digit', async () => {
      payfitWith({ 'emp-ct-a1': NIR1 })
      await readAqoona([
        row({ firstName: 'Cause', lastName: 'Absente', day: d(-4) }),
        row({ firstName: 'Cause', lastName: 'Fausse', matricule: BAD1, day: d(-3) }),
        row({ firstName: 'Cause', lastName: 'Inconnue', matricule: NIR4, day: d(-2) }),
      ])
      const items = await ofType('PLANNING_UNMATCHED')
      expect(items).toHaveLength(3)
      for (const i of items) expect(i.label).toBe(UNMATCHED_LABEL)
      expect(items.map((i: any) => i.detail).sort()).toEqual(
        [unmatchedDetail('NIR_ABSENT', 'Crèche Alpha'), unmatchedDetail('NIR_KEY_INVALID', 'Crèche Alpha'), unmatchedDetail('NIR_UNKNOWN', 'Crèche Alpha')].sort(),
      )
      expectNoNir('anomalies', JSON.stringify(items), V4_NIRS)
      expectNoLongDigits('anomalies', JSON.stringify(items.map((i: any) => [i.subject, i.detail])))
      expect(JSON.stringify(items)).not.toMatch(/introuvable ou ambiguë|Rattachement par NIR ambigu|prénom et le nom|Les noms sont utilisés/)
    })

    it('[rule-evp-link-causes] [rule-evp-unlinked-list] the five causes are exactly the five values of the list, each with its French label', async () => {
      expect(CAUSES).toEqual(['NIR_ABSENT', 'NIR_KEY_INVALID', 'NIR_UNKNOWN', 'NIR_AMBIGUOUS', 'PAYFIT_INCOMPLETE'])
      payfitWith({ 'emp-ct-a1': NIR1, 'emp-ct-a2': NIR1, 'emp-ct-b1': NIR2 })
      await readAqoona([
        row({ firstName: 'Cinq', lastName: 'Absente', day: d(-4) }),
        row({ firstName: 'Cinq', lastName: 'Fausse', matricule: BAD1, day: d(-3) }),
        row({ firstName: 'Cinq', lastName: 'Ambigue', matricule: NIR1, day: d(-2) }),
        row({ firstName: 'Cinq', lastName: 'Inconnue', matricule: NIR4, day: d(-1) }),
      ])
      const list = await people()
      expect(list.available).toBe(true)
      expect(list.total).toBe(4)
      const byName = Object.fromEntries(list.items.map((i: any) => [i.name.split(' ')[1].toLowerCase(), [i.cause, i.causeLabel]]))
      expect(byName).toEqual({
        absente: ['NIR_ABSENT', CAUSE_LABELS.NIR_ABSENT],
        fausse: ['NIR_KEY_INVALID', CAUSE_LABELS.NIR_KEY_INVALID],
        ambigue: ['NIR_AMBIGUOUS', CAUSE_LABELS.NIR_AMBIGUOUS],
        inconnue: ['NIR_UNKNOWN', CAUSE_LABELS.NIR_UNKNOWN],
      })
      // the fifth cause needs an unreadable company
      payfitWith({ 'emp-ct-a1': NIR1 }, { scopeMissing: [SIRET_B] })
      await readAqoona([row({ firstName: 'Cinq', lastName: 'Incomplete', matricule: NIR4, day: d(-1) })])
      const second = await people()
      expect(personsOf(second.items).map(([, cause]) => cause)).toEqual(['PAYFIT_INCOMPLETE'])
      expect(second.items[0].causeLabel).toBe(CAUSE_LABELS.PAYFIT_INCOMPLETE)
    })

    it('[rule-evp-unlinked-list-all-causes-visible] each of the five causes appears in the list with its own non-empty label, none is hidden or merged with another', async () => {
      const seen = new Map<string, string>()
      const collect = (items: any[]) => {
        for (const i of items) seen.set(i.cause, i.causeLabel)
      }
      payfitWith({ 'emp-ct-a1': NIR1, 'emp-ct-a2': NIR1, 'emp-ct-b1': NIR2 })
      await readAqoona([
        row({ firstName: 'Vue', lastName: 'Absente', day: d(-4) }),
        row({ firstName: 'Vue', lastName: 'Fausse', matricule: BAD1, day: d(-3) }),
        row({ firstName: 'Vue', lastName: 'Ambigue', matricule: NIR1, day: d(-2) }),
        row({ firstName: 'Vue', lastName: 'Inconnue', matricule: NIR4, day: d(-1) }),
      ])
      const first = await people()
      expect(first.total).toBe(4)
      collect(first.items)
      // PAYFIT_INCOMPLETE needs a company that cannot be read, which excludes NIR_UNKNOWN: second reading
      payfitWith({ 'emp-ct-a1': NIR1 }, { scopeMissing: [SIRET_B] })
      await readAqoona([row({ firstName: 'Vue', lastName: 'Incomplete', matricule: NIR4, day: d(-1) })])
      const second = await people()
      expect(second.total).toBe(1)
      collect(second.items)
      expect([...seen.keys()].sort()).toEqual([...CAUSES].sort())
      for (const cause of CAUSES) {
        expect(seen.get(cause)).toBe(CAUSE_LABELS[cause as keyof typeof CAUSE_LABELS])
        expect((seen.get(cause) ?? '').trim().length).toBeGreaterThan(0)
      }
      expect(new Set(seen.values()).size).toBe(5)
    })
  })

  // ───────────────────────────── ligne sans nom ni NIR, établissement inconnu ─────────────────────────────
  describe('a row without name nor NIR, an unknown establishment', () => {
    it('[rule-evp-link-no-identity] a row without name and without NIR is an anomaly « Ligne Aqoona sans nom ni NIR »: the slot is kept, not attached, without cause; it is neither in the list nor in the rates; the reading stays SUCCEEDED', async () => {
      payfitWith({ 'emp-ct-a1': NIR1 })
      const run = await readAqoona([row({ firstName: '', lastName: '', matricule: null, day: d(-3) })])
      expect(run.state).toBe('SUCCEEDED')
      expect((await sourceOf()).state).toBe('UP_TO_DATE')
      const stored = await slots()
      expect(stored).toHaveLength(1)
      expect([stored[0].employee_id, stored[0].employee_company_id, stored[0].match_method, stored[0].unlinked_cause]).toEqual([null, null, 'AUCUN', null])
      expect(volume(run.volumes, 'Plannings lus')).toEqual({ label: 'Plannings lus', count: 1 })
      expect(volume(run.volumes, 'Plannings rattachés')).toEqual({ label: 'Plannings rattachés', count: 0 })
      const items = await ofType('aqoona_no_identity')
      expect(items).toHaveLength(1)
      expect(items[0].label).toBe(NO_IDENTITY_LABEL)
      expect(typeof items[0].subject).toBe('string')
      expect(items[0].subject.length).toBeGreaterThan(0)
      expect(items[0].detail).toMatch(noIdentityDetail(1))
      expect(await ofType('PLANNING_UNMATCHED')).toEqual([])
      const list = await people()
      expect([list.available, list.total, list.items]).toEqual([true, 0, []])
      const body = await rates()
      expect([body.available, body.items]).toEqual([true, []])
    })

    it('[rule-evp-link-no-identity] the count of the detail is the number of such rows; a row with a name but no NIR, or a NIR but no name, is not a row without identity', async () => {
      payfitWith({ 'emp-ct-a1': NIR1 })
      await readAqoona([
        row({ firstName: '', lastName: '', matricule: null, day: d(-6) }),
        row({ firstName: '', lastName: '', matricule: '', day: d(-5) }),
        row({ firstName: '', lastName: '', matricule: null, day: d(-4), crecheName: 'Crèche Beta' }),
        row({ firstName: 'Nom', lastName: 'Seul', matricule: null, day: d(-3) }),
        row({ firstName: '', lastName: '', matricule: NIR1, day: d(-2) }),
      ])
      const items = await ofType('aqoona_no_identity')
      expect(items).toHaveLength(1)
      expect(items[0].detail).toMatch(noIdentityDetail(3))
      expect((await slots()).filter((s) => s.employee_id !== null)).toHaveLength(1)
    })

    it('[rule-evp-link-unknown-creche] a row whose NIR designates a collaborator is attached even if its establishment is unknown of the referential: the slot keeps no crèche, and no anomaly speaks of the establishment', async () => {
      payfitWith({ 'emp-ct-a1': NIR1 })
      const run = await readAqoona([row({ ...DIFFERENT, matricule: NIR1, crecheName: 'Établissement Inconnu', day: d(-3) })])
      expect(run.state).toBe('SUCCEEDED')
      const stored = await slots()
      expect(stored).toHaveLength(1)
      expect([stored[0].creche_code, stored[0].company_id, stored[0].employee_company_id, stored[0].employee_id, stored[0].match_method]).toEqual([null, null, 'co-a', 'emp-ct-a1', 'NIR'])
      const all = (await anomaliesOf()).items
      expect(all.filter((i: any) => i.type === 'PLANNING_UNMATCHED' || /Établissement|Crèche introuvable/.test(`${i.label} ${i.detail}`))).toEqual([])
      expect(volume(run.volumes, 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count: 1 })
    })

    it('[rule-evp-link-unknown-creche] [rule-evp-unlinked-list] a row not attached in an unknown establishment keeps the establishment as it was read: in the stored slot, in the detail of the anomaly and in the crèches of the list (no NIR)', async () => {
      payfitWith({ 'emp-ct-a1': NIR1 })
      await readAqoona([row({ firstName: 'Eve', lastName: 'Ailleurs', matricule: BAD1, crecheName: 'Établissement Inconnu', day: d(-3) })])
      const stored = await slots()
      expect([stored[0].creche_code, stored[0].company_id, stored[0].unlinked_cause, stored[0].creche_label]).toEqual([null, null, 'NIR_KEY_INVALID', 'Établissement Inconnu'])
      await expectUnmatched('Eve Ailleurs', 'NIR_KEY_INVALID', 'Établissement Inconnu')
      const list = await people()
      expect(personsOf(list.items).map(([name, cause, creches]) => [sameName(name, 'Eve Ailleurs'), cause, creches])).toEqual([[true, 'NIR_KEY_INVALID', ['Établissement Inconnu']]])
      expect(JSON.stringify(await anomaliesOf())).not.toMatch(/introuvable ou ambiguë/)
    })
  })

  // ───────────────────────────── décisions ─────────────────────────────
  describe('decisions of the version', () => {
    it('[rule-evp-link-nir-two-companies][D-0020] GET /sources/aqoona/unlinked-people with the same NIR (right key) carried by a collaborator of Alpha and one of Beta, a row of Aqoona with this NIR in a crèche of Alpha, PayFit then Aqoona read: 200, the person is there with the cause NIR_AMBIGUOUS, and GET /sources/aqoona/matching-rates attaches nobody (linked.count 0 for Alpha and for Beta)', async () => {
      payfitWith({ 'emp-ct-a1': NIR1, 'emp-ct-b1': NIR1 })
      expect((await readPayfit()).state).toBe('SUCCEEDED')
      const run = await readAqoona([row({ firstName: 'Léa', lastName: 'Martin', matricule: NIR1, crecheName: 'Crèche Alpha', day: d(-3) })])
      expect(run.state).toBe('SUCCEEDED')
      const list = await GET('/sources/aqoona/unlinked-people', w.rh.token)
      expect(list.status).toBe(200)
      const persons = personsOf(list.body.items).filter(([name]) => sameName(name, 'Léa Martin'))
      expect(persons.map(([, cause]) => cause)).toEqual(['NIR_AMBIGUOUS'])
      const res = await GET('/sources/aqoona/matching-rates', w.rh.token)
      expect(res.status).toBe(200)
      expect(res.body.available).toBe(true)
      expect(res.body.items.length).toBeGreaterThanOrEqual(1)
      for (const item of res.body.items) expect(item.linked.count).toBe(0)
      expect(rateOfCompany(res.body.items, 'co-a')?.unlinked.count).toBe(1)
      expect(rateOfCompany(res.body.items, 'co-b')?.linked.count ?? 0).toBe(0)
      expect((await slots()).map((s) => s.employee_id)).toEqual([null])
    })

    it('[rule-evp-link-incomplete-read][D-0021] GET /sources/aqoona/unlinked-people with Alpha in nirScopeMissing and a row of Aqoona whose NIR (right key) is carried by no readable collaborator, Aqoona read: 200, the person is there with the cause PAYFIT_INCOMPLETE', async () => {
      payfitWith({ 'emp-ct-a1': NIR1 }, { scopeMissing: [SIRET_A] })
      const run = await readAqoona([row({ firstName: 'Léa', lastName: 'Martin', matricule: NIR1, day: d(-3) })])
      expect(run.state).toBe('SUCCEEDED')
      const res = await GET('/sources/aqoona/unlinked-people', w.rh.token)
      expect(res.status).toBe(200)
      expect(res.body.available).toBe(true)
      const persons = personsOf(res.body.items).filter(([name]) => sameName(name, 'Léa Martin'))
      expect(persons.map(([, cause]) => cause)).toEqual(['PAYFIT_INCOMPLETE'])
      expect(res.body.items.find((i: any) => i.cause === 'PAYFIT_INCOMPLETE').causeLabel).toBe('NIR non vérifié : lecture PayFit incomplète')
      expect(res.body.items.some((i: any) => i.cause === 'NIR_UNKNOWN')).toBe(false)
    })

    it('[rule-evp-link-unknown-creche][D-0022] GET /sources/aqoona/anomalies with a row whose NIR (right key) is that of a collaborator of Alpha and whose establishment is absent from the referential, PayFit then Aqoona read: 200, no « Planning non rattaché » and no « Établissement Aqoona inconnu »; GET /sources/aqoona/matching-rates: linked.count 1 for Alpha', async () => {
      payfitWith({ 'emp-ct-a1': NIR1 })
      expect((await readPayfit()).state).toBe('SUCCEEDED')
      const run = await readAqoona([row({ firstName: 'Léa', lastName: 'Martin', matricule: NIR1, crecheName: 'Établissement Fantôme', day: d(-3) })])
      expect(run.state).toBe('SUCCEEDED')
      const anomalies = await GET('/sources/aqoona/anomalies?size=50', w.rh.token)
      expect(anomalies.status).toBe(200)
      expect(anomalies.body.items.filter((i: any) => i.label === UNMATCHED_LABEL || i.type === 'PLANNING_UNMATCHED' || i.label === 'Établissement Aqoona inconnu' || /Fantôme/.test(`${i.subject} ${i.detail}`))).toEqual([])
      const res = await GET('/sources/aqoona/matching-rates', w.rh.token)
      expect(res.status).toBe(200)
      expect(rateOfCompany(res.body.items, 'co-a')?.linked.count).toBe(1)
    })

    it('[rule-evp-link-person-both-states][D-0023] GET /sources/aqoona/unlinked-people with two rows « Camille DURAND » (one with the NIR of a collaborator, one without NIR in another crèche of the same company), PayFit then Aqoona read: 200, « Camille DURAND » is there with NIR_ABSENT; GET /sources/aqoona/matching-rates: linked.count 1 and unlinked.count 1 for the company', async () => {
      await seedCreche('alpha2', { name: 'Crèche Alpha Deux', siret: SIRET_A })
      await seedContract('co-a', 'ct-a-cam', 'Camille', 'Durand')
      payfitWith(
        { 'emp-ct-a-cam': NIR1 },
        {
          employees: [{ companyId: 'co-a', id: 'emp-ct-a-cam', firstName: 'Camille', lastName: 'Durand' }],
          contracts: [{ companyId: 'co-a', id: 'ct-a-cam', employeeId: 'emp-ct-a-cam', startDate: '2020-01-01', endDate: null }],
        },
      )
      expect((await readPayfit()).state).toBe('SUCCEEDED')
      const run = await readAqoona([
        row({ firstName: 'Camille', lastName: 'DURAND', matricule: NIR1, crecheName: 'Crèche Alpha', day: d(-3) }),
        row({ firstName: 'Camille', lastName: 'DURAND', matricule: null, crecheName: 'Crèche Alpha Deux', day: d(-3) }),
      ])
      expect(run.state).toBe('SUCCEEDED')
      const list = await GET('/sources/aqoona/unlinked-people', w.rh.token)
      expect(list.status).toBe(200)
      expect(personsOf(list.body.items).map(([name, cause, creches]) => [sameName(name, 'Camille DURAND'), cause, creches])).toEqual([[true, 'NIR_ABSENT', ['Crèche Alpha Deux']]])
      const res = await GET('/sources/aqoona/matching-rates', w.rh.token)
      expect(res.status).toBe(200)
      expect(rateOfCompany(res.body.items, 'co-a')).toMatchObject({ total: 2, linked: { count: 1 }, unlinked: { count: 1 } })
    })

    it('[rule-evp-link-employee-not-read][D-0024] GET /sources/aqoona/unlinked-people with a collaborator of Alpha present in the live NIR of PayFit but absent from the stored collaborators, a row with her NIR, Aqoona read without any PayFit reading: 200, the person is there with PAYFIT_INCOMPLETE; GET /sources/aqoona/matching-rates: linked.count 0', async () => {
      const ghost = { companyId: 'co-a', id: 'emp-ghost', firstName: 'Gaëlle', lastName: 'Fantôme' }
      payfitWith({ 'emp-ghost': NIR3 }, { employees: [ghost] })
      expect(await countRows('payfit_employees', "employee_id = 'emp-ghost'")).toBe(0)
      const run = await readAqoona([row({ firstName: 'Gaëlle', lastName: 'Fantôme', matricule: NIR3, day: d(-3) })])
      expect(run.state).toBe('SUCCEEDED')
      const list = await GET('/sources/aqoona/unlinked-people', w.rh.token)
      expect(list.status).toBe(200)
      expect(personsOf(list.body.items).map(([name, cause]) => [sameName(name, 'Gaëlle Fantôme'), cause])).toEqual([[true, 'PAYFIT_INCOMPLETE']])
      const res = await GET('/sources/aqoona/matching-rates', w.rh.token)
      expect(res.status).toBe(200)
      for (const item of res.body.items) expect(item.linked.count).toBe(0)
      expect((await slots()).map((s) => [s.employee_id, s.employee_company_id])).toEqual([[null, null]])
      expect(await countRows('payfit_employees', "employee_id = 'emp-ghost'")).toBe(0)
    })

    it('[rule-evp-link-employee-not-read] after a reading of PayFit, the next reading of Aqoona attaches the collaborator who was PAYFIT_INCOMPLETE before; no identifier is invented for a collaborator without record', async () => {
      const ghost = { companyId: 'co-a', id: 'emp-ghost', firstName: 'Gaëlle', lastName: 'Fantôme' }
      const ghostContract = { companyId: 'co-a', id: 'ct-ghost', employeeId: 'emp-ghost', startDate: '2020-01-01', endDate: null }
      payfitWith({ 'emp-ghost': NIR3 }, { employees: [ghost], contracts: [ghostContract] })
      const rows = [row({ firstName: 'Gaëlle', lastName: 'Fantôme', matricule: NIR3, day: d(-3) })]
      await readAqoona(rows)
      expect((await slots()).map((s) => s.unlinked_cause)).toEqual(['PAYFIT_INCOMPLETE'])
      expect((await readPayfit()).state).toBe('SUCCEEDED')
      await readAqoona(rows)
      expect((await slots()).map(link)).toEqual([['co-a', 'alpha', 'co-a', 'emp-ghost', 'NIR', null]])
      expect((await people()).total).toBe(0)
    })

    it('[rule-evp-link-employee-not-read] [rule-evp-link-nir-two-companies] two live carriers of a NIR, one of them absent from the stored collaborators: the NIR is ambiguous (the count is made on the live table, not on the stored collaborators)', async () => {
      const ghost = { companyId: 'co-a', id: 'emp-ghost', firstName: 'Gaëlle', lastName: 'Fantôme' }
      payfitWith({ 'emp-ghost': NIR1, 'emp-ct-a1': NIR1 }, { employees: [ghost] })
      await readAqoona([row({ firstName: 'Léa', lastName: 'Martin', matricule: NIR1, day: d(-3) })])
      expect((await slots()).map(link)).toEqual([['co-a', 'alpha', null, null, 'AUCUN', 'NIR_AMBIGUOUS']])
    })

    it('[rule-evp-link-person-both-states] the attachment is decided row by row: a person attached by one row and not by another is counted in both states, and the list shows the row without NIR with the crèche of that row', async () => {
      payfitWith({ 'emp-ct-a1': NIR1 })
      await readAqoona([
        row({ matricule: NIR1, crecheName: 'Crèche Alpha', day: d(-3) }),
        row({ matricule: null, crecheName: 'Crèche Beta', day: d(-2) }),
      ])
      expect((await slots()).map(link)).toEqual([
        ['co-a', 'alpha', 'co-a', 'emp-ct-a1', 'NIR', null],
        ['co-b', 'beta', null, null, 'AUCUN', 'NIR_ABSENT'],
      ])
      const list = await people()
      expect(personsOf(list.items).map(([name, cause, creches]) => [sameName(name, 'Léa Martin'), cause, creches])).toEqual([[true, 'NIR_ABSENT', ['Crèche Beta']]])
      expect(summary((await rates()).items)).toEqual([['co-a', 1, 0], ['co-b', 0, 1]])
    })
  })

  // ───────────────────────────── clé de contrôle, des deux côtés ─────────────────────────────
  describe('check key of the NIR on both sides', () => {
    it('[rule-evp-nir-key-invalid-unused] a collaborator of PayFit whose NIR has a wrong key is removed from the table: nobody is attached to her by that value, she is not found by her name, and she does not make ambiguous the right NIR of another collaborator', async () => {
      payfitWith({ 'emp-ct-a1': NIR1, 'emp-ct-a2': BAD1 })
      const run = await readAqoona([
        row({ ...DIFFERENT, matricule: NIR1, day: d(-4) }), // the NIR designates Léa only: BAD1 shares its 13 first digits but is out of the table
        row({ firstName: 'Noé', lastName: 'Petit', matricule: '', day: d(-3) }), // no fallback on the name
        row({ ...DIFFERENT, matricule: BAD1, day: d(-2) }), // the wrong value does not attach, on either side
      ])
      expect(run.state).toBe('SUCCEEDED')
      expect((await slots()).map((s) => [s.employee_id, s.unlinked_cause])).toEqual([['emp-ct-a1', null], [null, 'NIR_ABSENT'], [null, 'NIR_KEY_INVALID']])
      const flagged = await ofType('payfit_nir_key_invalid')
      expect(flagged.map((i: any) => [i.label, sameName(i.subject, 'Noé Petit'), i.detail])).toEqual([[KEY_PAYFIT_LABEL, true, KEY_PAYFIT_DETAIL(SIRET_A)]])
      expect(await ofType('payfit_nir_key_invalid', 'payfit')).toEqual([])
    })

    it('[rule-evp-nir-key-invalid-unused] the same wrong NIR on both sides is not a match: neither side may serve it', async () => {
      payfitWith({ 'emp-ct-a1': BAD1, 'emp-ct-a2': NIR3 })
      await readAqoona([row({ ...DIFFERENT, matricule: BAD1, day: d(-3) }), row({ firstName: 'Noé', lastName: 'Petit', matricule: NIR3, day: d(-2) })])
      expect((await slots()).map((s) => [s.employee_id, s.unlinked_cause])).toEqual([[null, 'NIR_KEY_INVALID'], ['emp-ct-a2', null]])
    })

    it('[rule-evp-nir-key-absent-ok] [rule-evp-aqoona-nir-format] a NIR of 13 characters in PayFit (no key to check) is used on its 13 first characters, with no anomaly', async () => {
      payfitWith({ 'emp-ct-a1': NIR1.slice(0, 13) })
      const run = await readAqoona([row({ ...DIFFERENT, matricule: NIR1, day: d(-3) })])
      expect(run.state).toBe('SUCCEEDED')
      expect((await slots()).map(link)).toEqual([['co-a', 'alpha', 'co-a', 'emp-ct-a1', 'NIR', null]])
      expect(await ofType('payfit_nir_key_invalid')).toEqual([])
      expect(await ofType('aqoona_nir_key_invalid')).toEqual([])
    })

    it('[rule-evp-link-network-read] [rule-evp-nir-key-payfit-anomaly-source] the NIR of every company of the network are read as soon as one row has a NIR of right key: a wrong key of company B is flagged although the row is in a crèche of company A; without any such row nothing is read, nothing is flagged', async () => {
      payfitWith({ 'emp-ct-a1': NIR1, 'emp-ct-b1': BAD4 })
      await readAqoona([row({ firstName: 'Sans', lastName: 'Cle', matricule: BAD3, day: d(-3) }), row({ firstName: 'Sans', lastName: 'Nir', day: d(-2) })])
      expect(await ofType('payfit_nir_key_invalid')).toEqual([])
      await readAqoona([row({ ...DIFFERENT, matricule: NIR1, day: d(-3) })])
      const flagged = await ofType('payfit_nir_key_invalid')
      expect(flagged.map((i: any) => [i.label, sameName(i.subject, 'Zoé Durand'), i.detail])).toEqual([[KEY_PAYFIT_LABEL, true, KEY_PAYFIT_DETAIL(SIRET_B)]])
    })

    it('[rule-evp-nir-key-invalid-unused] the detail of « Clé de NIR Aqoona incorrecte » says that the row is not attached, and no longer that the names are used', async () => {
      payfitWith({ 'emp-ct-a1': NIR1 })
      await readAqoona([row({ matricule: BAD1, day: d(-3) }), row({ matricule: spaced(BAD1), day: d(-2) })])
      const wrong = await ofType('aqoona_nir_key_invalid')
      expect(wrong).toHaveLength(1)
      expect(wrong[0].label).toBe(KEY_AQOONA_LABEL)
      expect(sameName(wrong[0].subject, 'Léa Martin')).toBe(true)
      expect(wrong[0].detail).toMatch(KEY_AQOONA_DETAIL(2))
      expect(wrong[0].detail).not.toMatch(/prénom et le nom/)
    })
  })

  // ───────────────────────────── société nommée, lecture du réseau ─────────────────────────────
  describe('company named in the scope anomalies, whole network read', () => {
    it('[rule-evp-company-named-in-anomalies] [rule-evp-link-network-read] « Rapprochement par NIR indisponible » names the company (name and SIRET), for a missing scope and for an unreadable company, even if no row is in a crèche of that company; the reading is neither FAILED nor PARTIAL', async () => {
      payfitWith({ 'emp-ct-a1': NIR1 }, { scopeMissing: [SIRET_A], unavailable: [SIRET_B] })
      const run = await readAqoona([row({ firstName: 'Una', lastName: 'Inconnue', matricule: NIR4, day: d(-3) })]) // the row is in Alpha only
      expect(run.state).toBe('SUCCEEDED')
      expect((await sourceOf()).state).toBe('UP_TO_DATE')
      const items = await ofType('aqoona_nir_unavailable')
      expect(Object.fromEntries(items.map((i: any) => [i.subject, i.detail]))).toEqual({ [ALPHA]: AQ_SCOPE_DETAIL, [BETA]: AQ_UNAVAILABLE_DETAIL })
      expect(items.every((i: any) => i.label === UNAVAILABLE_LABEL)).toBe(true)
      expect(await ofType('aqoona_nir_unavailable', 'payfit')).toEqual([])
      expect(JSON.stringify(await anomaliesOf())).not.toMatch(/Les noms sont utilisés|à la place du NIR/)
      expect((await slots()).map((s) => s.unlinked_cause)).toEqual(['PAYFIT_INCOMPLETE'])
    })

    it('[rule-evp-aqoona-nir-unavailable] [rule-evp-link-network-read] the network is read only if at least one row has a NIR of right key: without such a row, no company is reported whatever the state of its key', async () => {
      payfitWith({ 'emp-ct-a1': NIR1 }, { scopeMissing: [SIRET_A], unavailable: [SIRET_B] })
      await readAqoona([row({ day: d(-3) }), row({ firstName: 'Noé', lastName: 'Petit', matricule: BAD1, day: d(-2) }), row({ firstName: 'Zoé', lastName: 'Durand', matricule: 'MAT-42', day: d(-1) })])
      expect(await ofType('aqoona_nir_unavailable')).toEqual([])
      expect((await sourceOf()).anomalyCount).toBeGreaterThanOrEqual(3) // the three rows are « Planning non rattaché » and a wrong key: no unavailability among them
      expect((await slots()).map((s) => s.unlinked_cause)).toEqual(['NIR_ABSENT', 'NIR_KEY_INVALID', 'NIR_ABSENT'])
    })

    it('[rule-evp-payfit-scope-every-read] [rule-evp-aqoona-nir-unavailable] the anomaly is replaced at each reading, not accumulated: a scope granted between two readings is seen at the next one and the row is attached; a scope withdrawn is seen as well', async () => {
      const rows = () => [row({ ...DIFFERENT, matricule: NIR1, day: d(-3) })]
      payfitWith({ 'emp-ct-a1': NIR1 }, { scopeMissing: [SIRET_A] })
      await readAqoona(rows())
      await readAqoona(rows())
      expect((await ofType('aqoona_nir_unavailable')).map((i: any) => i.subject)).toEqual([ALPHA])
      expect((await slots()).map((s) => s.unlinked_cause)).toEqual(['PAYFIT_INCOMPLETE'])
      payfitWith({ 'emp-ct-a1': NIR1 })
      await readAqoona(rows())
      expect(await ofType('aqoona_nir_unavailable')).toEqual([])
      expect((await slots()).map((s) => s.employee_id)).toEqual(['emp-ct-a1'])
      payfitWith({ 'emp-ct-a1': NIR1 }, { scopeMissing: [SIRET_A] })
      await readAqoona(rows())
      expect((await ofType('aqoona_nir_unavailable')).map((i: any) => i.detail)).toEqual([AQ_SCOPE_DETAIL])
      expect((await slots()).map((s) => s.employee_id)).toEqual([null])
    })

    it('[rule-evp-link-network-read] a company the fixture knows but PayFit never recorded (absent from payfit_companies) is not reported by name, but makes the NIR not found « lecture incomplète »', async () => {
      payfitWith(
        { 'emp-ct-a1': NIR1 },
        {
          unavailable: [SIRET_C],
          companies: [
            { id: 'co-a', siret: SIRET_A, name: 'Société A' },
            { id: 'co-b', siret: SIRET_B, name: 'Société B' },
            { id: 'co-c', siret: SIRET_C, name: 'Société C' },
          ],
        },
      )
      const run = await readAqoona([row({ firstName: 'Una', lastName: 'Inconnue', matricule: NIR4, day: d(-3) })])
      expect(run.state).toBe('SUCCEEDED')
      expect(await ofType('aqoona_nir_unavailable')).toEqual([])
      expect((await slots()).map((s) => s.unlinked_cause)).toEqual(['PAYFIT_INCOMPLETE'])
    })

    it('[rule-evp-link-network-read] an unreadable network (payfit.json unreadable): every row with a NIR of right key is PAYFIT_INCOMPLETE, no company is reported, the reading stays SUCCEEDED', async () => {
      writeUnreadablePayfit()
      const run = await readAqoona([row({ ...DIFFERENT, matricule: NIR1, day: d(-3) }), row({ firstName: 'Noé', lastName: 'Petit', matricule: BAD1, day: d(-2) }), row({ firstName: 'Zoé', lastName: 'Durand', day: d(-1) })])
      expect(run.state).toBe('SUCCEEDED')
      expect((await sourceOf()).state).toBe('UP_TO_DATE')
      expect((await slots()).map((s) => [s.employee_id, s.unlinked_cause])).toEqual([[null, 'PAYFIT_INCOMPLETE'], [null, 'NIR_KEY_INVALID'], [null, 'NIR_ABSENT']])
      expect(await ofType('aqoona_nir_unavailable')).toEqual([])
    })
  })

  // ───────────────────────────── dédoublonnage ─────────────────────────────
  describe('de-duplication', () => {
    it('[rule-evp-matching-method-first-row] two identical slots keep the state of the first row retained (attached by NIR, or not attached with its cause), whatever the order in which they arrive', async () => {
      payfitWith({ 'emp-ct-a1': NIR1 })
      const run = await readAqoona([
        row({ matricule: NIR1, day: d(-3) }),
        row({ matricule: '', day: d(-3) }),
        row({ matricule: '', day: d(-2) }),
        row({ matricule: NIR1, day: d(-2) }),
      ])
      expect(run.state).toBe('SUCCEEDED')
      expect(volume((await sourceOf()).volumes, 'Plannings lus')).toEqual({ label: 'Plannings lus', count: 2 })
      expect((await slots()).map((s) => [s.day, s.employee_id, s.match_method, s.unlinked_cause])).toEqual([
        [d(-3), 'emp-ct-a1', 'NIR', null],
        [d(-2), null, 'AUCUN', 'NIR_ABSENT'],
      ])
    })

    it('[rule-evp-aqoona-dedupe] [rule-evp-aqoona-multi-siret-same-day] the same hours the same day in two establishments of two SIRET are two slots, each keeps its crèche and its company, and the person is attached to her own reference company', async () => {
      payfitWith({ 'emp-ct-a1': NIR1 })
      await readAqoona([
        row({ matricule: NIR1, crecheName: 'Crèche Alpha', day: d(-2) }),
        row({ matricule: NIR1, crecheName: 'Crèche Beta', day: d(-2) }),
        row({ matricule: NIR1, crecheName: 'Crèche Alpha', day: d(-2) }),
        row({ matricule: NIR1, crecheName: 'Crèche Alpha', day: d(-2), start: '13:00', end: '17:00' }),
      ])
      expect((await slots()).map((s) => [s.start, s.creche_code, s.company_id, s.employee_company_id])).toEqual([
        ['08:00', 'alpha', 'co-a', 'co-a'],
        ['08:00', 'beta', 'co-b', 'co-a'],
        ['13:00', 'alpha', 'co-a', 'co-a'],
      ])
      expect((await anomaliesOf()).total).toBe(0)
    })
  })

  // ───────────────────────────── stockage ─────────────────────────────
  describe('stored columns', () => {
    it('[rule-evp-aqoona-nir-never-stored] the columns employee_company_id, unlinked_cause and creche_label exist (text, nullable); the checks refuse an unknown cause and an employee without company; no column can carry a NIR, a digest or a fragment', async () => {
      const columns = await sql("select column_name, data_type, is_nullable from information_schema.columns where table_schema = 'base' and table_name = 'aqoona_plannings'")
      const byName = Object.fromEntries(columns.map((c) => [c.column_name, c]))
      for (const name of ['employee_company_id', 'unlinked_cause', 'creche_label']) {
        expect({ name, type: byName[name]?.data_type, nullable: byName[name]?.is_nullable }).toEqual({ name, type: 'text', nullable: 'YES' })
      }
      expect(columns.map((c) => c.column_name).join(' ')).not.toMatch(/nir|matricule|social|secu|ssn|hash|digest|fingerprint|key|cle/i)
      const constraints = (await sql("select conname from pg_constraint where conrelid = 'base.aqoona_plannings'::regclass and contype = 'c'")).map((c) => c.conname)
      expect(constraints).toEqual(expect.arrayContaining(['aqoona_plannings_unlinked_cause_check', 'aqoona_plannings_employee_company_check', 'aqoona_plannings_match_method_check']))
      for (const cause of CAUSES) await seedSlot('AUCUN', { personRef: `Cause ${cause}`, unlinkedCause: cause, day: d(-20) })
      await expect(seedSlot('AUCUN', { personRef: 'Cause inconnue', unlinkedCause: 'NIR_FAUSSE' as Cause })).rejects.toThrow()
      await expect(seedSlot('NIR', { personRef: 'Sans société', employeeId: 'emp-ct-a1', employeeCompanyId: null })).rejects.toThrow()
      await expect(seedSlot('AUCUN', { personRef: 'Société seule', employeeId: null, employeeCompanyId: 'co-a' })).rejects.toThrow()
      await seedSlot('NIR', { personRef: 'Rattachée', employeeId: 'emp-ct-a1', employeeCompanyId: 'co-a' })
      await seedSlot('NOM', { personRef: 'Avant la v5', employeeId: 'emp-ct-a1', employeeCompanyId: 'co-a' }) // NOM stays admitted for the rows written before v5
      expect(await countRows('aqoona_plannings', "person_ref in ('Cause inconnue', 'Sans société', 'Société seule')")).toBe(0)
    })

    it('[rule-evp-aqoona-nir-never-stored] after a reading: employee_id and employee_company_id are both set or both null; the mode is only NIR or AUCUN (never NOM, never INCONNU); a cause is written only for a row not attached that has a name or a NIR', async () => {
      payfitWith({ 'emp-ct-a1': NIR1, 'emp-ct-a2': NIR3 })
      const run = await readAqoona([
        row({ matricule: NIR1, day: d(-8) }),
        row({ firstName: 'Noé', lastName: 'Petit', day: d(-7) }),
        row({ firstName: 'Kim', lastName: 'Fausse', matricule: BAD1, day: d(-6) }),
        row({ firstName: 'Una', lastName: 'Inconnue', matricule: NIR4, day: d(-5) }),
        row({ firstName: '', lastName: '', matricule: null, day: d(-4) }),
        row({ firstName: '', lastName: '', matricule: NIR3, day: d(-3) }),
      ])
      expect(run.state).toBe('SUCCEEDED')
      const stored = await slots()
      expect(stored).toHaveLength(6)
      for (const s of stored) {
        expect({ day: s.day, both: (s.employee_id === null) === (s.employee_company_id === null) }).toEqual({ day: s.day, both: true })
        expect(['NIR', 'AUCUN']).toContain(s.match_method)
        expect({ day: s.day, nir: s.match_method === 'NIR' }).toEqual({ day: s.day, nir: s.employee_id !== null })
      }
      expect(stored.map((s) => s.unlinked_cause)).toEqual([null, 'NIR_ABSENT', 'NIR_KEY_INVALID', 'NIR_UNKNOWN', null, null])
      expectNoNir('aqoona_plannings', JSON.stringify(stored), V4_NIRS)
      expect(await sql("select 1 from base.aqoona_plannings where match_method in ('NOM', 'INCONNU')")).toEqual([])
      expect(await sql('select 1 from base.aqoona_mismatches where reason ~ $1', ['\\d{9,}'])).toEqual([])
    })

    it('[rule-evp-aqoona-nir-never-stored] aqoona_mismatches holds one line per slot not attached with the label of the cause, never a NIR', async () => {
      payfitWith({ 'emp-ct-a1': NIR1 })
      await readAqoona([row({ matricule: NIR1, day: d(-5) }), row({ firstName: 'Kim', lastName: 'Fausse', matricule: BAD1, day: d(-4) }), row({ firstName: 'Una', lastName: 'Inconnue', matricule: NIR4, day: d(-3) })])
      const texts = JSON.stringify(await sql('select m::text as t from base.aqoona_mismatches m'))
      expect(texts).toContain(CAUSE_LABELS.NIR_KEY_INVALID)
      expect(texts).toContain(CAUSE_LABELS.NIR_UNKNOWN)
      expectNoNir('aqoona_mismatches', texts, V4_NIRS)
    })
  })

  // ───────────────────────────── confidentialité ─────────────────────────────
  describe('no NIR is ever shown', () => {
    it('[rule-evp-unlinked-list-no-nir] [rule-evp-nir-key-never-shown] [rule-evp-aqoona-nir-transient-key] no NIR (nor its spaced form, nor its 13 first digits) appears in any answer, anomaly, run, volume, export, audit entry, notification, table, rates, list or in the server log — attached and not attached rows of every cause', async () => {
      const offset = logSize()
      payfitWith({ 'emp-ct-a1': NIR1, 'emp-ct-a2': NIR3, 'emp-ct-b1': NIR3, 'emp-ct-b2': BAD4 }, {
        employees: [{ companyId: 'co-b', id: 'emp-ct-b2', firstName: 'Bea', lastName: 'Bis' }],
      })
      expect((await readPayfit()).state).toBe('SUCCEEDED')
      const run = await readAqoona([
        row({ matricule: spaced(NIR1), day: d(-7) }), // attached
        row({ firstName: 'Noé', lastName: 'Petit', matricule: NIR3, day: d(-6) }), // ambiguous (two companies)
        row({ firstName: 'Kim', lastName: 'Fausse', matricule: spaced(BAD1), day: d(-5) }), // wrong key
        row({ firstName: 'Una', lastName: 'Inconnue', matricule: NIR4, day: d(-4) }), // unknown
        row({ firstName: 'Abel', lastName: 'Absent', matricule: DIGITS14, day: d(-3) }), // ill-formed
        row({ firstName: '', lastName: '', matricule: NIR_OK, day: d(-2) }), // nameless
        row({ firstName: 'Léa', lastName: 'Martin', matricule: NIR_KO, crecheName: 'Établissement Inconnu', day: d(-1) }),
      ])
      expect(run.state).toBe('SUCCEEDED')
      const all = await everythingV5(w.rh.token)
      expectNoNir('visible', all, [...V4_NIRS, NIR_2A])
      expectNoNir('run', JSON.stringify(run), V4_NIRS)
      expectNoNir('server log', logSince(offset), V4_NIRS)
      const list = await people({ size: 50 })
      expect(list.total).toBeGreaterThanOrEqual(5)
      expectNoLongDigits('list', JSON.stringify(list))
      const anomalies = [...(await anomaliesOf('aqoona')).items, ...(await anomaliesOf('payfit')).items]
      expectNoLongDigits('anomalies', JSON.stringify(anomalies.map((i: any) => [i.type, i.label, i.subject, i.detail])), [SIRET_A, SIRET_B])
    })
  })
})
