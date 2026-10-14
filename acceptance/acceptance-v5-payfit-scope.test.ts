import { resetData, closePool, sql } from './harness'
import { logSince, logSize } from './renfort-helpers'
import { GET, POST, seedWorld, World, closeEvp, clearFixtures, waitRun, writeFixture, countRows } from './evp-helpers'
import { expectNoNir } from './v3-helpers'
import {
  ALPHA, BAD1, BETA, INTROSPECTION_LABEL, KEY_PAYFIT_LABEL, NIR1, NIR2, NIR3, PF_INTROSPECTION_DETAIL, PF_SCOPE_DETAIL, SCOPE_MISSING_LABEL, SIRET_A, SIRET_B,
  UNKNOWN_COMPANY_NAME, V4_NIRS, companyLabel, d, everythingV5, expectNoLongDigits, kit, payfitWith, row,
} from './v5-helpers'

// Acceptance suite of version v5-evp-rattachement-nir, part 3: every reading of PayFit checks the scope « numéro de sécurité sociale »
// of every key and reports, in the anomalies of PayFit, the keys without it and the introspections that fail, naming the company.
// Default API variant (fake sources: payfit.json carries the lists `nirScopeMissing` and `introspectionFailed`, SIRET of the companies
// concerned). The real-driver side (the introspection requests themselves) is in acceptance-v5-sources-introspection.
describe('PayFit scope checked at every reading, company named (v5-evp-rattachement-nir)', () => {
  let w: World
  const { readAqoona, readPayfit, sourceOf, anomaliesOf, ofType } = kit(() => w)
  const SIRET_C = '33333333333333'
  const scopeTypes = ['payfit_scope_missing', 'payfit_introspection_failed']

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

  const scopeItems = async () => (await anomaliesOf('payfit')).items.filter((i: any) => scopeTypes.includes(i.type))

  describe('a key without the scope', () => {
    it('[rule-evp-payfit-scope-every-read] [rule-evp-company-named-in-anomalies] a key without the scope « collaborators:social-security:read » is reported in the anomalies of PayFit for its company, named with its name and its SIRET; the other company is not', async () => {
      payfitWith({}, { scopeMissing: [SIRET_A] })
      const run = await readPayfit()
      expect(run.state).toBe('SUCCEEDED')
      const items = await ofType('payfit_scope_missing', 'payfit')
      expect(items).toHaveLength(1)
      expect(items[0]).toEqual({ type: 'payfit_scope_missing', label: SCOPE_MISSING_LABEL, subject: ALPHA, detail: PF_SCOPE_DETAIL })
      expect(await ofType('payfit_introspection_failed', 'payfit')).toEqual([])
      expect(items[0].subject).toBe('Société A (SIRET 11111111111111)')
    })

    it('[rule-evp-payfit-scope-no-failure] [rule-evp-payfit-scope-every-read] a missing scope does not make the reading PARTIAL or FAILED: the source is up to date and the collaborators and contracts of every company are copied', async () => {
      payfitWith({ 'emp-ct-a1': NIR1 }, { scopeMissing: [SIRET_A, SIRET_B] })
      const run = await readPayfit()
      expect(run.state).toBe('SUCCEEDED')
      expect(run.errorMessage).toBeNull()
      const source = await sourceOf('payfit')
      expect(source.state).toBe('UP_TO_DATE')
      expect(source.lastError).toBeNull()
      expect((await scopeItems()).map((i: any) => i.subject).sort()).toEqual([ALPHA, BETA].sort())
      expect(await countRows('payfit_employees')).toBe(3)
      expect(await countRows('payfit_contracts')).toBe(3)
    })

    it('[rule-evp-payfit-scope-every-read] [rule-evp-payfit-scope-one-per-key] at most one anomaly of scope per company and per reading: the next reading replaces it, it is never accumulated', async () => {
      payfitWith({}, { scopeMissing: [SIRET_A] })
      await readPayfit()
      await readPayfit()
      await readPayfit()
      expect((await scopeItems()).map((i: any) => [i.type, i.subject])).toEqual([['payfit_scope_missing', ALPHA]])
      expect((await sourceOf('payfit')).anomalyCount).toBe(1)
    })

    it('[rule-evp-payfit-scope-every-read] the scope is looked at on every reading: a key corrected between two readings is no longer reported; a key whose scope is withdrawn is reported at the next reading', async () => {
      payfitWith({}, { scopeMissing: [SIRET_A, SIRET_B] })
      await readPayfit()
      expect((await scopeItems()).map((i: any) => i.subject).sort()).toEqual([ALPHA, BETA].sort())
      payfitWith({}, { scopeMissing: [SIRET_B] })
      await readPayfit()
      expect((await scopeItems()).map((i: any) => i.subject)).toEqual([BETA])
      payfitWith({})
      await readPayfit()
      expect(await scopeItems()).toEqual([])
      payfitWith({}, { scopeMissing: [SIRET_A] })
      await readPayfit()
      expect((await scopeItems()).map((i: any) => i.subject)).toEqual([ALPHA])
    })

    it('[rule-evp-payfit-scope-every-read] the whole list of the keys to correct is available after one reading of PayFit, whatever the rows of Aqoona: every key without the scope is reported, with no Aqoona reading at all', async () => {
      payfitWith({}, { scopeMissing: [SIRET_A, SIRET_B] })
      expect(await countRows('aqoona_plannings')).toBe(0)
      await readPayfit()
      expect((await scopeItems()).map((i: any) => i.type)).toEqual(['payfit_scope_missing', 'payfit_scope_missing'])
      expect(await ofType('aqoona_nir_unavailable', 'aqoona')).toEqual([])
    })

    it('[rule-evp-payfit-scope-every-read] the chain « Toutes les sources » reads PayFit and reports the keys without the scope as a single reading does', async () => {
      writeFixture('sheets', { rows: [] })
      writeFixture('aqoona', { rows: [] })
      payfitWith({}, { scopeMissing: [SIRET_B] })
      const started = await POST('/sources/refresh-all', w.sup.token)
      expect(started.status).toBe(202)
      const run = await waitRun(w.sup.token, started.body.runId)
      expect(run.state).toBe('SUCCEEDED')
      expect((await scopeItems()).map((i: any) => [i.type, i.subject])).toEqual([['payfit_scope_missing', BETA]])
    })

    it('[rule-evp-company-named-in-anomalies] a company that PayFit has never recorded is « Société sans nom connu (SIRET …) »', async () => {
      payfitWith({}, { scopeMissing: [SIRET_C] })
      await readPayfit()
      expect((await scopeItems()).map((i: any) => i.subject)).toEqual([companyLabel(UNKNOWN_COMPANY_NAME, SIRET_C)])
      expect((await scopeItems())[0].subject).toBe('Société sans nom connu (SIRET 33333333333333)')
    })

    it('[rule-evp-company-named-in-anomalies] the name of the company comes from what PayFit sent, else from what was recorded: renamed in PayFit, the anomaly follows the new name at the next reading', async () => {
      payfitWith({}, { scopeMissing: [SIRET_A] })
      await readPayfit()
      expect((await scopeItems()).map((i: any) => i.subject)).toEqual([ALPHA])
      payfitWith({}, {
        scopeMissing: [SIRET_A],
        companies: [
          { id: 'co-a', siret: SIRET_A, name: 'Société A Renommée' },
          { id: 'co-b', siret: SIRET_B, name: 'Société B' },
        ],
      })
      await readPayfit()
      expect((await scopeItems()).map((i: any) => i.subject)).toEqual([companyLabel('Société A Renommée', SIRET_A)])
    })
  })

  describe('an introspection that fails', () => {
    it('[rule-evp-payfit-scope-introspection-failed] [rule-evp-company-named-in-anomalies] an introspection that fails is reported for its company, with the cause in words and without guessing the scope: no « Portée PayFit manquante » for that company', async () => {
      payfitWith({}, { introspectionFailed: [SIRET_B] })
      const run = await readPayfit()
      expect(run.state).toBe('SUCCEEDED')
      const items = await scopeItems()
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({ type: 'payfit_introspection_failed', label: INTROSPECTION_LABEL, subject: BETA })
      expect(items[0].detail).toMatch(PF_INTROSPECTION_DETAIL)
      expect(await ofType('payfit_scope_missing', 'payfit')).toEqual([])
    })

    it('[rule-evp-payfit-scope-introspection-failed] [rule-evp-payfit-scope-one-per-key] a key whose introspection fails and which is also listed without the scope gives one anomaly, the failure: nothing is guessed about its scope', async () => {
      payfitWith({}, { introspectionFailed: [SIRET_A], scopeMissing: [SIRET_A] })
      await readPayfit()
      expect((await scopeItems()).map((i: any) => [i.type, i.subject])).toEqual([['payfit_introspection_failed', ALPHA]])
    })

    it('[rule-evp-payfit-scope-no-failure] a failed introspection stops neither the reading of the other companies nor the reading itself: SUCCEEDED, source up to date, the data of the company whose key is fine is copied; a missing scope and a failure coexist for two companies', async () => {
      payfitWith({}, { scopeMissing: [SIRET_A], introspectionFailed: [SIRET_B] })
      const run = await readPayfit()
      expect(run.state).toBe('SUCCEEDED')
      expect((await sourceOf('payfit')).state).toBe('UP_TO_DATE')
      expect((await scopeItems()).map((i: any) => [i.type, i.subject]).sort()).toEqual([['payfit_introspection_failed', BETA], ['payfit_scope_missing', ALPHA]])
      expect(await countRows('payfit_employees', "company_id = 'co-a'")).toBe(2)
    })

    it('[rule-evp-payfit-scope-introspection-failed] the failure disappears at the next reading when the introspection works again', async () => {
      payfitWith({}, { introspectionFailed: [SIRET_A] })
      await readPayfit()
      expect(await scopeItems()).toHaveLength(1)
      payfitWith({})
      await readPayfit()
      expect(await scopeItems()).toEqual([])
    })
  })

  describe('what the reading of PayFit still does not do', () => {
    it('[rule-evp-payfit-scope-no-nir-read][D-0018] the reading of PayFit reads no NIR: whatever the NIR of the collaborators in PayFit, it produces no anomaly of key, no « Planning non rattaché », and no NIR in any answer, table or log', async () => {
      const offset = logSize()
      payfitWith({ 'emp-ct-a1': BAD1, 'emp-ct-a2': NIR3, 'emp-ct-b1': NIR2 }, { scopeMissing: [SIRET_B] })
      const run = await readPayfit()
      expect(run.state).toBe('SUCCEEDED')
      const types = (await anomaliesOf('payfit')).items.map((i: any) => i.type)
      expect(types.filter((t: string) => !scopeTypes.includes(t))).toEqual([])
      expect(types).toEqual(['payfit_scope_missing'])
      expect((await anomaliesOf('payfit')).items.filter((i: any) => i.label === KEY_PAYFIT_LABEL)).toEqual([])
      expect(await ofType('payfit_nir_key_invalid', 'aqoona')).toEqual([])
      expectNoNir('visible', await everythingV5(w.rh.token), V4_NIRS)
      expectNoNir('server log', logSince(offset), V4_NIRS)
      const columns = await sql("select column_name from information_schema.columns where table_schema = 'base' and table_name = 'payfit_employees'")
      expect(columns.map((c) => c.column_name).join(' ')).not.toMatch(/nir|social|secu|ssn/i)
    })

    it('[rule-evp-payfit-scope-every-read] [rule-evp-company-named-in-anomalies] the anomalies of scope hold the name and the SIRET and nothing else that looks like a number: no NIR, no key, no address', async () => {
      payfitWith({ 'emp-ct-a1': NIR1 }, { scopeMissing: [SIRET_A], introspectionFailed: [SIRET_B] })
      await readPayfit()
      const items = await scopeItems()
      expect(items).toHaveLength(2)
      expectNoLongDigits('anomalies', JSON.stringify(items.map((i: any) => [i.type, i.label, i.subject, i.detail])), [SIRET_A, SIRET_B])
      expect(JSON.stringify(items)).not.toMatch(/https?:|Bearer|token|apiKey|secret|key-/i)
    })
  })

  describe('both sides, one company', () => {
    it('[rule-evp-company-named-in-anomalies] [rule-evp-payfit-scope-every-read] a key without the scope is named the same way on both sides: « Portée PayFit manquante » (reading of PayFit) and « Rapprochement par NIR indisponible » (reading of Aqoona) both carry « Nom (SIRET …) »; the two sources are independent', async () => {
      payfitWith({ 'emp-ct-a1': NIR1 }, { scopeMissing: [SIRET_A] })
      await readPayfit()
      const payfitSide = await scopeItems()
      expect(payfitSide.map((i: any) => i.subject)).toEqual([ALPHA])
      await readAqoona([row({ matricule: NIR2, firstName: 'Ida', lastName: 'Inconnue', day: d(-3) })])
      const aqoonaSide = await ofType('aqoona_nir_unavailable')
      expect(aqoonaSide.map((i: any) => i.subject)).toEqual([ALPHA])
      // each list keeps its own: the Aqoona reading does not erase the PayFit anomaly and the PayFit reading does not create the other one
      expect((await scopeItems()).map((i: any) => i.subject)).toEqual([ALPHA])
      payfitWith({ 'emp-ct-a1': NIR1 })
      await readPayfit()
      expect(await scopeItems()).toEqual([])
      expect((await ofType('aqoona_nir_unavailable')).map((i: any) => i.subject)).toEqual([ALPHA])
    })

    it('[rule-evp-payfit-scope-no-failure] the anomalies of scope are anomalies of a reading: they create no notification and no dossier', async () => {
      payfitWith({}, { scopeMissing: [SIRET_A], introspectionFailed: [SIRET_B] })
      const before = [await countRows('notifications'), await countRows('absences')]
      await readPayfit()
      expect([await countRows('notifications'), await countRows('absences')]).toEqual(before)
      expect((await scopeItems()).map((i: any) => [i.type, i.subject]).sort()).toEqual([['payfit_introspection_failed', BETA], ['payfit_scope_missing', ALPHA]].sort())
      expect((await GET('/sources/payfit/anomalies?size=50', w.rh.token)).status).toBe(200)
    })
  })
})
