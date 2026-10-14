import jwt from 'jsonwebtoken'
import { getConfig } from '../../../platform/config/config'
import { call, closePool, resetData, sql } from '../../../platform/testing/helpers'

const SIRET_SHARED = '11111111111111'
const SIRET_ALONE = '22222222222222'

describe('GET /creches/:code/contracts', () => {
  let token: string

  const get = async (code: string, query = '') => {
    const res = await call(`/creches/${code}/contracts${query}`, { headers: { authorization: `Bearer ${token}` } })
    return { status: res.status, body: await res.json() }
  }
  const names = (body: any): string[] => body.items.map((i: any) => i.employeeName)

  async function creche(code: string, siret: string, verified = true): Promise<void> {
    await sql('insert into base.creches (code, name, siret, verified, scope_code) values ($1, $1, $2, $3, $1)', [code, siret, verified])
  }
  async function contract(companyId: string, id: string, first: string, last: string, status = 'ACTIVE'): Promise<void> {
    await sql('insert into base.payfit_employees (company_id, employee_id, first_name, last_name) values ($1, $2, $3, $4) on conflict do nothing', [
      companyId,
      `emp-${id}`,
      first,
      last,
    ])
    await sql(
      "insert into base.payfit_contracts (company_id, payfit_contract_id, employee_id, start_date, status) values ($1, $2, $3, '2024-01-01', $4)",
      [companyId, id, `emp-${id}`, status],
    )
  }
  /** `companyId` is the company of the crèche read; `employeeCompany` the company of reference of the collaborator (rule-evp-link-one-establishment). */
  async function planning(companyId: string, employeeId: string, crecheCode: string | null, start = '08:00', employeeCompany = companyId): Promise<void> {
    await sql(
      `insert into base.aqoona_plannings (person_ref, creche_code, company_id, employee_company_id, employee_id, day, start_time, end_time)
       values ('X', $1, $2, $5, $3, current_date, $4, '17:00')`,
      [crecheCode, companyId, employeeId, start, employeeCompany],
    )
  }

  beforeEach(async () => {
    await resetData()
    const [user] = await sql<{ id: string }>("insert into base.users (email, role) values ('rh@micro-stars.fr', 'user') returning id")
    await sql("insert into base.credentials (user_id, password, type) values ($1, 'x', 'token')", [user.id])
    await sql("insert into base.evp_accounts (user_id, name, email, role) values ($1, 'RH', 'rh@micro-stars.fr', 'RH')", [user.id])
    token = jwt.sign({ role: 'user', sv: 0 }, getConfig().jwtSecret, { algorithm: 'HS256', subject: user.id, expiresIn: 3600 })
    await sql("insert into base.payfit_companies (id, siret, name) values ('co-shared', $1, 'Partagée'), ('co-alone', $2, 'Seule')", [SIRET_SHARED, SIRET_ALONE])
    await creche('alpha', SIRET_SHARED)
    await creche('beta', SIRET_SHARED)
    await creche('solo', SIRET_ALONE)
  })
  afterAll(closePool)

  it('[rule-evp-declare-contracts-not-archived] [rule-evp-declare-contracts-status] ACTIVE and PENDING are proposed, ARCHIVED never', async () => {
    await contract('co-alone', 'c-active', 'Ada', 'Active')
    await contract('co-alone', 'c-pending', 'Bea', 'Pending', 'PENDING')
    await contract('co-alone', 'c-archived', 'Cleo', 'Archived', 'ARCHIVED')
    const { status, body } = await get('solo')
    expect(status).toBe(200)
    expect(names(body)).toEqual(['Ada Active', 'Bea Pending'])
  })

  it('[rule-evp-declare-contracts-status] the filter applies before the limit of 20 and before the search', async () => {
    for (let i = 0; i < 21; i++) await contract('co-alone', `c-arch-${i}`, 'A', `Archivee${String(i).padStart(2, '0')}`, 'ARCHIVED')
    await contract('co-alone', 'c-live', 'Zoe', 'Zzz')
    expect(names((await get('solo')).body)).toEqual(['Zoe Zzz'])
    expect(names((await get('solo', '?search=Archivee')).body)).toEqual([])
    expect(names((await get('solo', '?search=Zzz')).body)).toEqual(['Zoe Zzz'])
  })

  it('[rule-evp-declare-contracts-list-only] a crèche alone on its SIRET keeps the whole company and planningRestricted is false', async () => {
    await contract('co-alone', 'c1', 'Ada', 'Un')
    await planning('co-alone', 'emp-c1', 'solo')
    const { body } = await get('solo')
    expect(body.planningRestricted).toBe(false)
    expect(names(body)).toEqual(['Ada Un'])
  })

  it('[rule-evp-siret-shared-contracts] [rule-evp-siret-shared-contracts-flag] an employee seen only at the planning of the other crèche of the SIRET is left out; the flag is true for both', async () => {
    await contract('co-shared', 'c-camille', 'Camille', 'Alpha')
    await contract('co-shared', 'c-bruno', 'Bruno', 'Beta')
    await planning('co-shared', 'emp-c-camille', 'alpha')
    await planning('co-shared', 'emp-c-bruno', 'beta')
    const alpha = await get('alpha')
    const beta = await get('beta')
    expect(names(alpha.body)).toEqual(['Camille Alpha'])
    expect(names(beta.body)).toEqual(['Bruno Beta'])
    expect(alpha.body.planningRestricted).toBe(true)
    expect(beta.body.planningRestricted).toBe(true)
  })

  it('[rule-evp-siret-shared-contracts] seen at both crèches, she is proposed at both', async () => {
    await contract('co-shared', 'c1', 'Camille', 'Deux')
    await planning('co-shared', 'emp-c1', 'alpha')
    await planning('co-shared', 'emp-c1', 'beta', '09:00')
    expect(names((await get('alpha')).body)).toEqual(['Camille Deux'])
    expect(names((await get('beta')).body)).toEqual(['Camille Deux'])
  })

  it('[rule-evp-siret-shared-contracts-visible] an employee seen nowhere is proposed at both crèches; Aqoona never read means the list is not restricted', async () => {
    await contract('co-shared', 'c1', 'Nina', 'Nulle')
    await contract('co-shared', 'c2', 'Omar', 'Autre')
    for (const code of ['alpha', 'beta']) {
      const { body } = await get(code)
      expect(names(body)).toEqual(['Omar Autre', 'Nina Nulle'])
      expect(body.planningRestricted).toBe(true)
    }
    await planning('co-shared', 'emp-c2', 'beta')
    expect(names((await get('alpha')).body)).toEqual(['Nina Nulle'])
  })

  it('[rule-evp-siret-shared-contracts] a planning without crèche or attached to another company has no effect', async () => {
    await contract('co-shared', 'c1', 'Pia', 'Libre')
    await planning('co-shared', 'emp-c1', null)
    await planning('co-alone', 'emp-c1', 'solo')
    expect(names((await get('alpha')).body)).toEqual(['Pia Libre'])
    expect(names((await get('beta')).body)).toEqual(['Pia Libre'])
  })

  it('[rule-evp-link-one-establishment] [rule-evp-siret-shared-contracts] a floating employee of the shared company read in a crèche of another SIRET is not excluded from the contracts proposed by the crèches of her company', async () => {
    await contract('co-shared', 'c1', 'Vera', 'Volante')
    await planning('co-alone', 'emp-c1', 'solo', '08:00', 'co-shared')
    expect(names((await get('alpha')).body)).toEqual(['Vera Volante'])
    expect(names((await get('beta')).body)).toEqual(['Vera Volante'])
  })

  it('[rule-evp-link-one-establishment] [rule-evp-siret-shared-contracts] the identifier of a collaborator of another company, read in a crèche of the shared SIRET, is never taken for the one of an employee of the company', async () => {
    await contract('co-shared', 'c1', 'Sam', 'Salariée')
    await planning('co-shared', 'emp-c1', 'beta', '08:00', 'co-alone')
    expect(names((await get('alpha')).body)).toEqual(['Sam Salariée'])
    expect(names((await get('beta')).body)).toEqual(['Sam Salariée'])
    await planning('co-shared', 'emp-c1', 'beta', '09:00')
    expect(names((await get('alpha')).body)).toEqual([])
    expect(names((await get('beta')).body)).toEqual(['Sam Salariée'])
  })

  it('[rule-evp-siret-shared-contracts] the exclusion applies before the limit of 20 and before the search', async () => {
    for (let i = 0; i < 21; i++) {
      await contract('co-shared', `x-${i}`, 'A', `Exclue${String(i).padStart(2, '0')}`)
      await planning('co-shared', `emp-x-${i}`, 'beta', `${String(i % 10).padStart(2, '0')}:${String(i).padStart(2, '0')}`)
    }
    await contract('co-shared', 'c-ok', 'Zoe', 'Zzz')
    expect(names((await get('alpha')).body)).toEqual(['Zoe Zzz'])
    expect(names((await get('alpha', '?search=Exclue')).body)).toEqual([])
  })

  it('[rule-evp-siret-shared-creches] a crèche that is not verified does not make the other one restricted', async () => {
    await sql("update base.creches set verified = false where code = 'beta'")
    await contract('co-shared', 'c1', 'Ruth', 'Une')
    const { body } = await get('alpha')
    expect(body.planningRestricted).toBe(false)
    expect(names(body)).toEqual(['Ruth Une'])
  })

  it('a crèche without a single PayFit company gets an empty list with planningRestricted present', async () => {
    await creche('orphan', '33333333333333')
    const { status, body } = await get('orphan')
    expect(status).toBe(200)
    expect(body).toEqual({ items: [], planningRestricted: false })
  })

  it('an unknown crèche is 404, no session is 401', async () => {
    expect((await get('nope')).status).toBe(404)
    expect((await call('/creches/alpha/contracts')).status).toBe(401)
  })
})
