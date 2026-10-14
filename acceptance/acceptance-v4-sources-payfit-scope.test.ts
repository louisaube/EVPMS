import { resetData, closePool, sql } from './harness'
import { logSince, logSize } from './renfort-helpers'
import { GET, seedWorld, seedCompany, seedCreche, seedContract, World, closeEvp, refresh, SIRET_A, SIRET_B } from './evp-helpers'
import { FakeNet, PayfitFake, d, describeStandard, expectNoSecret, payfitKey, payfitWorld } from './v2-helpers'
import { ProsFake, expectNoNir, plannings, pros, withNir } from './v3-helpers'
import {
  ABSENT, BAD1, BAD3, BAD4, NIR1, NIR2, NIR3, NIR_KO, SCOPE_WITH, SCOPE_WITHOUT, SOCIAL_SCOPE, V4_NIRS, everythingV4, expectNoLongDigits, introspectScopes, ratesOf,
  storedModes,
} from './v4-helpers'
import { ALPHA, AQ_SCOPE_DETAIL, AQ_UNAVAILABLE_DETAIL, BETA, KEY_PAYFIT_DETAIL, KEY_PAYFIT_LABEL, UNAVAILABLE_LABEL, companyLabel, rateOfCompany, sameName } from './v5-helpers'

// v5-evp-rattachement-nir: no fallback on the names (a row whose NIR cannot be checked is not attached) and the companies are
// named by their name and SIRET in the anomalies.
const SCOPE_DETAIL = AQ_SCOPE_DETAIL
const SHORT_DETAIL = AQ_UNAVAILABLE_DETAIL
const UNAVAILABLE = UNAVAILABLE_LABEL
const KEY_PAYFIT = KEY_PAYFIT_LABEL
const PAYFIT_DETAIL = KEY_PAYFIT_DETAIL

