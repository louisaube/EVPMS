import { resetData, closePool, sql } from './harness'
import { logSince, logSize } from './renfort-helpers'
import { GET, seedWorld, World, closeEvp, refresh, SIRET_A, SIRET_B, countRows } from './evp-helpers'
import { FakeNet, PayfitFake, describeStandard, expectNoSecret, payfitKey, payfitWorld } from './v2-helpers'
import { ProsFake, expectNoNir, pros, withNir } from './v3-helpers'
import { ABSENT, SCOPE_WITH, SCOPE_WITHOUT, SOCIAL_SCOPE, introspectScopes } from './v4-helpers'
import {
  ALPHA, AQ_SCOPE_DETAIL, AQ_UNAVAILABLE_DETAIL, BAD1, BAD4, BETA, INTROSPECTION_LABEL, KEY_PAYFIT_DETAIL, KEY_PAYFIT_LABEL, NIR1, NIR2, NIR3, NIR4,
  PF_INTROSPECTION_DETAIL, PF_SCOPE_DETAIL, SCOPE_MISSING_LABEL, UNAVAILABLE_LABEL, V4_NIRS, d, everythingV5, expectNoLongDigits, introspectionDetail, kit, link, personsOf,
  rateOfCompany, ratesOf, sameName, slots, summary,
} from './v5-helpers'

