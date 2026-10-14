import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { getConfig } from '../../../platform/config/config'
import * as schema from '../../../platform/database/schema'
import { closePool, resetData, sql } from '../../../platform/testing/helpers'
import { SourceReaders } from '../source-readers'
import type { AqoonaData, AqoonaRow, PayfitNirs } from '../source-connectors'

// Fictitious numbers: NIR_OK has a right key (23), NIR_KO the same 13 digits with a wrong one.
const NIR_OK = '285057512345623'
const NIR_KO = '285057512345624'
const SIRET_1 = '11111111111111'
const WINDOW = { from: '2026-09-14', to: '2026-11-16' }

const pool = new Pool({ connectionString: getConfig().databaseUrl, max: 2 })
const readers = new SourceReaders(drizzle(pool, { schema }) as never)

const row = (over: Partial<AqoonaRow> = {}): AqoonaRow => ({
  firstName: 'Léa',
  lastName: 'Martin',
  matricule: '',
  crecheName: 'Alpha',
  day: '2026-10-01',
  start: '08:00',
  end: '12:00',
  type: 'Garde',
  addressLabel: 'Aqoona Pros',
  ...over,
})
const data = (rows: AqoonaRow[]): AqoonaData => ({
  rows,
  unusable: 0,
  slotTypes: { GARDE: ['garde'] },
  addresses: [{ label: 'Aqoona Pros', ok: true, unusable: 0 }],
})
const network = async (): Promise<PayfitNirs> =>
  new Map([[SIRET_1, { status: 'ok' as const, table: new Map([[NIR_OK, [{ companyId: 'co1', employeeId: 'e-lea' }]]]), invalid: [] }]])
const modes = async () => (await sql<{ m: string }>('select match_method as m from base.aqoona_plannings order by day, start_time')).map((r) => r.m)

describe('stored mode of a slot (applyAqoona)', () => {
  beforeEach(async () => {
    await resetData()
    await sql("insert into base.payfit_companies (id, siret, name) values ('co1', $1, 'Un')", [SIRET_1])
    await sql("insert into base.creches (code, name, siret, verified, scope_code) values ('alpha', 'Alpha', $1, true, 'alpha')", [SIRET_1])
    await sql("insert into base.payfit_employees (company_id, employee_id, first_name, last_name) values ('co1', 'e-lea', 'Léa', 'Martin')")
  })
  afterAll(async () => {
    await closePool()
    await pool.end()
  })

  it('[rule-evp-aqoona-nir-never-stored] [rule-evp-link-nir-only] the reading writes NIR or AUCUN only, never NOM or INCONNU, whatever the names', async () => {
    await readers.applyAqoona(
      data([
        row({ firstName: 'Autre', lastName: 'Nom', matricule: NIR_OK, day: '2026-10-01' }),
        row({ day: '2026-10-02' }),
        row({ firstName: 'Inconnue', lastName: 'Personne', matricule: NIR_KO, day: '2026-10-03' }),
      ]),
      WINDOW,
      network,
    )
    expect(await modes()).toEqual(['NIR', 'AUCUN', 'AUCUN'])
  })

  it('[rule-evp-matching-method-first-row] a duplicate keeps the mode of the first row retained', async () => {
    await readers.applyAqoona(data([row({ matricule: NIR_OK }), row()]), WINDOW, network)
    expect(await modes()).toEqual(['NIR'])
    await readers.applyAqoona(data([row(), row({ matricule: NIR_OK })]), WINDOW, network)
    expect(await modes()).toEqual(['AUCUN'])
  })

  it('[rule-evp-aqoona-nir-never-stored] the checks of the table: modes NIR, NOM, AUCUN, INCONNU (NOM only for rows of before v5), the causes, and a collaborator company only with a collaborator', async () => {
    const insert = (columns: string, values: string) =>
      sql(`insert into base.aqoona_plannings (person_ref, day, start_time, end_time, ${columns}) values ('X', current_date, '08:00', '09:00', ${values})`)
    await insert('match_method', "'NOM'")
    await expect(insert('match_method', "'AUTRE'")).rejects.toThrow()
    await expect(insert('unlinked_cause', "'NIR_BIDON'")).rejects.toThrow()
    await expect(insert('employee_id', "'e1'")).rejects.toThrow()
    await expect(insert('employee_company_id', "'co1'")).rejects.toThrow()
    await sql('delete from base.aqoona_plannings')
    await insert('employee_id, employee_company_id', "'e1', 'co1'")
  })
})
