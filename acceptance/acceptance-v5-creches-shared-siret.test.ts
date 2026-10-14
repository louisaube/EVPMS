import { resetData, closePool, sql } from './harness'
import { GET, qs, seedWorld, seedAccount, seedCreche, seedContract, World, Account, Contract, closeEvp, clearFixtures, SIRET_A } from './evp-helpers'
import { NIR1, NIR2, NIR3, d, kit, link, payfitWith, row, slots } from './v5-helpers'

// Acceptance suite of version v5-evp-rattachement-nir, part 5: the contracts offered by the crèches that share a SIRET
// (rule-evp-siret-shared-contracts, v3) when the collaborator of a slot may belong to another company than the crèche (floating
// employee): the identifier of a collaborator of another company is never taken for the one of an employee of the company.
// Default API variant (fake sources).
describe('Crèches sharing a SIRET and floating employees (v5-evp-rattachement-nir)', () => {
  let w: World
  let alpha2: Account
  let camille: Contract
  const { readAqoona } = kit(() => w)

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

  const setStatus = (contractId: string, status: string) => sql('update base.payfit_contracts set status = $2 where id = $1', [contractId, status])
  const names = (res: { body: any }): string[] => res.body.items.map((i: any) => i.employeeName).sort()
  const contracts = (code: string, token: string, query: Record<string, string | number> = {}) => GET(`/creches/${code}/contracts${qs(query)}`, token)

  /** Alpha and Alpha Deux share the SIRET of company A (co-a); Camille Dupont is a third employee of company A (emp-ct-a3). */
  async function shareSiret() {
    await seedCreche('alpha2', { name: 'Crèche Alpha Deux', siret: SIRET_A, directriceName: 'Dora Deux', roNames: [] })
    alpha2 = await seedAccount('DIRECTRICE', { name: 'Dora Deux', creches: ['alpha2'] })
    camille = await seedContract('co-a', 'ct-a3', 'Camille', 'Dupont')
    await setStatus(camille.id, 'ACTIVE')
  }
  const camilleFixture = { companyId: 'co-a', id: 'emp-ct-a3', firstName: 'Camille', lastName: 'Dupont' }
  const camilleContract = { companyId: 'co-a', id: 'ct-a3', employeeId: 'emp-ct-a3', startDate: '2020-01-01', endDate: null }

  it('[rule-evp-siret-shared-contracts] a collaborator of company A attached by NIR to a slot of the first crèche only is offered there and not at the second; a person seen at no slot is offered to both', async () => {
    await shareSiret()
    payfitWith({ 'emp-ct-a3': NIR3 }, { employees: [camilleFixture], contracts: [camilleContract] })
    await readAqoona([row({ firstName: 'Prénom', lastName: 'Autre', matricule: NIR3, crecheName: 'Crèche Alpha' })])
    expect((await slots()).map(link)).toEqual([['co-a', 'alpha', 'co-a', 'emp-ct-a3', 'NIR', null]])
    expect(names(await contracts('alpha', w.dirA.token, { search: 'Camille' }))).toEqual(['Camille Dupont'])
    expect((await contracts('alpha2', alpha2.token, { search: 'Camille' })).body.items).toEqual([])
    // Léa and Noé have no slot at all: they are offered to each crèche of the SIRET
    for (const [code, token] of [['alpha', w.dirA.token], ['alpha2', alpha2.token]] as const) {
      expect(names(await contracts(code, token))).toEqual(expect.arrayContaining(['Léa Martin', 'Noé Petit']))
    }
  })

  it('[rule-evp-link-nir-only] [rule-evp-siret-shared-contracts] a slot read with the name of a collaborator but without NIR is not attached to her, so it excludes her from nothing: she is offered to each crèche of the SIRET', async () => {
    await shareSiret()
    payfitWith({ 'emp-ct-a3': NIR3 }, { employees: [camilleFixture], contracts: [camilleContract] })
    await readAqoona([row({ firstName: 'Camille', lastName: 'Dupont', matricule: null, crecheName: 'Crèche Alpha' })])
    expect((await slots()).map((s) => s.employee_id)).toEqual([null])
    for (const [code, token] of [['alpha', w.dirA.token], ['alpha2', alpha2.token]] as const) {
      expect({ code, names: names(await contracts(code, token, { search: 'Camille' })) }).toEqual({ code, names: ['Camille Dupont'] })
    }
  })

  it('[rule-evp-siret-shared-contracts] [rule-evp-link-one-establishment] a floating employee of company B read in a crèche of company A whose identifier is the same as an employee of company A is never taken for her: the employee of company A is not excluded from the first crèche', async () => {
    await shareSiret()
    // company B has an employee with the very identifier of Camille (emp-ct-a3): a floating employee, read at Crèche Alpha Deux
    const valerie = await seedContract('co-b', 'ct-a3', 'Valérie', 'Volante')
    await setStatus(valerie.id, 'ACTIVE')
    payfitWith(
      { 'co-b/emp-ct-a3': NIR2 },
      {
        employees: [camilleFixture, { companyId: 'co-b', id: 'emp-ct-a3', firstName: 'Valérie', lastName: 'Volante' }],
        contracts: [camilleContract, { companyId: 'co-b', id: 'ct-a3', employeeId: 'emp-ct-a3', startDate: '2020-01-01', endDate: null }],
      },
    )
    await readAqoona([row({ firstName: 'Valérie', lastName: 'Volante', matricule: NIR2, crecheName: 'Crèche Alpha Deux' })])
    expect((await slots()).map(link)).toEqual([['co-a', 'alpha2', 'co-b', 'emp-ct-a3', 'NIR', null]])
    for (const [code, token] of [['alpha', w.dirA.token], ['alpha2', alpha2.token]] as const) {
      expect({ code, names: names(await contracts(code, token, { search: 'Camille' })) }).toEqual({ code, names: ['Camille Dupont'] })
    }
    // the floating employee of company B is not a contract of company A: she is offered nowhere here
    for (const [code, token] of [['alpha', w.dirA.token], ['alpha2', alpha2.token]] as const) {
      expect({ code, names: names(await contracts(code, token, { search: 'Volante' })) }).toEqual({ code, names: [] })
    }
  })

  it('[rule-evp-siret-shared-contracts] [rule-evp-link-network-wide] a floating employee of company A read in a crèche of another SIRET is not excluded from the contracts offered by the crèches sharing the SIRET of her company', async () => {
    await shareSiret()
    payfitWith({ 'emp-ct-a1': NIR1 })
    await readAqoona([row({ matricule: NIR1, crecheName: 'Crèche Beta', day: d(-2) })])
    expect((await slots()).map(link)).toEqual([['co-b', 'beta', 'co-a', 'emp-ct-a1', 'NIR', null]])
    for (const [code, token] of [['alpha', w.dirA.token], ['alpha2', alpha2.token]] as const) {
      expect({ code, names: names(await contracts(code, token, { search: 'Martin' })) }).toEqual({ code, names: ['Léa Martin'] })
    }
    expect((await contracts('alpha', w.dirA.token)).body.planningRestricted).toBe(true)
  })

  it('[rule-evp-siret-shared-contracts] a floating employee of company A read in a crèche of company A and in another SIRET: excluded from the other crèche of her SIRET only because of the slot read in a crèche of her SIRET', async () => {
    await shareSiret()
    payfitWith({ 'emp-ct-a3': NIR3 }, { employees: [camilleFixture], contracts: [camilleContract] })
    await readAqoona([
      row({ firstName: 'Prénom', lastName: 'Autre', matricule: NIR3, crecheName: 'Crèche Alpha', day: d(-3) }),
      row({ firstName: 'Prénom', lastName: 'Autre', matricule: NIR3, crecheName: 'Crèche Beta', day: d(-2) }),
    ])
    expect((await slots()).map(link)).toEqual([
      ['co-a', 'alpha', 'co-a', 'emp-ct-a3', 'NIR', null],
      ['co-b', 'beta', 'co-a', 'emp-ct-a3', 'NIR', null],
    ])
    expect(names(await contracts('alpha', w.dirA.token, { search: 'Camille' }))).toEqual(['Camille Dupont'])
    expect((await contracts('alpha2', alpha2.token, { search: 'Camille' })).body.items).toEqual([])
  })

  it('[rule-evp-siret-shared-contracts] the route keeps its guards: 401 anonymous, 403 ADMINISTRATRICE, 404 for a crèche outside the perimeter or unknown (same answer)', async () => {
    await shareSiret()
    // a slot attached by NIR (v5) restricts the second crèche of the SIRET, and the guards hold all the same
    payfitWith({ 'emp-ct-a3': NIR3 }, { employees: [camilleFixture], contracts: [camilleContract] })
    await readAqoona([row({ firstName: 'Prénom', lastName: 'Autre', matricule: NIR3, crecheName: 'Crèche Alpha' })])
    expect((await slots()).map(link)).toEqual([['co-a', 'alpha', 'co-a', 'emp-ct-a3', 'NIR', null]])
    expect((await contracts('alpha2', alpha2.token, { search: 'Camille' })).body.items).toEqual([])
    expect((await GET('/creches/alpha/contracts')).status).toBe(401)
    expect((await contracts('alpha', w.adm.token)).status).toBe(403)
    expect((await contracts('alpha', w.dirA.token)).status).toBe(200)
    const foreign = await contracts('alpha2', w.dirA.token)
    const unknown = await contracts('zzz', w.dirA.token)
    expect([foreign.status, unknown.status]).toEqual([404, 404])
    expect(foreign.body).toEqual(unknown.body)
  })
})