// Acceptance suite of version v4-evp-fiabilite-nir, part 3: the scope of each PayFit key read in the answer of the introspection
// (POST, field `scope`), the check key of the NIR delivered by PayFit, against a fake PayFit and the Aqoona « Pros » address.
// API of the variant `nir` (real drivers; ports 4501 to 4503 and 4511, see acceptance/variants.yaml).
describeStandard('PayFit scope read by introspection and NIR check key, real drivers (v4-evp-fiabilite-nir)', () => {
  const net = new FakeNet()
  const aq = new ProsFake()
  let pf: PayfitFake
  let w: World

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

  const read = () => refresh(w.rh.token, 'aqoona')
  const sourceOf = async (key = 'aqoona') => (await GET('/sources', w.rh.token)).body.items.find((i: any) => i.key === key)
  const anomaliesOf = async (key: 'aqoona' | 'payfit' = 'aqoona') => (await GET(`/sources/${key}/anomalies?size=50`, w.rh.token)).body
  const ofType = async (type: string, key: 'aqoona' | 'payfit' = 'aqoona') => (await anomaliesOf(key)).items.filter((i: any) => i.type === type)
  const volume = (volumes: any[], label: string) => volumes.find((v) => v.label === label)
  const payfitCalls = () => net.calls(/^payfit/)
  const introspections = (siret?: string) =>
    net.calls('payfit-introspect').filter((c) => siret === undefined || c.headers.authorization === `Bearer ${payfitKey(siret)}`)
  const collaboratorCalls = (company: string) => net.calls('payfit').filter((c) => new RegExp(`/companies/${company}/collaborators`).test(c.path))
  const employees = async () => (await plannings()).map((r) => r.employee_id)
  const modes = async () => (await storedModes()).map((r) => r.match_method)
  const setNir = (siret: string, id: string, nir: string | null) => {
    const company = pf.company(siret)
    company.collaborators = company.collaborators.map((c) => (c.id === id ? (withNir(c, nir) as any) : c))
  }
  /** Une ligne dont le nom ne désigne personne et dont le NIR désigne Léa Martin (collaboratrice de la société A) : rattachée seulement si le NIR sert. */
  const nirOnlyRow = (day = d(-3)) => pros({ prenom: 'Prénom', nom: 'Différent', matricule: NIR1, day })

  // ───────────────────────────── la portée est lue avant les NIR ─────────────────────────────
  describe('the scope is read before any NIR', () => {
    it('[rule-evp-payfit-scope-checked] [rule-evp-payfit-scope-missing-fallback] [rule-evp-payfit-scope-read-only] [rule-evp-company-named-in-anomalies] a key without the scope: PayFit delivers the NIR but the collaborators are not even requested; the rows are not attached (no fallback on the names), the anomaly names the company (name and SIRET) and the scope, the reading is neither FAILED nor PARTIAL; the introspection is the only POST', async () => {
      introspectScopes(pf, { [SIRET_A]: SCOPE_WITHOUT })
      setNir(SIRET_A, 'emp-ct-a1', NIR1)
      const before = JSON.stringify([await sql('select * from base.payfit_employees order by company_id, employee_id'), await sql('select * from base.payfit_contracts order by company_id, payfit_contract_id')])
      aq.rows([nirOnlyRow(d(-3)), pros({ matricule: NIR1, day: d(-2) })])
      const run = await read()
      expect(run.state).toBe('SUCCEEDED')
      expect((await sourceOf()).state).toBe('UP_TO_DATE')
      expect(collaboratorCalls('co-a')).toHaveLength(0)
      expect(introspections(SIRET_A)).toHaveLength(1)
      expect(payfitCalls().every((c) => c.method === 'GET' || (c.method === 'POST' && c.tag === 'payfit-introspect'))).toBe(true)
      expect(payfitCalls().some((c) => /\/(contracts|contracts-fr|absences)/.test(c.path))).toBe(false)
      const missing = await ofType('aqoona_nir_unavailable')
      expect(missing).toHaveLength(1)
      expect(missing[0]).toMatchObject({ label: UNAVAILABLE, subject: ALPHA, detail: SCOPE_DETAIL })
      expect(await employees()).toEqual([null, null])
      expect(await modes()).toEqual(['AUCUN', 'AUCUN'])
      expect(volume((await sourceOf()).volumes, 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count: 0 })
      expect(JSON.stringify([await sql('select * from base.payfit_employees order by company_id, employee_id'), await sql('select * from base.payfit_contracts order by company_id, payfit_contract_id')])).toBe(before)
    })

    it('[rule-evp-payfit-scope-checked] each company has its own scope: the company with the scope is read and matched by NIR, the other one cannot be read so what could be its own is not attached; one introspection per company and per reading, whatever the number of rows', async () => {
      introspectScopes(pf, { [SIRET_A]: SCOPE_WITHOUT, [SIRET_B]: SCOPE_WITH })
      setNir(SIRET_A, 'emp-ct-a1', NIR1)
      setNir(SIRET_B, 'emp-ct-b1', NIR2)
      aq.rows([
        nirOnlyRow(d(-3)),
        nirOnlyRow(d(-2)),
        nirOnlyRow(d(-1)),
        pros({ etab: 'Crèche Beta', prenom: 'Prénom', nom: 'Autre', matricule: NIR2, day: d(-3) }),
        pros({ etab: 'Crèche Beta', prenom: 'Prénom', nom: 'Autre', matricule: NIR2, day: d(-2) }),
      ])
      expect((await read()).state).toBe('SUCCEEDED')
      expect(introspections()).toHaveLength(2)
      expect(introspections(SIRET_A)).toHaveLength(1)
      expect(introspections(SIRET_B)).toHaveLength(1)
      expect(introspections().every((c) => c.method === 'POST')).toBe(true)
      expect(collaboratorCalls('co-a')).toHaveLength(0)
      expect(collaboratorCalls('co-b').length).toBeGreaterThanOrEqual(1)
      expect((await ofType('aqoona_nir_unavailable')).map((i: any) => i.subject)).toEqual([ALPHA])
      expect(volume((await sourceOf()).volumes, 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count: 2 })
      expect(new Set((await plannings()).filter((r) => r.creche_code === 'beta').map((r) => r.employee_id))).toEqual(new Set(['emp-ct-b1']))
    })

    it('[rule-evp-payfit-scope-checked] [rule-evp-aqoona-nir-lazy] [rule-evp-nir-key-invalid-unused] without a row whose NIR has a right key, PayFit is not called at all: not even the introspection', async () => {
      aq.rows([pros({ matricule: '', day: d(-3) }), pros({ matricule: BAD1, day: d(-2) }), pros({ matricule: NIR_KO, day: d(-1) }), pros({ matricule: 'MAT-1', day: d(-4) })])
      expect((await read()).state).toBe('SUCCEEDED')
      expect(payfitCalls()).toHaveLength(0)
      expect(await ofType('aqoona_nir_unavailable')).toEqual([])
      expect(await ofType('aqoona_nir_key_invalid')).toHaveLength(1)
    })

    it('[rule-evp-payfit-scope-coverage] [rule-evp-link-network-read] a key without the scope for a company that has no Aqoona row with a NIR is introspected all the same, since the row of another company with a right key makes the whole network read: the anomaly names it and its collaborators are not requested', async () => {
      introspectScopes(pf, { [SIRET_A]: SCOPE_WITHOUT })
      // Alpha: one row without NIR and one row whose NIR has a wrong key (unused); Beta: a row with a right key
      aq.rows([
        pros({ matricule: '', day: d(-3) }),
        pros({ prenom: 'Noé', nom: 'Petit', matricule: BAD1, day: d(-2) }),
        pros({ etab: 'Crèche Beta', prenom: 'Zoé', nom: 'Durand', matricule: NIR2, day: d(-3) }),
      ])
      setNir(SIRET_B, 'emp-ct-b1', NIR2)
      expect((await read()).state).toBe('SUCCEEDED')
      expect(introspections(SIRET_A)).toHaveLength(1)
      expect(collaboratorCalls('co-a')).toHaveLength(0)
      expect(introspections(SIRET_B)).toHaveLength(1)
      expect((await anomaliesOf()).items.filter((i: any) => i.label === UNAVAILABLE).map((i: any) => i.subject)).toEqual([ALPHA])
      // the wrong key is flagged on its own
      const wrong = await ofType('aqoona_nir_key_invalid')
      expect(wrong).toHaveLength(1)
      expect(sameName(wrong[0].subject, 'Noé Petit')).toBe(true)
    })

    it('[rule-evp-payfit-scope-fresh] [rule-evp-payfit-company-id] the scope is introspected at every reading, never served from the cache of the company identifier (filled by a full reading of PayFit): a scope granted or withdrawn is seen at the next reading', async () => {
      setNir(SIRET_A, 'emp-ct-a1', NIR1)
      expect((await refresh(w.rh.token, 'payfit')).state).toBe('SUCCEEDED')
      net.clear()
      aq.rows([nirOnlyRow()])
      await read()
      expect(introspections(SIRET_A)).toHaveLength(1)
      expect(await employees()).toEqual(['emp-ct-a1'])
      expect(await modes()).toEqual(['NIR'])
      await read()
      expect(introspections(SIRET_A)).toHaveLength(2)
      introspectScopes(pf, { [SIRET_A]: SCOPE_WITHOUT })
      await read()
      expect(introspections(SIRET_A)).toHaveLength(3)
      expect((await ofType('aqoona_nir_unavailable')).map((i: any) => i.detail)).toEqual([SCOPE_DETAIL])
      expect(await employees()).toEqual([null])
      introspectScopes(pf)
      await read()
      expect(introspections(SIRET_A)).toHaveLength(4)
      expect(await ofType('aqoona_nir_unavailable')).toEqual([])
      expect(await employees()).toEqual(['emp-ct-a1'])
    })

    it('[rule-evp-payfit-scope-checked] the company identifier and the scope come from the same answer: a single introspection per company in a reading, with the key as bearer', async () => {
      setNir(SIRET_A, 'emp-ct-a1', NIR1)
      aq.rows([nirOnlyRow()])
      expect((await read()).state).toBe('SUCCEEDED')
      // v5: the whole network is read, so each of the two keys is introspected, once
      const calls = introspections(SIRET_A)
      expect(calls).toHaveLength(1)
      expect(calls[0].method).toBe('POST')
      expect(calls[0].headers.authorization).toBe(`Bearer ${payfitKey(SIRET_A)}`)
      expect(introspections(SIRET_B)).toHaveLength(1)
      expect(net.calls('payfit-introspect')).toHaveLength(2)
      // the same answer carries the scope: withdrawn, the next reading introspects once more (one call, no second one for the scope)
      // and does not request the collaborators any more
      const collaboratorsBefore = collaboratorCalls('co-a').length
      expect(collaboratorsBefore).toBeGreaterThanOrEqual(1)
      introspectScopes(pf, { [SIRET_A]: SCOPE_WITHOUT })
      expect((await read()).state).toBe('SUCCEEDED')
      expect(introspections(SIRET_A)).toHaveLength(2)
      expect(net.calls('payfit-introspect')).toHaveLength(4)
      expect(collaboratorCalls('co-a')).toHaveLength(collaboratorsBefore)
      expect((await ofType('aqoona_nir_unavailable')).map((i: any) => i.detail)).toEqual([SCOPE_DETAIL])
    })
  })

  // ───────────────────────────── format de la portée ─────────────────────────────
  describe('format of the scope', () => {
    const attempt = async (scope: unknown): Promise<{ matched: boolean; anomalies: any[] }> => {
      await resetData()
      w = await seedWorld()
      await sql("update base.payfit_contracts set status = 'ACTIVE'")
      introspectScopes(pf, { [SIRET_A]: scope })
      setNir(SIRET_A, 'emp-ct-a1', NIR1)
      aq.rows([nirOnlyRow()])
      expect((await read()).state).toBe('SUCCEEDED')
      return { matched: (await employees())[0] === 'emp-ct-a1', anomalies: await ofType('aqoona_nir_unavailable') }
    }

    it('[rule-evp-payfit-scope-format] the scope is a string of scopes separated by spaces, or an array of strings, compared exactly: all these answers grant the NIR', async () => {
      const granted: unknown[] = [
        SOCIAL_SCOPE,
        SCOPE_WITH,
        `${SOCIAL_SCOPE} collaborators:read`,
        `  collaborators:read   ${SOCIAL_SCOPE}  `,
        ['collaborators:read', SOCIAL_SCOPE],
        [SOCIAL_SCOPE],
      ]
      for (const scope of granted) {
        const result = await attempt(scope)
        expect({ scope, matched: result.matched, anomalies: result.anomalies.length }).toEqual({ scope, matched: true, anomalies: 0 })
      }
      // control: a scope that only looks alike grants nothing (without it, any answer would « grant » the NIR)
      const neighbour = await attempt('collaborators:read contracts:read')
      expect({ matched: neighbour.matched, details: neighbour.anomalies.map((i: any) => i.detail) }).toEqual({ matched: false, details: [SCOPE_DETAIL] })
    })

    it('[rule-evp-payfit-scope-format] an absent, empty or different scope means « scope missing »: no NIR, the anomaly with the scope named; neighbours of the scope do not count (exact comparison, case included)', async () => {
      const missing: unknown[] = [
        ABSENT,
        '',
        '   ',
        [],
        null,
        SCOPE_WITHOUT,
        'collaborators:social-security:write',
        'social-security:read',
        'collaborators:social-security:read:all',
        'collaborators:social-security',
        'xcollaborators:social-security:read',
        'Collaborators:Social-Security:Read',
        ['collaborators:social-security:readonly'],
        [`${SOCIAL_SCOPE}:all`, 'collaborators:read'],
      ]
      for (const scope of missing) {
        const result = await attempt(scope)
        expect({ scope: scope === ABSENT ? 'ABSENT' : scope, matched: result.matched, details: result.anomalies.map((i: any) => i.detail) }).toEqual({
          scope: scope === ABSENT ? 'ABSENT' : scope,
          matched: false,
          details: [SCOPE_DETAIL],
        })
      }
    })

    it('[rule-evp-payfit-scope-format] [rule-evp-payfit-scope-detail] an inactive token or an introspection refused (401, 403, 429, 5xx) means « company unreadable », not « scope missing »: the short sentence, rows not attached, reading SUCCEEDED and not PARTIAL, collaborators never requested', async () => {
      const causes: Array<[string, () => void]> = [
        ['active false', () => introspectScopes(pf, {}, SCOPE_WITH, [SIRET_A])],
        ['401', () => pf.failAlways(SIRET_A, 'introspect', 401)],
        ['403', () => pf.failAlways(SIRET_A, 'introspect', 403)],
        ['429', () => pf.failAlways(SIRET_A, 'introspect', 429)],
        ['500', () => pf.failAlways(SIRET_A, 'introspect', 500)],
        ['503', () => pf.failAlways(SIRET_A, 'introspect', 503)],
      ]
      for (const [cause, arrange] of causes) {
        await resetData()
        pf.reset()
        pf.companies = payfitWorld().companies
        introspectScopes(pf)
        net.clear()
        w = await seedWorld()
        await sql("update base.payfit_contracts set status = 'ACTIVE'")
        arrange()
        setNir(SIRET_A, 'emp-ct-a1', NIR1)
        aq.rows([nirOnlyRow(d(-3)), pros({ matricule: NIR1, day: d(-2) })])
        const run = await read()
        const seen = {
          cause,
          state: run.state,
          source: (await sourceOf()).state,
          details: (await ofType('aqoona_nir_unavailable')).map((i: any) => [i.subject, i.detail]),
          collaborators: collaboratorCalls('co-a').length,
          employees: await employees(),
        }
        expect(seen).toEqual({ cause, state: 'SUCCEEDED', source: 'UP_TO_DATE', details: [[ALPHA, SHORT_DETAIL]], collaborators: 0, employees: [null, null] })
      }
    })

    it('[rule-evp-payfit-scope-detail] [rule-evp-aqoona-nir-unavailable] one company without the scope, one unreachable, one without key in PAYFIT_API_KEYS: three anomalies with the right sentence each, one SIRET each', async () => {
      await seedCompany('co-nokey', '77777777777777', 'Société sans clé')
      await seedCreche('nokey', { name: 'Crèche Sans Clé', siret: '77777777777777' })
      await seedContract('co-nokey', 'ct-nk1', 'Nina', 'Clé')
      introspectScopes(pf, { [SIRET_A]: SCOPE_WITHOUT })
      pf.failAlways(SIRET_B, 'introspect', 500)
      aq.rows([
        pros({ matricule: NIR1, day: d(-3) }),
        pros({ etab: 'Crèche Beta', prenom: 'Zoé', nom: 'Durand', matricule: NIR2, day: d(-3) }),
        pros({ etab: 'Crèche Sans Clé', prenom: 'Nina', nom: 'Clé', matricule: NIR3, day: d(-3) }),
      ])
      const run = await read()
      expect(run.state).toBe('SUCCEEDED')
      expect((await sourceOf()).state).toBe('UP_TO_DATE')
      const items = await ofType('aqoona_nir_unavailable')
      expect(Object.fromEntries(items.map((i: any) => [i.subject, i.detail]))).toEqual({
        [ALPHA]: SCOPE_DETAIL,
        [BETA]: SHORT_DETAIL,
        [companyLabel('Société sans clé', '77777777777777')]: SHORT_DETAIL,
      })
      expect(items.every((i: any) => i.label === UNAVAILABLE)).toBe(true)
      expect(await employees()).toEqual([null, null, null])
    })
  })

  // ───────────────────────────── clé de contrôle des NIR livrés par PayFit ─────────────────────────────
  describe('check key of the NIR delivered by PayFit', () => {
    it('[rule-evp-nir-key-both-sides] [rule-evp-nir-key-payfit-anomaly-source] a collaborator whose NIR has a wrong key is not used: she can no longer be found by her names, she is named in the anomalies of Aqoona (SIRET in the detail), never in those of PayFit; she does not make ambiguous the right NIR of another collaborator', async () => {
      setNir(SIRET_A, 'emp-ct-a1', NIR1)
      setNir(SIRET_A, 'emp-ct-a2', BAD1)
      aq.rows([pros({ prenom: 'Prénom', nom: 'Autre', matricule: NIR1, day: d(-3) }), pros({ prenom: 'Noé', nom: 'Petit', matricule: '', day: d(-2) })])
      expect((await refresh(w.rh.token, 'payfit')).state).toBe('SUCCEEDED')
      expect((await read()).state).toBe('SUCCEEDED')
      expect(await employees()).toEqual(['emp-ct-a1', null])
      expect(await modes()).toEqual(['NIR', 'AUCUN'])
      expect((await ofType('PLANNING_UNMATCHED')).map((i: any) => sameName(i.subject, 'Noé Petit'))).toEqual([true])
      const flagged = await ofType('payfit_nir_key_invalid')
      expect(flagged).toHaveLength(1)
      expect(flagged[0]).toMatchObject({ label: KEY_PAYFIT, subject: 'Noé Petit', detail: PAYFIT_DETAIL(SIRET_A) })
      expect((await anomaliesOf('payfit')).items.filter((i: any) => i.type === 'payfit_nir_key_invalid' || i.label === KEY_PAYFIT)).toEqual([])
      expect((await sourceOf()).state).toBe('UP_TO_DATE')
    })

    it('[rule-evp-nir-key-invalid-unused] the same wrong NIR on both sides is not a match; a NIR of 13 characters is still used and makes no anomaly', async () => {
      setNir(SIRET_A, 'emp-ct-a1', BAD3)
      setNir(SIRET_A, 'emp-ct-a2', NIR1.slice(0, 13))
      aq.rows([pros({ prenom: 'Prénom', nom: 'Autre', matricule: BAD3, day: d(-3) }), pros({ prenom: 'Prénom', nom: 'Autre', matricule: NIR1, day: d(-2) })])
      expect((await read()).state).toBe('SUCCEEDED')
      expect(await employees()).toEqual([null, 'emp-ct-a2'])
      expect(await modes()).toEqual(['AUCUN', 'NIR'])
      expect((await ofType('payfit_nir_key_invalid')).map((i: any) => i.subject)).toEqual(['Léa Martin'])
    })

    it('[rule-evp-nir-key-payfit-anomaly-source] [rule-evp-payfit-scope-no-nir-read] the full reading of PayFit reads no NIR and flags no key; only the reading of Aqoona checks the companies it reads, and since v5 that is the whole network', async () => {
      setNir(SIRET_A, 'emp-ct-a1', BAD1)
      setNir(SIRET_B, 'emp-ct-b1', BAD4)
      expect((await refresh(w.rh.token, 'payfit')).state).toBe('SUCCEEDED')
      expect(await ofType('payfit_nir_key_invalid', 'payfit')).toEqual([])
      expect(await ofType('payfit_nir_key_invalid')).toEqual([])
      net.clear() // the full PayFit reading introspects every company (rule-evp-payfit-company-id); only the Aqoona reading is counted below
      aq.rows([pros({ prenom: 'Noé', nom: 'Petit', matricule: NIR3, day: d(-3) })])
      expect((await read()).state).toBe('SUCCEEDED')
      expect((await ofType('payfit_nir_key_invalid')).map((i: any) => i.subject).sort()).toEqual(['Léa Martin', 'Zoé Durand'])
      expect(introspections(SIRET_B)).toHaveLength(1)
    })
  })

  // ───────────────────────────── confidentialité ─────────────────────────────
  describe('confidentiality', () => {
    it('[rule-evp-nir-key-never-shown] [rule-evp-aqoona-nir-never-stored] [rule-evp-secrets-never-exposed] with NIR of right and wrong keys on both sides, a missing scope and an upstream error echoing the key: no NIR, no key, no introspection answer anywhere (answers, tables, anomalies, rates, server log)', async () => {
      const offset = logSize()
      introspectScopes(pf, { [SIRET_B]: SCOPE_WITHOUT })
      setNir(SIRET_A, 'emp-ct-a1', BAD1)
      setNir(SIRET_A, 'emp-ct-a2', NIR3)
      setNir(SIRET_B, 'emp-ct-b1', NIR2)
      aq.rows([
        pros({ prenom: 'Prénom', nom: 'Différent', matricule: BAD1, day: d(-5) }),
        pros({ prenom: 'Noé', nom: 'Petit', matricule: NIR3, day: d(-4) }),
        pros({ prenom: 'Noé', nom: 'Petit', matricule: BAD4, day: d(-3) }),
        pros({ etab: 'Crèche Beta', prenom: 'Zoé', nom: 'Durand', matricule: NIR2, day: d(-2) }),
        pros({ etab: 'Crèche Beta', prenom: 'Zoé', nom: 'Durand', matricule: NIR_KO, day: d(-1) }),
      ])
      expect((await refresh(w.rh.token, 'payfit')).state).toBe('SUCCEEDED')
      const run = await read()
      expect(run.state).toBe('SUCCEEDED')
      const all = await everythingV4(w.rh.token)
      expectNoNir('visible', all, V4_NIRS)
      expectNoNir('run', JSON.stringify(run), V4_NIRS)
      expectNoNir('server log', logSince(offset), V4_NIRS)
      expectNoSecret('visible', all)
      expectNoSecret('server log', logSince(offset))
      expect(logSince(offset)).not.toContain('fake-client')
      const items = [...(await anomaliesOf('aqoona')).items, ...(await anomaliesOf('payfit')).items]
      expectNoLongDigits('anomalies', JSON.stringify(items.map((i: any) => [i.type, i.label, i.subject, i.detail])))
      expect(items.some((i: any) => i.type === 'aqoona_nir_key_invalid')).toBe(true)
      expect(items.some((i: any) => i.type === 'payfit_nir_key_invalid')).toBe(true)
      expect(items.some((i: any) => i.type === 'aqoona_nir_unavailable' && i.detail === SCOPE_DETAIL && i.subject === BETA)).toBe(true)
      const rates = await ratesOf(w.rh.token)
      expect(rates.status).toBe(200)
      expect(rates.body.available).toBe(true)
      expectNoNir('rates', rates.text, V4_NIRS)
    })
  })

  // ───────────────────────────── taux de rattachement face à une lecture réelle ─────────────────────────────
  describe('rates after a real reading', () => {
    it('[rule-evp-matching-rates-consistency] [rule-evp-matching-rates-people] the rates describe the reading just made, in persons: linked when the scope allows the NIR, unlinked otherwise', async () => {
      introspectScopes(pf, { [SIRET_B]: SCOPE_WITHOUT })
      setNir(SIRET_A, 'emp-ct-a1', NIR1)
      setNir(SIRET_B, 'emp-ct-b1', NIR2)
      aq.rows([
        nirOnlyRow(d(-3)),
        pros({ prenom: 'Noé', nom: 'Petit', matricule: '', day: d(-3) }),
        pros({ prenom: 'Inconnue', nom: 'Total', matricule: '', day: d(-3) }),
        pros({ etab: 'Crèche Beta', prenom: 'Zoé', nom: 'Durand', matricule: NIR2, day: d(-3) }),
      ])
      const run = await read()
      expect(run.state).toBe('SUCCEEDED')
      const res = await ratesOf(w.rh.token)
      expect(res.status).toBe(200)
      expect(res.body.available).toBe(true)
      // company A: Léa (NIR) linked; Noé and Inconnue Total (no NIR) unlinked. Company B: Zoé's NIR cannot be checked (no scope): unlinked
      expect(rateOfCompany(res.body.items, 'co-a')).toMatchObject({ total: 3, linked: { count: 1 }, unlinked: { count: 2 } })
      expect(rateOfCompany(res.body.items, 'co-b')).toMatchObject({ total: 1, linked: { count: 0 }, unlinked: { count: 1 } })
      expect(volume(run.volumes, 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count: 1 })
      expect(volume(run.volumes, 'Plannings lus')).toEqual({ label: 'Plannings lus', count: 4 })
    })
  })
})