// Acceptance suite of version v5-evp-rattachement-nir, part 4: against a fake PayFit and the Aqoona « Pros » address, with the real
// drivers: every reading of PayFit introspects every key (POST, field `scope`), reports the keys without the scope and the introspections
// that fail, naming the company; the reading of Aqoona reads the NIR of the whole network as soon as one row has a NIR of right key.
// API of the variant `network` (real drivers; ports 4601 to 4603 and 4611, see acceptance/variants.yaml).
describeStandard('PayFit introspected at every reading, whole network read, real drivers (v5-evp-rattachement-nir)', () => {
  const net = new FakeNet()
  const aq = new ProsFake()
  let pf: PayfitFake
  let w: World
  const { readPayfit, sourceOf, anomaliesOf, ofType, volume, rates, people } = kit(() => w)

  beforeAll(async () => {
    pf = payfitWorld()
    await aq.mount(net)
    await pf.mount(net)
  })
  afterAll(async () => {
    await net.close()
    await closeEvp()
    await closePool()
  })
  beforeEach(async () => {
    await resetData()
    aq.reset()
    pf.reset()
    pf.companies = payfitWorld().companies
    introspectScopes(pf)
    net.clear()
    w = await seedWorld()
    await sql("update base.payfit_contracts set status = 'ACTIVE'")
  })

  const readAqoona = () => refresh(w.rh.token, 'aqoona')
  const payfitCalls = () => net.calls(/^payfit/)
  const introspections = (siret?: string) => net.calls('payfit-introspect').filter((c) => siret === undefined || c.headers.authorization === `Bearer ${payfitKey(siret)}`)
  const collaboratorCalls = (company: string) => net.calls('payfit').filter((c) => new RegExp(`/companies/${company}/collaborators`).test(c.path))
  const setNir = (siret: string, id: string, nir: string | null) => {
    const company = pf.company(siret)
    company.collaborators = company.collaborators.map((c) => (c.id === id ? (withNir(c, nir) as any) : c))
  }
  const scopeItems = async () => (await anomaliesOf('payfit')).items.filter((i: any) => ['payfit_scope_missing', 'payfit_introspection_failed'].includes(i.type))
  /** Un nom qui ne désigne personne : seul le NIR peut rattacher la ligne. */
  const nirRow = (matricule: string, o: { etab?: string; day?: string; prenom?: string; nom?: string } = {}) =>
    pros({ prenom: o.prenom ?? 'Prénom', nom: o.nom ?? 'Différent', matricule, etab: o.etab, day: o.day ?? d(-3) })
  const reset = async () => {
    await resetData()
    pf.reset()
    pf.companies = payfitWorld().companies
    introspectScopes(pf)
    net.clear()
    w = await seedWorld()
    await sql("update base.payfit_contracts set status = 'ACTIVE'")
  }

  // ───────────────────────────── lecture de PayFit ─────────────────────────────
  describe('reading of PayFit', () => {
    it('[rule-evp-payfit-scope-every-read] [rule-evp-payfit-scope-one-per-key] [rule-evp-payfit-scope-read-only] every reading introspects every key exactly once, with the key as bearer, even when the identifier of the company is cached; the introspection is the only POST', async () => {
      expect((await readPayfit()).state).toBe('SUCCEEDED')
      expect(introspections()).toHaveLength(2)
      expect(introspections(SIRET_A)).toHaveLength(1)
      expect(introspections(SIRET_B)).toHaveLength(1)
      expect(introspections().every((c) => c.method === 'POST')).toBe(true)
      expect(payfitCalls().filter((c) => c.method !== 'GET').every((c) => c.tag === 'payfit-introspect')).toBe(true)
      net.clear()
      expect((await readPayfit()).state).toBe('SUCCEEDED') // the identifiers are in the cache now
      expect(introspections()).toHaveLength(2)
      expect(introspections(SIRET_A)).toHaveLength(1)
      expect(introspections(SIRET_B)).toHaveLength(1)
      expect(await scopeItems()).toEqual([])
      expect((await sourceOf('payfit')).state).toBe('UP_TO_DATE')
    })

    it('[rule-evp-payfit-scope-every-read] [rule-evp-company-named-in-anomalies] a key without the scope is reported for its company, named with its name and SIRET, and the reading goes on: SUCCEEDED, the data of both companies is copied; the scope is never served from the cache of the identifiers', async () => {
      introspectScopes(pf, { [SIRET_A]: SCOPE_WITHOUT })
      const run = await readPayfit()
      expect(run.state).toBe('SUCCEEDED')
      expect((await sourceOf('payfit')).state).toBe('UP_TO_DATE')
      expect(await scopeItems()).toEqual([{ type: 'payfit_scope_missing', label: SCOPE_MISSING_LABEL, subject: ALPHA, detail: PF_SCOPE_DETAIL }])
      expect(collaboratorCalls('co-a').length).toBeGreaterThanOrEqual(1) // the scope matters for NIR only: the reading of PayFit itself is complete
      expect(collaboratorCalls('co-b').length).toBeGreaterThanOrEqual(1)
      // identifiers cached: the scope granted, withdrawn, granted again is seen at each reading
      introspectScopes(pf)
      await readPayfit()
      expect(await scopeItems()).toEqual([])
      introspectScopes(pf, { [SIRET_B]: SCOPE_WITHOUT })
      await readPayfit()
      expect((await scopeItems()).map((i: any) => [i.type, i.subject])).toEqual([['payfit_scope_missing', BETA]])
      expect(net.calls('payfit-introspect')).toHaveLength(6)
    })

    it('[rule-evp-payfit-scope-format] the scope is a string of scopes separated by spaces, or an array of strings, compared exactly: these answers grant it; an absent, empty, blank, null, empty array or neighbouring scope is « scope missing » (an active token answered)', async () => {
      const granted: unknown[] = [SOCIAL_SCOPE, SCOPE_WITH, `  collaborators:read   ${SOCIAL_SCOPE}  `, ['collaborators:read', SOCIAL_SCOPE], [SOCIAL_SCOPE]]
      for (const scope of granted) {
        await reset()
        introspectScopes(pf, { [SIRET_A]: scope })
        expect((await readPayfit()).state).toBe('SUCCEEDED')
        expect({ scope, items: await scopeItems() }).toEqual({ scope, items: [] })
      }
      const missing: unknown[] = [ABSENT, '', '   ', [], null, SCOPE_WITHOUT, 'collaborators:social-security:write', 'social-security:read', `${SOCIAL_SCOPE}:all`, 'Collaborators:Social-Security:Read', [`${SOCIAL_SCOPE}:readonly`]]
      for (const scope of missing) {
        await reset()
        introspectScopes(pf, { [SIRET_A]: scope })
        expect((await readPayfit()).state).toBe('SUCCEEDED')
        const label = scope === ABSENT ? 'ABSENT' : scope
        expect({ scope: label, items: (await scopeItems()).map((i: any) => [i.type, i.subject]) }).toEqual({ scope: label, items: [['payfit_scope_missing', ALPHA]] })
      }
    })

    it('[rule-evp-payfit-scope-introspection-failed] an introspection that fails is reported for its company with the cause in words, and nothing is guessed about the scope; the other company is checked on its own and the reading of PayFit is not FAILED', async () => {
      const causes: Array<[string, () => void, string | null]> = [
        ['active false', () => introspectScopes(pf, { [SIRET_B]: SCOPE_WITHOUT }, SCOPE_WITH, [SIRET_A]), 'clé inactive'],
        ['401', () => pf.failAlways(SIRET_A, 'introspect', 401), 'clé refusée'],
        ['403', () => pf.failAlways(SIRET_A, 'introspect', 403), 'clé refusée'],
        ['429', () => pf.failAlways(SIRET_A, 'introspect', 429), 'limite de débit'],
        ['500', () => pf.failAlways(SIRET_A, 'introspect', 500), null],
        ['503', () => pf.failAlways(SIRET_A, 'introspect', 503), null],
        ['unexpected answer', () => pf.failAlways(SIRET_A, 'introspect', { status: 200, body: ['inattendu'] }), 'réponse inattendue'],
      ]
      for (const [name, arrange, cause] of causes) {
        await reset()
        introspectScopes(pf, { [SIRET_B]: SCOPE_WITHOUT })
        arrange()
        const run = await readPayfit()
        expect({ name, state: ['SUCCEEDED', 'PARTIAL'].includes(run.state) }).toEqual({ name, state: true })
        const items = await scopeItems()
        const bySubject = Object.fromEntries(items.map((i: any) => [i.subject, i]))
        expect({ name, subjects: Object.keys(bySubject).sort() }).toEqual({ name, subjects: [ALPHA, BETA].sort() })
        expect({ name, type: bySubject[ALPHA].type, label: bySubject[ALPHA].label }).toEqual({ name, type: 'payfit_introspection_failed', label: INTROSPECTION_LABEL })
        expect({ name, ok: PF_INTROSPECTION_DETAIL.test(bySubject[ALPHA].detail) }).toEqual({ name, ok: true })
        if (cause) expect({ name, detail: bySubject[ALPHA].detail }).toEqual({ name, detail: introspectionDetail(cause) })
        expect({ name, type: bySubject[BETA].type }).toEqual({ name, type: 'payfit_scope_missing' })
        expect(items.filter((i: any) => i.subject === ALPHA)).toHaveLength(1)
        expect(collaboratorCalls('co-b').length).toBeGreaterThanOrEqual(1)
      }
    })

    it('[rule-evp-payfit-scope-no-failure] [rule-evp-payfit-scope-introspection-failed] a key without the scope whose company data cannot be read after the introspection is still reported; the answer of the upstream never reaches the anomalies (no key, no address, no echo)', async () => {
      // One company must stay readable, or the reading ends FAILED (rule-evp-sources-partial-failure: every company unreadable). A first
      // reading puts the identifiers of the companies in the cache: B, whose introspection then fails, is still read with its key.
      expect((await readPayfit()).state).toBe('SUCCEEDED')
      introspectScopes(pf, { [SIRET_A]: SCOPE_WITHOUT })
      pf.failAlways(SIRET_A, 'collaborators', 500)
      pf.failAlways(SIRET_B, 'introspect', 401)
      const offset = logSize()
      const run = await readPayfit()
      expect(['SUCCEEDED', 'PARTIAL']).toContain(run.state)
      const items = await scopeItems()
      expect(items.map((i: any) => [i.type, i.subject]).sort()).toEqual([['payfit_introspection_failed', BETA], ['payfit_scope_missing', ALPHA]].sort())
      const text = JSON.stringify(await anomaliesOf('payfit')) + JSON.stringify(run)
      expectNoSecret('anomalies', text)
      expectNoSecret('server log', logSince(offset))
      expect(text).not.toMatch(/https?:|Bearer|invalid_token|fake_error|127\.0\.0\.1/)
    })

    it('[rule-evp-payfit-scope-no-nir-read][D-0018] the reading of PayFit reads no NIR even when PayFit delivers them: nothing stored, nothing shown, no anomaly of key, no endpoint other than the collaborators, contracts, absences and the company', async () => {
      const offset = logSize()
      setNir(SIRET_A, 'emp-ct-a1', NIR1)
      setNir(SIRET_A, 'emp-ct-a2', BAD1)
      setNir(SIRET_B, 'emp-ct-b1', NIR2)
      expect((await readPayfit()).state).toBe('SUCCEEDED')
      expect(await scopeItems()).toEqual([])
      // v5: the identifiers of the companies are cached now, yet the next reading introspects every key again (scope checked at every
      // reading), reports the key withdrawn from its scope, and still reads no NIR: only `scope` and `active` come out of the introspection
      net.clear()
      introspectScopes(pf, { [SIRET_A]: SCOPE_WITHOUT })
      expect((await readPayfit()).state).toBe('SUCCEEDED')
      expect(introspections()).toHaveLength(2)
      expect(introspections().every((c) => c.method === 'POST')).toBe(true)
      expect((await scopeItems()).map((i: any) => [i.type, i.subject])).toEqual([['payfit_scope_missing', ALPHA]])
      expect((await anomaliesOf('payfit')).items.filter((i: any) => i.type === 'payfit_nir_key_invalid' || i.label === KEY_PAYFIT_LABEL)).toEqual([])
      expect(await ofType('payfit_nir_key_invalid', 'aqoona')).toEqual([])
      expect(payfitCalls().filter((c) => c.method === 'GET').every((c) => /^\/(companies(-fr)?\/[^/]+(\/(collaborators|contracts-fr|absences))?)$/.test(c.path))).toBe(true)
      expectNoNir('visible', await everythingV5(w.rh.token), V4_NIRS)
      expectNoNir('server log', logSince(offset), V4_NIRS)
      const columns = await sql("select column_name from information_schema.columns where table_schema = 'base' and table_name = 'payfit_employees'")
      expect(columns.map((c) => c.column_name).join(' ')).not.toMatch(/nir|social|secu|ssn/i)
    })
  })

  // ───────────────────────────── lecture d'Aqoona : tout le réseau ─────────────────────────────
  describe('reading of Aqoona', () => {
    it('[rule-evp-link-network-read] [rule-evp-link-network-wide] one row with a NIR of right key makes the NIR of every company of the network be read (both keys introspected, both collaborators lists requested), and the NIR of a collaborator of another company than the crèche attaches the row to her', async () => {
      setNir(SIRET_B, 'emp-ct-b1', NIR2)
      aq.rows([nirRow(NIR2)]) // a row in the crèche of company A, the NIR of a collaborator of company B
      const run = await readAqoona()
      expect(run.state).toBe('SUCCEEDED')
      expect(introspections(SIRET_A)).toHaveLength(1)
      expect(introspections(SIRET_B)).toHaveLength(1)
      expect(collaboratorCalls('co-a').length).toBeGreaterThanOrEqual(1)
      expect(collaboratorCalls('co-b').length).toBeGreaterThanOrEqual(1)
      expect(payfitCalls().some((c) => /\/(contracts|contracts-fr|absences)/.test(c.path))).toBe(false)
      expect(payfitCalls().filter((c) => c.method !== 'GET').every((c) => c.tag === 'payfit-introspect')).toBe(true)
      expect((await slots()).map(link)).toEqual([['co-a', 'alpha', 'co-b', 'emp-ct-b1', 'NIR', null]])
      expect(summary((await rates()).items)).toEqual([['co-b', 1, 0]])
      expect(volume((await sourceOf()).volumes, 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count: 1 })
    })

    it('[rule-evp-link-network-read] [rule-evp-aqoona-nir-transient-key] without a row whose NIR has a right key, PayFit is not called at all, not even the introspection; nothing is reported about the keys', async () => {
      aq.rows([nirRow(''), nirRow(BAD1, { day: d(-2) }), nirRow('MAT-1', { day: d(-1) })])
      introspectScopes(pf, { [SIRET_A]: SCOPE_WITHOUT })
      expect((await readAqoona()).state).toBe('SUCCEEDED')
      expect(payfitCalls()).toHaveLength(0)
      expect(await ofType('aqoona_nir_unavailable')).toEqual([])
      expect((await slots()).map((s) => s.unlinked_cause)).toEqual(['NIR_ABSENT', 'NIR_KEY_INVALID', 'NIR_ABSENT'])
    })

    it('[rule-evp-link-incomplete-read] [rule-evp-company-named-in-anomalies] a company without the scope: its collaborators are not requested, a NIR found nowhere else is PAYFIT_INCOMPLETE, the anomaly names the company with its scope; a NIR found in the other company is attached; the reading is SUCCEEDED', async () => {
      introspectScopes(pf, { [SIRET_B]: SCOPE_WITHOUT })
      setNir(SIRET_A, 'emp-ct-a1', NIR1)
      setNir(SIRET_B, 'emp-ct-b1', NIR2)
      aq.rows([nirRow(NIR1, { day: d(-3) }), nirRow(NIR2, { day: d(-2) }), nirRow(NIR4, { day: d(-1), prenom: 'Una', nom: 'Inconnue' })])
      const run = await readAqoona()
      expect(run.state).toBe('SUCCEEDED')
      expect((await sourceOf()).state).toBe('UP_TO_DATE')
      expect(collaboratorCalls('co-b')).toHaveLength(0)
      expect((await slots()).map((s) => [s.employee_id, s.unlinked_cause])).toEqual([['emp-ct-a1', null], [null, 'PAYFIT_INCOMPLETE'], [null, 'PAYFIT_INCOMPLETE']])
      const missing = await ofType('aqoona_nir_unavailable')
      expect(missing).toEqual([{ type: 'aqoona_nir_unavailable', label: UNAVAILABLE_LABEL, subject: BETA, detail: AQ_SCOPE_DETAIL }])
    })

    it('[rule-evp-aqoona-nir-unavailable] [rule-evp-company-named-in-anomalies] an introspection that fails (401, 403, 429, 5xx, inactive key) makes the company unavailable: the short sentence, the company named, even when no row of Aqoona is in its crèches', async () => {
      const causes: Array<[string, () => void]> = [
        ['active false', () => introspectScopes(pf, {}, SCOPE_WITH, [SIRET_B])],
        ['401', () => pf.failAlways(SIRET_B, 'introspect', 401)],
        ['403', () => pf.failAlways(SIRET_B, 'introspect', 403)],
        ['429', () => pf.failAlways(SIRET_B, 'introspect', 429)],
        ['500', () => pf.failAlways(SIRET_B, 'introspect', 500)],
        ['503', () => pf.failAlways(SIRET_B, 'introspect', 503)],
      ]
      for (const [name, arrange] of causes) {
        await reset()
        arrange()
        setNir(SIRET_A, 'emp-ct-a1', NIR1)
        aq.rows([nirRow(NIR1, { day: d(-3) }), nirRow(NIR4, { day: d(-2), prenom: 'Una', nom: 'Inconnue' })])
        const run = await readAqoona()
        const seen = {
          name,
          state: run.state,
          source: (await sourceOf()).state,
          unavailable: (await ofType('aqoona_nir_unavailable')).map((i: any) => [i.subject, i.detail]),
          causes: (await slots()).map((s) => [s.employee_id, s.unlinked_cause]),
        }
        expect(seen).toEqual({ name, state: 'SUCCEEDED', source: 'UP_TO_DATE', unavailable: [[BETA, AQ_UNAVAILABLE_DETAIL]], causes: [['emp-ct-a1', null], [null, 'PAYFIT_INCOMPLETE']] })
      }
    })

    it('[rule-evp-link-network-read] [rule-evp-link-incomplete-read] an unreadable network (every key refused): every row with a NIR of right key is PAYFIT_INCOMPLETE, both companies are named, the reading is SUCCEEDED', async () => {
      pf.failAlways(SIRET_A, 'introspect', 500)
      pf.failAlways(SIRET_B, 'introspect', 500)
      aq.rows([nirRow(NIR1, { day: d(-3) }), nirRow(NIR2, { day: d(-2) })])
      const run = await readAqoona()
      expect(run.state).toBe('SUCCEEDED')
      expect((await slots()).map((s) => [s.employee_id, s.unlinked_cause])).toEqual([[null, 'PAYFIT_INCOMPLETE'], [null, 'PAYFIT_INCOMPLETE']])
      expect((await ofType('aqoona_nir_unavailable')).map((i: any) => i.subject).sort()).toEqual([ALPHA, BETA].sort())
    })

    it('[rule-evp-link-network-read] [rule-evp-nir-key-payfit-anomaly-source] the whole network is checked for wrong keys: a collaborator of company B with a NIR of wrong key is reported although the only row with a right key is in a crèche of company A', async () => {
      setNir(SIRET_A, 'emp-ct-a1', NIR1)
      setNir(SIRET_B, 'emp-ct-b1', BAD4)
      aq.rows([nirRow(NIR1)])
      expect((await readAqoona()).state).toBe('SUCCEEDED')
      const flagged = await ofType('payfit_nir_key_invalid')
      expect(flagged.map((i: any) => [i.label, sameName(i.subject, 'Zoé Durand'), i.detail])).toEqual([[KEY_PAYFIT_LABEL, true, KEY_PAYFIT_DETAIL(SIRET_B)]])
      expect(await ofType('payfit_nir_key_invalid', 'payfit')).toEqual([])
    })

    it('[rule-evp-link-nir-two-companies][rule-evp-link-network-wide] the same NIR carried by a collaborator of each company: ambiguous, nobody is attached, whatever the crèche of the row', async () => {
      setNir(SIRET_A, 'emp-ct-a1', NIR3)
      setNir(SIRET_B, 'emp-ct-b1', NIR3)
      aq.rows([nirRow(NIR3, { day: d(-3) }), nirRow(NIR3, { etab: 'Crèche Beta', day: d(-2) })])
      expect((await readAqoona()).state).toBe('SUCCEEDED')
      expect((await slots()).map(link)).toEqual([
        ['co-a', 'alpha', null, null, 'AUCUN', 'NIR_AMBIGUOUS'],
        ['co-b', 'beta', null, null, 'AUCUN', 'NIR_AMBIGUOUS'],
      ])
      const list = await people()
      expect(personsOf(list.items).map(([, cause]) => cause)).toEqual(['NIR_AMBIGUOUS'])
    })

    it('[rule-evp-link-employee-not-read][D-0024] a collaborator found in PayFit live but never recorded by a full reading of PayFit is not attached (PAYFIT_INCOMPLETE); after the full reading of PayFit the next reading of Aqoona attaches her', async () => {
      const company = pf.company(SIRET_A)
      company.collaborators = [...company.collaborators, withNir({ id: 'emp-new', firstName: 'Nina', lastName: 'Nouvelle' }, NIR3) as any]
      company.contracts = [...company.contracts, { contractId: 'ct-new', collaboratorId: 'emp-new', startDate: '2020-01-01', endDate: null }]
      aq.rows([nirRow(NIR3, { prenom: 'Nina', nom: 'Nouvelle' })])
      expect((await readAqoona()).state).toBe('SUCCEEDED')
      expect((await slots()).map((s) => [s.employee_id, s.unlinked_cause])).toEqual([[null, 'PAYFIT_INCOMPLETE']])
      expect((await rates()).items.every((i: any) => i.linked.count === 0)).toBe(true)
      expect((await readPayfit()).state).toBe('SUCCEEDED')
      expect((await readAqoona()).state).toBe('SUCCEEDED')
      expect((await slots()).map(link)).toEqual([['co-a', 'alpha', 'co-a', 'emp-new', 'NIR', null]])
      expect(await countRows('payfit_employees', "employee_id = 'emp-new'")).toBe(1)
    })

    it('[rule-evp-payfit-scope-every-read] the reading of Aqoona introspects the keys again at each reading too: a scope withdrawn between two readings is seen at the next one and the row is no longer attached', async () => {
      setNir(SIRET_A, 'emp-ct-a1', NIR1)
      aq.rows([nirRow(NIR1)])
      await readAqoona()
      expect((await slots()).map((s) => s.employee_id)).toEqual(['emp-ct-a1'])
      introspectScopes(pf, { [SIRET_A]: SCOPE_WITHOUT })
      await readAqoona()
      expect((await slots()).map((s) => [s.employee_id, s.unlinked_cause])).toEqual([[null, 'PAYFIT_INCOMPLETE']])
      expect((await ofType('aqoona_nir_unavailable')).map((i: any) => [i.subject, i.detail])).toEqual([[ALPHA, AQ_SCOPE_DETAIL]])
      introspectScopes(pf)
      await readAqoona()
      expect(await ofType('aqoona_nir_unavailable')).toEqual([])
      expect((await slots()).map((s) => s.employee_id)).toEqual(['emp-ct-a1'])
    })
  })

  // ───────────────────────────── confidentialité ─────────────────────────────
  describe('confidentiality', () => {
    it('[rule-evp-unlinked-list-no-nir] [rule-evp-nir-key-never-shown] [rule-evp-secrets-never-exposed] with NIR of right and wrong keys on both sides, a missing scope, a failing introspection and an upstream error echoing the key: no NIR, no key, no introspection answer anywhere (answers, tables, anomalies, rates, list, server log)', async () => {
      const offset = logSize()
      introspectScopes(pf, { [SIRET_B]: SCOPE_WITHOUT })
      pf.failAlways(SIRET_A, 'introspect', { status: 429, body: { error: 'rate_limited', detail: `Bearer ${payfitKey(SIRET_A)}` } })
      setNir(SIRET_A, 'emp-ct-a1', BAD1)
      setNir(SIRET_A, 'emp-ct-a2', NIR3)
      setNir(SIRET_B, 'emp-ct-b1', NIR2)
      aq.rows([nirRow(BAD1, { day: d(-5) }), nirRow(NIR3, { prenom: 'Noé', nom: 'Petit', day: d(-4) }), nirRow(NIR2, { etab: 'Crèche Beta', prenom: 'Zoé', nom: 'Durand', day: d(-2) })])
      expect((await readPayfit()).state).toMatch(/SUCCEEDED|PARTIAL/)
      const run = await readAqoona()
      expect(run.state).toBe('SUCCEEDED')
      const all = await everythingV5(w.rh.token)
      expectNoNir('visible', all, V4_NIRS)
      expectNoNir('run', JSON.stringify(run), V4_NIRS)
      expectNoNir('server log', logSince(offset), V4_NIRS)
      expectNoSecret('visible', all)
      expectNoSecret('server log', logSince(offset))
      expect(logSince(offset)).not.toContain('fake-client')
      const items = [...(await anomaliesOf('aqoona')).items, ...(await anomaliesOf('payfit')).items]
      expectNoLongDigits('anomalies', JSON.stringify(items.map((i: any) => [i.type, i.label, i.subject, i.detail])), [SIRET_A, SIRET_B])
      const res = await ratesOf(w.rh.token)
      expect(res.status).toBe(200)
      expectNoNir('rates', res.text, V4_NIRS)
      expect(rateOfCompany((await rates()).items, 'co-a')).toBeDefined()
      const list = await people({ size: 50 }) // the persons not linked are listed (key of Aqoona wrong, NIR unknown…), never with a NIR
      expect(list.total).toBeGreaterThanOrEqual(1)
      expectNoNir('list', JSON.stringify(list), V4_NIRS)
      expect((await GET('/sources', w.rh.token)).text).not.toMatch(/test-payfit-key/)
    })
  })
})
