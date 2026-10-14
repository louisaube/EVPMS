import { resetData, closePool, sql } from './harness'
import { GET, seedWorld, seedCreche, World, closeEvp, refresh, countRows, SIRET_A } from './evp-helpers'
import { FakeNet, PayfitFake, PfCompany, d, describeStandard, payfitKey, payfitWorld } from './v2-helpers'
import { introspectScopes } from './v4-helpers'
import { NIR1, ProsFake, bulkSirets, pros, withNir } from './v3-helpers'

// Acceptance suite of version v3-evp-acces-contrats-siret: the network counts more than 35 SIRET, hence more than 35 PayFit
// keys; the reading takes them one company at a time, with no limit of its own, an isolated failure being a partial
// reading. API of the variant `pros` (40 keys in PAYFIT_API_KEYS). A person on several SIRET is one collaborator per company.
describeStandard('PayFit reading with more than 35 keys (v3-evp-acces-contrats-siret)', () => {
  const net = new FakeNet()
  const aq = new ProsFake()
  let pf: PayfitFake
  let w: World
  let sirets: string[] = []

  const bulkCompany = (siret: string, rank: number): PfCompany => {
    const n = String(rank).padStart(4, '0')
    return {
      siret,
      key: payfitKey(siret),
      companyId: `co-bulk-${n}`,
      name: `Société Bulk ${n}`,
      collaborators: [{ id: `emp-bulk-${n}`, firstName: 'Prénom', lastName: `Bulk${n}` }],
      contracts: [{ contractId: `ct-bulk-${n}`, collaboratorId: `emp-bulk-${n}`, startDate: '2020-01-01', endDate: null }],
      absences: [],
    }
  }

  beforeAll(async () => {
    pf = payfitWorld()
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
    net.clear()
    pf.reset()
    aq.reset()
    w = await seedWorld()
    sirets = bulkSirets()
    expect(sirets).toHaveLength(38)
    pf.companies = [...payfitWorld().companies, ...sirets.map((s, i) => bulkCompany(s, i + 1))]
    introspectScopes(pf) // v4 checks the scope before reading NIR (rule-evp-payfit-scope-checked): the double grants collaborators:social-security:read
    for (const [i, siret] of sirets.entries()) await seedCreche(`bulk${String(i + 1).padStart(2, '0')}`, { name: `Crèche Bulk ${i + 1}`, siret })
  })

  const sourceOf = async () => (await GET('/sources', w.rh.token)).body.items.find((i: any) => i.key === 'payfit')
  const collaboratorCalls = () => net.calls('payfit').filter((r) => /\/collaborators$/.test(r.path))

  /**
   * Ancre sur v3 : avec les quarante clés configurées, le NIR d'une ligne Aqoona « Pros » est cherché dans la bonne société
   * (la lecture Aqoona n'interroge que la société de la crèche de la ligne) et l'emporte sur des noms différents. Absent
   * de v2 ; les tests ci-dessous l'appellent EN DERNIER pour ne pas passer avant le code de v3 (la règle `many-keys`
   * elle-même ne change pas : la v2 lisait déjà toutes les clés déclarées).
   */
  async function expectNirLookupAmongForty(): Promise<void> {
    const company = pf.company(SIRET_A)
    company.collaborators = company.collaborators.map((c) => (c.id === 'emp-ct-a1' ? (withNir(c, NIR1) as any) : c))
    aq.rows([pros({ prenom: 'Prénom', nom: 'Différent', matricule: NIR1, day: d(-3) })])
    const run = await refresh(w.rh.token, 'aqoona')
    expect(run.state).toBe('SUCCEEDED')
    expect(run.volumes.find((v: any) => v.label === 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count: 1 })
  }

  it('[rule-evp-payfit-many-keys] forty keys are read, one company at a time, with no limit of the application: forty companies, all their collaborators and contracts, a complete reading', async () => {
    const run = await refresh(w.rh.token, 'payfit')
    expect(run.state).toBe('SUCCEEDED')
    expect((await sourceOf()).state).not.toBe('PARTIAL')
    expect(await countRows('payfit_companies')).toBe(40)
    expect(await countRows('payfit_employees')).toBe(41)
    expect(await countRows('payfit_contracts')).toBe(41)
    expect(new Set(collaboratorCalls().map((r) => r.path)).size).toBe(40)
    await expectNirLookupAmongForty()
  })

  it('[rule-evp-payfit-many-keys] [rule-evp-sources-partial-failure] one company of the forty failing is a partial reading: the thirty-nine others are read, the failure is an anomaly', async () => {
    pf.failAlways(sirets[16], 'collaborators', 500)
    const run = await refresh(w.rh.token, 'payfit')
    expect(run.state).toBe('SUCCEEDED')
    expect((await sourceOf()).state).toBe('PARTIAL')
    expect(await countRows('payfit_companies')).toBe(39)
    expect(await countRows('payfit_contracts', "company_id <> 'co-bulk-0017'")).toBe(40)
    expect(await countRows('payfit_contracts', "company_id = 'co-bulk-0017'")).toBe(0)
    const anomalies = (await GET('/sources/payfit/anomalies?size=50', w.rh.token)).body
    expect(anomalies.items.map((a: any) => a.label)).toContain('Société inaccessible')
    expect(JSON.stringify(anomalies)).not.toMatch(/test-payfit-key/)
    await expectNirLookupAmongForty()
  })

  it('[rule-evp-payfit-many-keys] the companies are read one at a time: requests of two companies never overlap', async () => {
    const slow = [sirets[0], sirets[1], sirets[2]]
    for (const siret of slow) pf.failAlways(siret, 'collaborators', { delayMs: 300 })
    const run = await refresh(w.rh.token, 'payfit')
    expect(run.state).toBe('SUCCEEDED')
    const starts = collaboratorCalls()
      .filter((r) => /co-bulk-000[123]\/collaborators$/.test(r.path))
      .map((r) => r.at)
      .sort((a, b) => a - b)
    expect(starts).toHaveLength(3)
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(250)
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(250)
    await expectNirLookupAmongForty()
  })

  it('[rule-evp-employee-multi-company] a person who works on two SIRET is one collaborator per company, never merged by name: two employees, two contracts, each under its own company', async () => {
    pf.company(sirets[0]).collaborators = [{ id: 'emp-lea-bulk', firstName: 'Léa', lastName: 'Martin' }]
    pf.company(sirets[0]).contracts = [{ contractId: 'ct-lea-bulk', collaboratorId: 'emp-lea-bulk', startDate: '2022-01-01', endDate: null }]
    const run = await refresh(w.rh.token, 'payfit')
    expect(run.state).toBe('SUCCEEDED')
    const lea = await sql("select company_id, employee_id from base.payfit_employees where first_name = 'Léa' and last_name = 'Martin' order by company_id")
    expect(lea).toEqual([
      { company_id: 'co-a', employee_id: 'emp-ct-a1' },
      { company_id: 'co-bulk-0001', employee_id: 'emp-lea-bulk' },
    ])
    expect(await countRows('payfit_contracts', "employee_id in ('emp-ct-a1', 'emp-lea-bulk')")).toBe(2)
    expect(await countRows('payfit_contracts', "company_id = 'co-bulk-0001' and employee_id = 'emp-ct-a1'")).toBe(0)
    await expectNirLookupAmongForty()
  })
})
