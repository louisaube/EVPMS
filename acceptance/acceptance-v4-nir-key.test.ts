import { resetData, closePool, sql } from './harness'
import { logSince, logSize } from './renfort-helpers'
import { GET, seedWorld, World, closeEvp, refresh, writeFixture, clearFixtures, payfitFixture, PayfitFixture, SIRET_A, SIRET_B } from './evp-helpers'
import { d } from './v2-helpers'
import { plannings } from './v3-helpers'
import {
  BAD1, BAD1_00, BAD3, BAD4, NIR1, NIR2, NIR3, NIR_2A_KO, NIR_2A_OK, NIR_2B_OK, NIR_97, NIR_KO, NIR_OK, V4_NIRS, everythingV4, expectNoLongDigits, spaced, storedModes,
} from './v4-helpers'
import { expectNoNir } from './v3-helpers'
import {
  ALPHA, AQ_SCOPE_DETAIL, AQ_UNAVAILABLE_DETAIL, BETA, KEY_AQOONA_DETAIL, KEY_AQOONA_LABEL, KEY_PAYFIT_DETAIL, KEY_PAYFIT_LABEL, UNAVAILABLE_LABEL, link, sameName, slots, unmatchedDetail,
} from './v5-helpers'

// v5-evp-rattachement-nir: the names are no longer a fallback, the texts and the subjects of the anomalies changed accordingly
// (the company is named by its name and SIRET; the row with a wrong key is « not attached »).
const SCOPE_DETAIL = AQ_SCOPE_DETAIL
const SHORT_DETAIL = AQ_UNAVAILABLE_DETAIL
const UNAVAILABLE = UNAVAILABLE_LABEL
const KEY_AQOONA = KEY_AQOONA_LABEL
const KEY_PAYFIT = KEY_PAYFIT_LABEL
const AQOONA_DETAIL = KEY_AQOONA_DETAIL
const PAYFIT_DETAIL = KEY_PAYFIT_DETAIL

