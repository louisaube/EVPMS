import { Pool } from 'pg'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getConfig } from '../../../platform/config/config'
import { call, closePool, resetData } from '../../../platform/testing/helpers'

const resolve = (doc: any, schema: any): any => (schema?.$ref ? resolve(doc, schema.$ref.split('/').slice(1).reduce((node: any, key: string) => node?.[key], doc)) : schema)

describe('contract of the people routes (OpenAPI generated from the Zod schemas)', () => {
  let doc: any
  beforeAll(async () => {
    doc = await (await call('/api-json')).json()
  })

  it('[rule-evp-matching-rates-people] the rates are in people: linked and unlinked parts, bounds of the request', () => {
    const operation = doc.paths['/sources/aqoona/matching-rates'].get
    const schema = resolve(doc, operation.responses['200'].content['application/json'].schema)
    expect(Object.keys(schema.properties).sort()).toEqual(['available', 'items', 'lastReadAt', 'windowFrom', 'windowTo'])
    expect(schema.properties.items.maxItems).toBe(200)
    const item = resolve(doc, schema.properties.items.items)
    expect(Object.keys(item.properties).sort()).toEqual(['companyId', 'linked', 'name', 'siret', 'total', 'unlinked'])
    expect(item.properties.total.minimum).toBe(1)
    const part = resolve(doc, item.properties.linked)
    expect(part.properties.count.minimum).toBe(0)
    expect([part.properties.percent.minimum, part.properties.percent.maximum]).toEqual([0, 100])
    expect(JSON.stringify(item)).not.toMatch(/byNir|byName|unmatched/)
  })

  it('[rule-evp-unlinked-list] [rule-evp-unlinked-list-paging] the list is a GET with from and size, five causes, bounded strings', () => {
    const operation = doc.paths['/sources/aqoona/unlinked-people'].get
    expect(Object.keys(doc.paths['/sources/aqoona/unlinked-people'])).toEqual(['get'])
    expect(operation.parameters.map((p: any) => p.name).sort()).toEqual(['from', 'size'])
    const schema = resolve(doc, operation.responses['200'].content['application/json'].schema)
    expect(schema.properties.total.minimum).toBe(0)
    expect(schema.properties.items.maxItems).toBe(50)
    const item = resolve(doc, schema.properties.items.items)
    expect(item.properties.cause.enum).toEqual(['NIR_ABSENT', 'NIR_KEY_INVALID', 'NIR_UNKNOWN', 'NIR_AMBIGUOUS', 'PAYFIT_INCOMPLETE'])
    expect([item.properties.name.minLength, item.properties.name.maxLength]).toEqual([1, 200])
    expect([item.properties.causeLabel.minLength, item.properties.causeLabel.maxLength]).toEqual([1, 100])
    expect(item.properties.creches.maxItems).toBe(50)
    expect([item.properties.creches.items.minLength, item.properties.creches.items.maxLength]).toEqual([1, 200])
  })
})

describe('migration 0011 (data of before v5)', () => {
  const pool = new Pool({ connectionString: getConfig().databaseUrl, max: 1 })
  beforeEach(resetData)
  afterAll(async () => {
    await pool.end()
    await closePool()
  })

  it('[rule-evp-link-one-establishment] [rule-evp-matching-rates-unknown-mode] the rows of before v5 get their company of reference, and the unlinked ones become INCONNU, never wrong rates', async () => {
    // the data statements of the migration, replayed inside a transaction that is rolled back (the columns and checks are in place)
    const statements = readFileSync(join(__dirname, '..', '..', '..', '..', 'drizzle', '0011_chunky_blue_marvel.sql'), 'utf8')
      .split('--> statement-breakpoint')
      .map((s) => s.replace(/^--.*$/gm, '').trim())
      .filter((s) => /^UPDATE /i.test(s))
    expect(statements).toHaveLength(2)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('alter table base.aqoona_plannings drop constraint aqoona_plannings_employee_company_check')
      await client.query(
        `insert into base.aqoona_plannings (person_ref, company_id, employee_id, day, start_time, end_time, match_method) values
          ('Liée', 'co-a', 'e1', current_date, '08:00', '09:00', 'NIR'),
          ('Liée par nom', 'co-a', 'e2', current_date, '09:00', '10:00', 'NOM'),
          ('Non liée', 'co-a', null, current_date, '10:00', '11:00', 'AUCUN')`,
      )
      for (const statement of statements) await client.query(statement)
      const { rows } = await client.query('select person_ref, employee_company_id, match_method from base.aqoona_plannings order by start_time')
      expect(rows).toEqual([
        { person_ref: 'Liée', employee_company_id: 'co-a', match_method: 'NIR' },
        { person_ref: 'Liée par nom', employee_company_id: 'co-a', match_method: 'NOM' },
        { person_ref: 'Non liée', employee_company_id: null, match_method: 'INCONNU' },
      ])
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })
})