// Acceptance suite of version v4-evp-fiabilite-nir, part 2: the check key of the NIR on both sides, the anomalies it produces,
// the scope of the PayFit key (fake driver: list `nirScopeMissing` of payfit.json, distinct from `nirUnavailable`) and the stored
// mode of attachment. Default API variant (fake sources). The real-driver side of the scope (introspection) is in
// acceptance-v4-sources-payfit-scope.
describe('NIR check key, PayFit scope and stored mode (v4-evp-fiabilite-nir)', () => {
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
  const DIFFERENT = { firstName: 'Prénom', lastName: 'Différent' }

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
  const anomaliesOf = async (key: 'aqoona' | 'payfit') => {
    const res = await GET(`/sources/${key}/anomalies?size=50`, w.rh.token)
    expect(res.status).toBe(200)
    return res.body
  }
  const ofType = async (type: string, key: 'aqoona' | 'payfit' = 'aqoona') => (await anomaliesOf(key)).items.filter((i: any) => i.type === type)
  const employees = async () => (await plannings()).map((r) => r.employee_id)
  const modes = async () => (await storedModes()).map((r) => r.match_method)
  const normalise = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

  // ───────────────────────────── clé de contrôle, côté Aqoona ─────────────────────────────
  describe('check key on the Aqoona side', () => {
    it('[rule-evp-nir-key-formula] [rule-evp-nir-key-vectors] [rule-evp-nir-key-invalid-unused] the vectors of the request: 46 is right and 47 is wrong, 2A counts 19 and 2B counts 18, the key of 2B does not fit 2A; a wrong key never serves to match', async () => {
      payfitWithNirs({ 'emp-ct-a1': NIR_OK, 'emp-ct-a2': NIR_2A_OK, 'emp-ct-b1': NIR_2B_OK })
      const run = await readAqoona([
        row({ ...DIFFERENT, matricule: spaced(NIR_OK), day: d(-6) }),
        row({ ...DIFFERENT, matricule: NIR_KO, day: d(-5) }),
        row({ ...DIFFERENT, matricule: '1 85 03 2A 004 012 38', day: d(-4) }),
        row({ ...DIFFERENT, matricule: NIR_2A_KO, day: d(-3) }),
        row({ ...DIFFERENT, matricule: NIR_2B_OK, crecheName: 'Crèche Beta', day: d(-2) }),
      ])
      expect(run.state).toBe('SUCCEEDED')
      expect(await employees()).toEqual(['emp-ct-a1', null, 'emp-ct-a2', null, 'emp-ct-b1'])
      expect(volume((await aqoonaSource()).volumes, 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count: 3 })
      expect(await modes()).toEqual(['NIR', 'AUCUN', 'NIR', 'AUCUN', 'NIR'])
      const wrong = await ofType('aqoona_nir_key_invalid')
      expect(wrong).toHaveLength(1)
      expect(wrong[0]).toMatchObject({ label: KEY_AQOONA, subject: 'Prénom Différent' })
      expect(wrong[0].detail).toMatch(AQOONA_DETAIL(2))
    })

    it('[rule-evp-nir-key-formula] the remainder 0 gives the key 97 (right), the key 00 is always wrong', async () => {
      payfitWithNirs({ 'emp-ct-a1': NIR_97, 'emp-ct-a2': NIR1 })
      const run = await readAqoona([
        row({ ...DIFFERENT, matricule: NIR_97, day: d(-3) }),
        row({ ...DIFFERENT, matricule: BAD1_00, day: d(-2) }),
        row({ firstName: 'Noé', lastName: 'Petit', matricule: BAD1_00, day: d(-1) }),
      ])
      expect(run.state).toBe('SUCCEEDED')
      // v5: Noé's row has a wrong key too, and no fallback by names exists any more
      expect(await employees()).toEqual(['emp-ct-a1', null, null])
      expect(await modes()).toEqual(['NIR', 'AUCUN', 'AUCUN'])
      expect(volume((await aqoonaSource()).volumes, 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count: 1 })
      const wrong = await ofType('aqoona_nir_key_invalid')
      expect(wrong.map((i: any) => i.subject).sort()).toEqual(['Noé Petit', 'Prénom Différent'])
    })

    it('[rule-evp-nir-key-invalid-unused] [rule-evp-link-unusable-nir] a row with a wrong key is not attached, even to the collaborator whose names it carries: no fallback by names, the cause is the wrong key', async () => {
      payfitWithNirs({ 'emp-ct-a1': NIR1 })
      const run = await readAqoona([row({ matricule: BAD1, day: d(-3) }), row({ matricule: spaced(BAD1), day: d(-2) })])
      expect(run.state).toBe('SUCCEEDED')
      expect(await employees()).toEqual([null, null])
      expect(await modes()).toEqual(['AUCUN', 'AUCUN'])
      expect((await slots()).map(link)).toEqual([
        ['co-a', 'alpha', null, null, 'AUCUN', 'NIR_KEY_INVALID'],
        ['co-a', 'alpha', null, null, 'AUCUN', 'NIR_KEY_INVALID'],
      ])
      const source = await aqoonaSource()
      expect(volume(source.volumes, 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count: 0 })
      expect(volume(source.volumes, 'Plannings rattachés')).toEqual({ label: 'Plannings rattachés', count: 0 })
      expect((await ofType('aqoona_nir_key_invalid'))[0].detail).toMatch(AQOONA_DETAIL(2))
    })

    it('[rule-evp-nir-key-invalid-unused] the same wrong NIR on both sides is not a match: neither side may serve it', async () => {
      payfitWithNirs({ 'emp-ct-a1': BAD1, 'emp-ct-a2': NIR3 })
      const run = await readAqoona([row({ ...DIFFERENT, matricule: BAD1, day: d(-3) }), row({ firstName: 'Noé', lastName: 'Petit', matricule: NIR3, day: d(-2) })])
      expect(run.state).toBe('SUCCEEDED')
      expect(await employees()).toEqual([null, 'emp-ct-a2'])
      expect(await modes()).toEqual(['AUCUN', 'NIR'])
      expect(volume((await aqoonaSource()).volumes, 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count: 1 })
    })

    it('[rule-evp-nir-key-invalid-unused] [rule-evp-aqoona-nir-lazy] a row with a wrong key does not by itself cause the NIR of its company to be read: no unavailability is reported for a company that only has such rows, and it is reported as soon as one row has a right key', async () => {
      payfitWithNirs({ 'emp-ct-a1': NIR1 }, { nirUnavailable: [SIRET_A], nirScopeMissing: [SIRET_B] })
      expect((await readAqoona([row({ matricule: BAD1, day: d(-3) }), row({ firstName: 'Zoé', lastName: 'Durand', crecheName: 'Crèche Beta', matricule: NIR_KO, day: d(-3) })])).state).toBe('SUCCEEDED')
      expect(await ofType('aqoona_nir_unavailable')).toEqual([])
      expect(await ofType('aqoona_nir_key_invalid')).toHaveLength(2)
      expect((await readAqoona([row({ matricule: BAD1, day: d(-3) }), row({ firstName: 'Noé', lastName: 'Petit', matricule: NIR3, day: d(-2) })])).state).toBe('SUCCEEDED')
      // v5: the whole network is read as soon as one row has a right key, the two unreadable companies are reported
      expect((await ofType('aqoona_nir_unavailable')).map((i: any) => i.subject).sort()).toEqual([ALPHA, BETA].sort())
    })

    it('[rule-evp-nir-key-anomaly-grain] [rule-evp-nir-key-no-failure] one anomaly per distinct person, not per slot, crèche or company; the number of de-duplicated slots is in the detail; the reading is neither PARTIAL nor FAILED and every slot is stored', async () => {
      payfitWithNirs({})
      const run = await readAqoona([
        row({ matricule: BAD1, day: d(-3) }),
        row({ matricule: BAD1, day: d(-3) }), // identical row: one slot
        row({ matricule: spaced(BAD1), day: d(-2) }),
        row({ matricule: BAD3, day: d(-1) }),
        row({ matricule: BAD1, crecheName: 'Crèche Beta', day: d(-3) }), // other establishment, other company
        row({ firstName: 'LEA', lastName: ' martin ', matricule: BAD1, day: d(-4) }), // same person written differently
        row({ firstName: 'Noé', lastName: 'Petit', matricule: BAD4, day: d(-3) }),
      ])
      expect(run.state).toBe('SUCCEEDED')
      expect((await aqoonaSource()).state).toBe('UP_TO_DATE')
      expect(await storedModes()).toHaveLength(6)
      const wrong = await ofType('aqoona_nir_key_invalid')
      expect(wrong).toHaveLength(2)
      const lea = wrong.find((i: any) => normalise(i.subject) === 'lea martin')
      const noe = wrong.find((i: any) => i.subject === 'Noé Petit')
      expect(lea.label).toBe(KEY_AQOONA)
      expect(lea.detail).toMatch(AQOONA_DETAIL(5))
      expect(noe.detail).toMatch(AQOONA_DETAIL(1))
    })

    it('[rule-evp-nir-key-anomaly-without-company][D-0017] a row with a wrong key whose establishment is unknown of the referential: the anomaly « Clé de NIR Aqoona incorrecte » names the person, in addition to « Planning non rattaché »', async () => {
      payfitWithNirs({})
      const run = await readAqoona([row({ matricule: BAD1, crecheName: 'Établissement Inconnu', day: d(-3) })])
      expect(run.state).toBe('SUCCEEDED')
      const res = await GET('/sources/aqoona/anomalies?size=50', w.rh.token)
      expect(res.status).toBe(200)
      const wrong = res.body.items.filter((i: any) => i.type === 'aqoona_nir_key_invalid')
      const unmatched = res.body.items.filter((i: any) => i.type === 'PLANNING_UNMATCHED')
      expect(wrong).toHaveLength(1)
      expect(wrong[0]).toMatchObject({ label: KEY_AQOONA })
      expect(sameName(wrong[0].subject, 'Léa Martin')).toBe(true)
      expect(wrong[0].detail).toMatch(AQOONA_DETAIL(1))
      expect(unmatched).toHaveLength(1)
      expect(unmatched[0]).toMatchObject({ label: 'Planning non rattaché' })
      expect(sameName(unmatched[0].subject, 'Léa Martin')).toBe(true)
      expect(await modes()).toEqual(['AUCUN'])
    })
  })

  // ───────────────────────────── clé de contrôle, côté PayFit ─────────────────────────────
  describe('check key on the PayFit side', () => {
    it('[rule-evp-nir-key-payfit-anomaly-source][D-0018] a collaborator of Alpha carries a NIR with a wrong key in PayFit, another employee has a right NIR in an Aqoona row; PayFit then Aqoona are read: « Clé de NIR PayFit incorrecte » is in the anomalies of Aqoona, never in those of PayFit', async () => {
      payfitWithNirs({ 'emp-ct-a1': BAD1, 'emp-ct-a2': NIR3 })
      expect((await refresh(w.rh.token, 'payfit')).state).toBe('SUCCEEDED')
      expect(await ofType('payfit_nir_key_invalid', 'aqoona')).toEqual([])
      const run = await readAqoona([row({ firstName: 'Noé', lastName: 'Petit', matricule: NIR3, day: d(-3) })])
      expect(run.state).toBe('SUCCEEDED')
      const aqoona = await GET('/sources/aqoona/anomalies?size=50', w.rh.token)
      expect(aqoona.status).toBe(200)
      const flagged = aqoona.body.items.filter((i: any) => i.type === 'payfit_nir_key_invalid')
      expect(flagged).toHaveLength(1)
      expect(flagged[0]).toMatchObject({ label: KEY_PAYFIT, subject: 'Léa Martin', detail: PAYFIT_DETAIL(SIRET_A) })
      const payfit = await GET('/sources/payfit/anomalies?size=50', w.rh.token)
      expect(payfit.status).toBe(200)
      expect(payfit.body.items.filter((i: any) => i.type === 'payfit_nir_key_invalid' || i.label === KEY_PAYFIT)).toEqual([])
      expect((await aqoonaSource()).state).toBe('UP_TO_DATE')
    })

    it('[rule-evp-nir-key-payfit-anomaly-source] the reading of PayFit alone reads no NIR: no anomaly of key is produced by it, whatever the NIR of its collaborators; the companies whose NIR are read by Aqoona are checked, and since v5 that is the whole network', async () => {
      payfitWithNirs({ 'emp-ct-a1': BAD1, 'emp-ct-b1': BAD4 })
      expect((await refresh(w.rh.token, 'payfit')).state).toBe('SUCCEEDED')
      const nirTypes = ['payfit_nir_key_invalid', 'aqoona_nir_key_invalid', 'aqoona_nir_unavailable']
      for (const key of ['payfit', 'aqoona'] as const) expect((await anomaliesOf(key)).items.filter((i: any) => nirTypes.includes(i.type))).toEqual([])
      // v5: a row of Alpha with a right key makes Aqoona read the NIR of every company, so both companies are checked
      expect((await readAqoona([row({ firstName: 'Noé', lastName: 'Petit', matricule: NIR3, day: d(-3) })])).state).toBe('SUCCEEDED')
      const flagged = await ofType('payfit_nir_key_invalid')
      expect(flagged.map((i: any) => i.subject).sort()).toEqual(['Léa Martin', 'Zoé Durand'])
    })

    it('[rule-evp-nir-key-invalid-unused] [rule-evp-link-nir-only] the collaborator with a wrong key can no longer be found by her names; she makes ambiguous no right NIR carried by another collaborator of the company', async () => {
      payfitWithNirs({ 'emp-ct-a1': NIR1, 'emp-ct-a2': BAD1 })
      const run = await readAqoona([
        row({ firstName: 'Prénom', lastName: 'Autre', matricule: NIR1, day: d(-3) }), // the NIR designates Léa only
        row({ firstName: 'Noé', lastName: 'Petit', matricule: '', day: d(-2) }), // Noé is not attached: no NIR, and the names do not count
      ])
      expect(run.state).toBe('SUCCEEDED')
      expect(await employees()).toEqual(['emp-ct-a1', null])
      expect(await modes()).toEqual(['NIR', 'AUCUN'])
      const unmatched = await ofType('PLANNING_UNMATCHED')
      expect(unmatched).toHaveLength(1)
      expect(sameName(unmatched[0].subject, 'Noé Petit')).toBe(true)
      const flagged = await ofType('payfit_nir_key_invalid')
      expect(flagged).toHaveLength(1)
      expect(flagged[0]).toMatchObject({ subject: 'Noé Petit', detail: PAYFIT_DETAIL(SIRET_A) })
    })

    it('[rule-evp-nir-key-invalid-unused] a collaborator whose NIR is wrong is not designated by that NIR even when an Aqoona row carries exactly her value: nobody is attached by NIR', async () => {
      payfitWithNirs({ 'emp-ct-a1': NIR1, 'emp-ct-a2': BAD3 })
      const run = await readAqoona([row({ firstName: 'Prénom', lastName: 'Autre', matricule: BAD3, day: d(-3) }), row({ matricule: NIR1, day: d(-2) })])
      expect(run.state).toBe('SUCCEEDED')
      expect(await employees()).toEqual([null, 'emp-ct-a1'])
      expect(await modes()).toEqual(['AUCUN', 'NIR'])
    })

    it('[rule-evp-nir-key-absent-ok] [rule-evp-aqoona-nir-format] a NIR of 13 characters in PayFit (no key to check) is still used, on its 13 first characters, and produces no anomaly', async () => {
      payfitWithNirs({ 'emp-ct-a1': NIR1.slice(0, 13) })
      const run = await readAqoona([row({ ...DIFFERENT, matricule: NIR1, day: d(-3) })])
      expect(run.state).toBe('SUCCEEDED')
      expect(await employees()).toEqual(['emp-ct-a1'])
      expect(await modes()).toEqual(['NIR'])
      expect(await ofType('payfit_nir_key_invalid')).toEqual([])
      expect(await ofType('aqoona_nir_key_invalid')).toEqual([])
      expect(volume((await aqoonaSource()).volumes, 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count: 1 })
    })

    it('[rule-evp-nir-key-payfit-anomaly-source] a collaborator unknown of payfit_employees with a wrong NIR is named « Collaboratrice <identifiant PayFit> »', async () => {
      const fixture: any = payfitFixture([])
      fixture.employees = [
        ...fixture.employees.map((e: any) => (e.id === 'emp-ct-a2' ? { ...e, nir: NIR3 } : e)),
        { companyId: 'co-a', id: 'emp-ghost', firstName: 'Gaëlle', lastName: 'Fantôme', nir: BAD4 },
      ]
      writeFixture('payfit', fixture)
      expect((await readAqoona([row({ firstName: 'Noé', lastName: 'Petit', matricule: NIR3, day: d(-3) })])).state).toBe('SUCCEEDED')
      const flagged = await ofType('payfit_nir_key_invalid')
      expect(flagged).toHaveLength(1)
      expect(flagged[0]).toMatchObject({ label: KEY_PAYFIT, subject: 'Collaboratrice emp-ghost', detail: PAYFIT_DETAIL(SIRET_A) })
    })

    it('[rule-evp-nir-key-anomaly-grain] [rule-evp-nir-key-no-failure] two collaborators with a wrong key give two anomalies, one each, without making the reading PARTIAL or FAILED', async () => {
      payfitWithNirs({ 'emp-ct-a1': BAD1, 'emp-ct-a2': BAD3, 'emp-ct-b1': NIR2 })
      const run = await readAqoona([
        row({ firstName: 'Prénom', lastName: 'Autre', matricule: NIR1, day: d(-3) }),
        row({ firstName: 'Zoé', lastName: 'Durand', crecheName: 'Crèche Beta', matricule: NIR2, day: d(-3) }),
      ])
      expect(run.state).toBe('SUCCEEDED')
      expect((await aqoonaSource()).state).toBe('UP_TO_DATE')
      expect((await ofType('payfit_nir_key_invalid')).map((i: any) => i.subject).sort()).toEqual(['Léa Martin', 'Noé Petit'])
    })
  })

  // ───────────────────────────── portée PayFit (pilote fake) ─────────────────────────────
  describe('PayFit scope (fake driver: nirScopeMissing)', () => {
    it('[rule-evp-payfit-scope-missing-fallback] [rule-evp-payfit-scope-detail] [rule-evp-payfit-scope-checked] [rule-evp-company-named-in-anomalies] a company whose key lacks the scope: its NIR are not used (they may be in the answer) and, with no fallback by names, the rows that could be its own are not attached; the anomaly names the company (name and SIRET) and the scope; the reading is neither FAILED nor PARTIAL', async () => {
      payfitWithNirs({ 'emp-ct-a1': NIR1, 'emp-ct-b1': NIR2 }, { nirScopeMissing: [SIRET_A] })
      const run = await readAqoona([
        row({ ...DIFFERENT, matricule: NIR1, day: d(-3) }),
        row({ matricule: NIR1, day: d(-2) }),
        row({ firstName: 'Prénom', lastName: 'Autre', matricule: NIR2, crecheName: 'Crèche Beta', day: d(-3) }),
      ])
      expect(run.state).toBe('SUCCEEDED')
      expect((await aqoonaSource()).state).toBe('UP_TO_DATE')
      // by day, then crèche: Alpha (day -3, NIR not usable), Beta (day -3, by NIR, company B is readable), Alpha (day -2, NIR not usable)
      expect(await employees()).toEqual([null, 'emp-ct-b1', null])
      expect(await modes()).toEqual(['AUCUN', 'NIR', 'AUCUN'])
      expect((await slots()).map((s) => s.unlinked_cause)).toEqual(['PAYFIT_INCOMPLETE', null, 'PAYFIT_INCOMPLETE'])
      const missing = await ofType('aqoona_nir_unavailable')
      expect(missing).toHaveLength(1)
      expect(missing[0]).toMatchObject({ label: UNAVAILABLE, subject: ALPHA, detail: SCOPE_DETAIL })
      expect(volume((await aqoonaSource()).volumes, 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count: 1 })
      expect(await ofType('aqoona_nir_unavailable', 'payfit')).toEqual([])
    })

    it('[rule-evp-payfit-scope-detail] the detail names the scope only when the cause is the scope: an unreadable company keeps the short sentence', async () => {
      payfitWithNirs({ 'emp-ct-a1': NIR1, 'emp-ct-b1': NIR2 }, { nirScopeMissing: [SIRET_A], nirUnavailable: [SIRET_B] })
      const run = await readAqoona([row({ matricule: NIR1, day: d(-3) }), row({ firstName: 'Zoé', lastName: 'Durand', crecheName: 'Crèche Beta', matricule: NIR2, day: d(-3) })])
      expect(run.state).toBe('SUCCEEDED')
      expect((await aqoonaSource()).state).toBe('UP_TO_DATE')
      const items = await ofType('aqoona_nir_unavailable')
      expect(Object.fromEntries(items.map((i: any) => [i.subject, i.detail]))).toEqual({ [ALPHA]: SCOPE_DETAIL, [BETA]: SHORT_DETAIL })
      expect(items.every((i: any) => i.label === UNAVAILABLE)).toBe(true)
      // both companies are unreadable: no NIR can be found, nobody is attached
      expect(await employees()).toEqual([null, null])
    })

    it('[rule-evp-payfit-scope-fresh] [rule-evp-payfit-scope-missing-fallback] the scope is looked at on every reading: the anomaly is replaced, not accumulated; a scope granted between two readings is seen at the next one and the matching goes back to the NIR; a scope withdrawn is seen as well', async () => {
      const rows = () => [row({ ...DIFFERENT, matricule: NIR1, day: d(-3) })]
      payfitWithNirs({ 'emp-ct-a1': NIR1 }, { nirScopeMissing: [SIRET_A] })
      await readAqoona(rows())
      await readAqoona(rows())
      expect(await ofType('aqoona_nir_unavailable')).toHaveLength(1)
      expect(await employees()).toEqual([null])
      payfitWithNirs({ 'emp-ct-a1': NIR1 })
      expect((await readAqoona(rows())).state).toBe('SUCCEEDED')
      expect(await ofType('aqoona_nir_unavailable')).toEqual([])
      expect(await employees()).toEqual(['emp-ct-a1'])
      expect(await modes()).toEqual(['NIR'])
      payfitWithNirs({ 'emp-ct-a1': NIR1 }, { nirScopeMissing: [SIRET_A] })
      await readAqoona(rows())
      expect((await ofType('aqoona_nir_unavailable')).map((i: any) => i.detail)).toEqual([SCOPE_DETAIL])
      expect(await employees()).toEqual([null])
    })

    // v5 supersedes D-0019 (« only the companies that have a row with a NIR are reported »): the NIR is searched across the whole
    // network, so one row with a right key anywhere makes every unreadable company reported.
    it('[rule-evp-payfit-scope-coverage] [rule-evp-link-network-read] Alpha lacks the scope and no Aqoona row of its crèches carries a NIR, but a row of Beta has a right key: the whole network is read, so « Rapprochement par NIR indisponible » names Alpha', async () => {
      payfitWithNirs({ 'emp-ct-b1': NIR2 }, { nirScopeMissing: [SIRET_A] })
      const run = await readAqoona([
        row({ matricule: null, day: d(-3) }),
        row({ firstName: 'Noé', lastName: 'Petit', matricule: 'MAT-42', day: d(-2) }),
        row({ firstName: 'Prénom', lastName: 'Autre', matricule: NIR2, crecheName: 'Crèche Beta', day: d(-3) }),
      ])
      expect(run.state).toBe('SUCCEEDED')
      const res = await GET('/sources/aqoona/anomalies?size=50', w.rh.token)
      expect(res.status).toBe(200)
      expect(res.body.items.filter((i: any) => i.type === 'aqoona_nir_unavailable').map((i: any) => [i.label, i.subject])).toEqual([[UNAVAILABLE, ALPHA]])
      // by day, then crèche: Alpha (day -3, no NIR), Beta (day -3, NIR), Alpha (day -2, not a NIR)
      expect(await employees()).toEqual([null, 'emp-ct-b1', null])
      expect(await modes()).toEqual(['AUCUN', 'NIR', 'AUCUN'])
    })

    it('[rule-evp-payfit-scope-every-read] [rule-evp-link-network-read] [rule-evp-link-unusable-nir] without any row with a NIR of right key the network is not read, so no company is reported whatever the state of its key (« Rapprochement par NIR indisponible » is never produced); the two named rows without NIR are two anomalies « Planning non rattaché » (cause NIR_ABSENT), nothing else', async () => {
      payfitWithNirs({ 'emp-ct-a1': NIR1, 'emp-ct-b1': NIR2 }, { nirScopeMissing: [SIRET_A], nirUnavailable: [SIRET_B] })
      expect((await readAqoona([row({ day: d(-3) }), row({ firstName: 'Zoé', lastName: 'Durand', crecheName: 'Crèche Beta', day: d(-3) })])).state).toBe('SUCCEEDED')
      expect(await ofType('aqoona_nir_unavailable')).toEqual([])
      // v5: with no NIR, the rows are not attached by their names (rule-evp-link-nir-only): one « Planning non rattaché » each
      expect((await ofType('PLANNING_UNMATCHED')).map((i: any) => i.detail).sort()).toEqual([unmatchedDetail('NIR_ABSENT', 'Crèche Alpha'), unmatchedDetail('NIR_ABSENT', 'Crèche Beta')].sort())
      expect((await aqoonaSource()).anomalyCount).toBe(2)
      expect(await modes()).toEqual(['AUCUN', 'AUCUN'])
    })

    it('[rule-evp-payfit-scope-missing-fallback] [rule-evp-aqoona-nir-unavailable] the volumes of the reading stay those of a normal reading and the PayFit reading is untouched by the missing scope', async () => {
      payfitWithNirs({ 'emp-ct-a1': NIR1 }, { nirScopeMissing: [SIRET_A, SIRET_B] })
      expect((await refresh(w.rh.token, 'payfit')).state).toBe('SUCCEEDED')
      expect((await GET('/sources', w.rh.token)).body.items.find((i: any) => i.key === 'payfit').state).toBe('UP_TO_DATE')
      const run = await readAqoona([row({ matricule: NIR1, day: d(-3) }), row({ firstName: 'Noé', lastName: 'Petit', day: d(-3) })])
      expect(run.state).toBe('SUCCEEDED')
      const source = await aqoonaSource()
      expect(source.volumes.map((v: any) => v.label)).toEqual(['Plannings lus', 'Plannings rattachés', 'Rapprochés par NIR'])
      expect(volume(source.volumes, 'Plannings lus')).toEqual({ label: 'Plannings lus', count: 2 })
      // v5: nothing is attached (the NIR of Alpha cannot be read, the other row has none)
      expect(volume(source.volumes, 'Plannings rattachés')).toEqual({ label: 'Plannings rattachés', count: 0 })
      expect(volume(source.volumes, 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count: 0 })
    })
  })

  // ───────────────────────────── mode de rattachement stocké ─────────────────────────────
  describe('stored mode of attachment', () => {
    it('[rule-evp-aqoona-nir-never-stored] [rule-evp-link-causes] a reading writes NIR or AUCUN on every slot, never NOM nor INCONNU: by NIR, then no NIR, unknown person, ambiguous NIR, unknown establishment, wrong key, value that is no NIR', async () => {
      payfitWithNirs({ 'emp-ct-a1': NIR1, 'emp-ct-a2': NIR1, 'emp-ct-b1': NIR2 })
      const run = await readAqoona([
        row({ firstName: 'Prénom', lastName: 'Autre', crecheName: 'Crèche Beta', matricule: NIR2, day: d(-10) }),
        row({ firstName: 'Noé', lastName: 'Petit', day: d(-9) }),
        row({ firstName: 'Inconnue', lastName: 'Total', day: d(-8) }),
        row({ firstName: 'Léa', lastName: 'Martin', matricule: NIR1, day: d(-7) }),
        row({ firstName: 'Léa', lastName: 'Martin', crecheName: 'Établissement Inconnu', day: d(-6) }),
        row({ firstName: 'Noé', lastName: 'Petit', matricule: BAD3, day: d(-5) }),
        row({ firstName: 'Noé', lastName: 'Petit', matricule: 'MAT-123', day: d(-4) }),
      ])
      expect(run.state).toBe('SUCCEEDED')
      expect(await modes()).toEqual(['NIR', 'AUCUN', 'AUCUN', 'AUCUN', 'AUCUN', 'AUCUN', 'AUCUN'])
      expect((await storedModes()).map((r) => r.employee_id)).toEqual(['emp-ct-b1', null, null, null, null, null, null])
    })

    it('[rule-evp-matching-method-first-row] two identical slots keep the mode of the first row retained, whatever the order in which they arrive', async () => {
      payfitWithNirs({ 'emp-ct-a1': NIR1 })
      const run = await readAqoona([
        row({ matricule: NIR1, day: d(-3) }),
        row({ matricule: '', day: d(-3) }),
        row({ matricule: '', day: d(-2) }),
        row({ matricule: NIR1, day: d(-2) }),
      ])
      expect(run.state).toBe('SUCCEEDED')
      expect(volume((await aqoonaSource()).volumes, 'Plannings lus')).toEqual({ label: 'Plannings lus', count: 2 })
      expect((await storedModes()).map((r) => [r.day, r.match_method])).toEqual([[d(-3), 'NIR'], [d(-2), 'AUCUN']])
    })

    it('[rule-evp-aqoona-nir-never-stored] every reading replaces the modes of the previous one', async () => {
      payfitWithNirs({ 'emp-ct-a1': NIR1 })
      await readAqoona([row({ matricule: NIR1, day: d(-3) })])
      expect(await modes()).toEqual(['NIR'])
      payfitWithNirs({})
      await readAqoona([row({ matricule: NIR1, day: d(-3) })])
      expect(await modes()).toEqual(['AUCUN'])
    })
  })

  // ───────────────────────────── la valeur d'un NIR n'apparaît jamais ─────────────────────────────
  describe('no NIR is ever shown', () => {
    it('[rule-evp-nir-key-never-shown] [rule-evp-aqoona-nir-never-stored] no NIR with a wrong key (nor any NIR, spaced, in first 13 digits or with 2A/2B) appears in an answer, anomaly, run, volume, export, audit entry, notification, table or in the server log; the anomalies say « incorrecte » and name the person, with no digit that hints at the key', async () => {
      const offset = logSize()
      payfitWithNirs({ 'emp-ct-a1': BAD1, 'emp-ct-a2': NIR3, 'emp-ct-b1': NIR_2B_OK }, { nirScopeMissing: [SIRET_B] })
      expect((await refresh(w.rh.token, 'payfit')).state).toBe('SUCCEEDED')
      const run = await readAqoona([
        row({ ...DIFFERENT, matricule: spaced(BAD1), day: d(-6) }),
        row({ firstName: 'Noé', lastName: 'Petit', matricule: NIR3, day: d(-5) }),
        row({ firstName: 'Noé', lastName: 'Petit', matricule: BAD4, day: d(-4) }),
        row({ firstName: 'Zoé', lastName: 'Durand', crecheName: 'Crèche Beta', matricule: NIR_2B_OK, day: d(-3) }),
        row({ firstName: 'Zoé', lastName: 'Durand', crecheName: 'Crèche Beta', matricule: NIR_2A_KO, day: d(-2) }),
        row({ firstName: 'Inconnue', lastName: 'Total', crecheName: 'Établissement Inconnu', matricule: BAD1_00, day: d(-1) }),
        row({ firstName: 'Inconnue', lastName: 'Total', matricule: NIR_KO, day: d(-1) }),
      ])
      expect(run.state).toBe('SUCCEEDED')
      const all = await everythingV4(w.rh.token)
      expectNoNir('visible', all, V4_NIRS)
      expectNoNir('run', JSON.stringify(run), V4_NIRS)
      expectNoNir('server log', logSince(offset), V4_NIRS)
      const everyAnomaly = [...(await anomaliesOf('aqoona')).items, ...(await anomaliesOf('payfit')).items]
      expectNoNir('anomalies', JSON.stringify(everyAnomaly), V4_NIRS)
      expectNoLongDigits('anomalies', JSON.stringify(everyAnomaly.map((i: any) => [i.type, i.label, i.subject, i.detail])))
      // the types of this version are all there, the texts say « incorrecte » and carry no digit apart from the count and the SIRET
      const aqoonaWrong = await ofType('aqoona_nir_key_invalid')
      const payfitWrong = await ofType('payfit_nir_key_invalid')
      expect(aqoonaWrong.length).toBeGreaterThanOrEqual(3)
      expect(payfitWrong.length).toBeGreaterThanOrEqual(1)
      for (const item of aqoonaWrong) expect(`${item.subject} ${String(item.detail).replace(/^\d+ /, '')}`).not.toMatch(/\d/)
      for (const item of payfitWrong) expect(`${item.subject} ${String(item.detail).split(SIRET_A).join('')}`).not.toMatch(/\d/)
      for (const item of [...aqoonaWrong, ...payfitWrong]) expect(item.detail).toMatch(/incorrecte/)
    })
  })
})
