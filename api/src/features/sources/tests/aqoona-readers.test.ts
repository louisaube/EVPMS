import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { getConfig } from '../../../platform/config/config'
import * as schema from '../../../platform/database/schema'
import { closePool, resetData, sql } from '../../../platform/testing/helpers'
import { SourceReaders } from '../source-readers'
import type { AqoonaData, AqoonaRow, NirHolder, NirTable, PayfitNirResult, PayfitNirs } from '../source-connectors'

// Fictitious numbers with a right check key, and the same 13 digits with a wrong one.
const NIR_A = '285057512345623'
const NIR_B = '190011234567815'
const NIR_C = '184127645108946'
const NIR_KO = '285057512345624'
const SIRET_1 = '11111111111111'
const SIRET_2 = '22222222222222'
const WINDOW = { from: '2026-09-14', to: '2026-11-16' }
const ALIASES = { GARDE: ['garde', 'garde enfant', 'terrain'], PAUSE: ['pause', 'pauses'], MENAGE: ['menage', 'entretien'] }

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
  slotTypes: ALIASES,
  addresses: [{ label: 'Aqoona Pros', ok: true, unusable: 0 }],
})
/** NIR → the collaborators of the network that carry it, as `[company, employee]`. */
const table = (entries: Array<[string, Array<[string, string]>]>): NirTable =>
  new Map(entries.map(([nir, holders]) => [nir, holders.map(([companyId, employeeId]): NirHolder => ({ companyId, employeeId }))]))
const ok = (entries: Array<[string, Array<[string, string]>]>, invalid: Array<[string, string]> = []): PayfitNirResult => ({
  status: 'ok',
  table: table(entries),
  invalid: invalid.map(([companyId, employeeId]) => ({ companyId, employeeId })),
})
/** The network as `listPayfitNirs()` gives it; `asked` counts the calls. */
const network = (bySiret: Record<string, PayfitNirResult>, asked: { n: number } = { n: 0 }) => async (): Promise<PayfitNirs> => {
  asked.n += 1
  return new Map(Object.entries(bySiret))
}
const TWO_OK = { [SIRET_1]: ok([]), [SIRET_2]: ok([]) }

interface Stored {
  person_ref: string
  creche_code: string | null
  company_id: string | null
  employee_company_id: string | null
  employee_id: string | null
  match_method: string
  unlinked_cause: string | null
  creche_label: string | null
  slot_type: string
}
const stored = () =>
  sql<Stored>(
    `select person_ref, creche_code, company_id, employee_company_id, employee_id, match_method, unlinked_cause, creche_label, slot_type
     from base.aqoona_plannings order by day, start_time, creche_code, person_ref`,
  )
const causes = async () => (await stored()).map((r) => r.unlinked_cause)

describe('applyAqoona (reading « Pros », attachment by the NIR alone)', () => {
  beforeEach(async () => {
    await resetData()
    await sql("insert into base.payfit_companies (id, siret, name) values ('co1', $1, 'Un'), ('co2', $2, 'Deux')", [SIRET_1, SIRET_2])
    await sql(
      `insert into base.creches (code, name, siret, verified, scope_code) values
        ('alpha', 'Alpha', $1, true, 'alpha'), ('beta', 'Bêta', $2, true, 'beta')`,
      [SIRET_1, SIRET_2],
    )
    await sql(
      `insert into base.payfit_employees (company_id, employee_id, first_name, last_name) values
        ('co1', 'e-lea', 'Léa', 'Martin'), ('co1', 'e-noe', 'Noé', 'Petit'), ('co2', 'f-lea', 'Léa', 'Martin'), ('co2', 'f-zoe', 'Zoé', 'Durand')`,
    )
  })
  afterAll(async () => {
    await closePool()
    await pool.end()
  })

  it('[rule-evp-link-nir-only] [rule-evp-aqoona-nir-never-stored] a NIR attaches the collaborator whatever the names; « Plannings rattachés » equals « Rapprochés par NIR »; no NIR is stored anywhere', async () => {
    const result = await readers.applyAqoona(
      data([row({ firstName: 'Autre', lastName: 'Nom', matricule: NIR_A })]),
      WINDOW,
      network({ ...TWO_OK, [SIRET_1]: ok([[NIR_A, [['co1', 'e-lea']]]]) }),
    )
    expect(await stored()).toEqual([
      {
        person_ref: 'Léa Martin',
        creche_code: 'alpha',
        company_id: 'co1',
        employee_company_id: 'co1',
        employee_id: 'e-lea',
        match_method: 'NIR',
        unlinked_cause: null,
        creche_label: null,
        slot_type: 'GARDE',
      },
    ])
    expect(result.volumes.find((v) => v.label === 'Plannings rattachés')?.count).toBe(1)
    expect(result.volumes.find((v) => v.label === 'Rapprochés par NIR')?.count).toBe(1)
    for (const t of await sql<{ t: string }>("select table_name || '.' || column_name as t from information_schema.columns where table_schema = 'base' and data_type = 'text'")) {
      const [tableName, column] = t.t.split('.')
      const hits = await sql(`select 1 from base."${tableName}" where "${column}" like $1`, [`%${NIR_A}%`])
      expect({ at: t.t, hits: hits.length }).toEqual({ at: t.t, hits: 0 })
    }
    expect(JSON.stringify(result)).not.toContain(NIR_A)
  })

  it('[rule-evp-link-nir-only] the same name without NIR is never attached: NIR_ABSENT, « Planning non rattaché » with the cause and the crèche, and a value that is not a NIR is absent too', async () => {
    const result = await readers.applyAqoona(
      data([row(), row({ matricule: 'MAT-12', day: '2026-10-02' }), row({ matricule: '12345', day: '2026-10-03' })]),
      WINDOW,
      network(TWO_OK),
    )
    expect(await causes()).toEqual(['NIR_ABSENT', 'NIR_ABSENT', 'NIR_ABSENT'])
    expect((await stored()).every((r) => r.employee_id === null && r.employee_company_id === null && r.match_method === 'AUCUN')).toBe(true)
    expect(result.anomalies.filter((a) => a.type === 'PLANNING_UNMATCHED').map((a) => [a.subject, a.detail])[0]).toEqual([
      'Léa Martin',
      'NIR absent dans Aqoona (crèche lue : Alpha).',
    ])
  })

  it('[rule-evp-link-network-wide] [rule-evp-link-one-establishment] a floating employee is attached to her company of reference while the slot keeps the company of the crèche read', async () => {
    await readers.applyAqoona(
      data([row({ matricule: NIR_A })]),
      WINDOW,
      network({ ...TWO_OK, [SIRET_2]: ok([[NIR_A, [['co2', 'f-lea']]]]) }),
    )
    expect(await stored()).toEqual([expect.objectContaining({ creche_code: 'alpha', company_id: 'co1', employee_company_id: 'co2', employee_id: 'f-lea', match_method: 'NIR' })])
  })

  it('[rule-evp-aqoona-nir-format] a NIR delivered by PayFit with 13 characters is found by the 13 first characters of the NIR of Aqoona', async () => {
    await readers.applyAqoona(data([row({ matricule: NIR_A })]), WINDOW, network({ ...TWO_OK, [SIRET_1]: ok([[NIR_A.slice(0, 13), [['co1', 'e-lea']]]]) }))
    expect((await stored())[0].employee_id).toBe('e-lea')
  })

  it('[rule-evp-link-causes] [rule-evp-link-nir-two-companies] each cause: wrong key, unknown NIR, ambiguous (same company or two companies); the order is absent, wrong key, ambiguous', async () => {
    const result = await readers.applyAqoona(
      data([
        row({ matricule: NIR_KO, day: '2026-10-01' }),
        row({ firstName: 'Una', lastName: 'Inconnue', matricule: NIR_B, day: '2026-10-02' }),
        row({ firstName: 'Ada', lastName: 'Double', matricule: NIR_A, day: '2026-10-03' }),
        row({ firstName: 'Eva', lastName: 'Croisée', matricule: NIR_C, day: '2026-10-04' }),
      ]),
      WINDOW,
      network({
        [SIRET_1]: ok([[NIR_A, [['co1', 'e-lea'], ['co1', 'e-noe']]], [NIR_C, [['co1', 'e-noe']]]]),
        [SIRET_2]: ok([[NIR_C, [['co2', 'f-lea']]]]),
      }),
    )
    expect(await causes()).toEqual(['NIR_KEY_INVALID', 'NIR_UNKNOWN', 'NIR_AMBIGUOUS', 'NIR_AMBIGUOUS'])
    expect(result.anomalies.filter((a) => a.type === 'PLANNING_UNMATCHED').map((a) => a.detail)).toEqual([
      'Clé du NIR incorrecte dans Aqoona (crèche lue : Alpha).',
      'NIR inconnu de PayFit (crèche lue : Alpha).',
      'NIR porté par plusieurs collaboratrices PayFit (crèche lue : Alpha).',
      'NIR porté par plusieurs collaboratrices PayFit (crèche lue : Alpha).',
    ])
    expect(JSON.stringify(result)).not.toMatch(new RegExp([NIR_A, NIR_B, NIR_C, NIR_KO].join('|')))
  })

  it('[rule-evp-link-incomplete-read] [rule-evp-aqoona-nir-unavailable] [rule-evp-company-named-in-anomalies] a NIR found nowhere while a company has no scope, cannot be read or has no key is PAYFIT_INCOMPLETE; a NIR found in a readable company is attached; the reading goes on', async () => {
    for (const status of ['scope-missing', 'unavailable'] as const) {
      await resetRows()
      const result = await readers.applyAqoona(
        data([row({ matricule: NIR_A }), row({ firstName: 'Zoé', lastName: 'Durand', matricule: NIR_B, day: '2026-10-02' })]),
        WINDOW,
        network({ [SIRET_1]: { status }, [SIRET_2]: ok([[NIR_B, [['co2', 'f-zoe']]]]) }),
      )
      expect({ status, causes: await causes() }).toEqual({ status, causes: ['PAYFIT_INCOMPLETE', null] })
      expect(result.partial).toBe(false)
      expect(result.anomalies.filter((a) => a.type === 'aqoona_nir_unavailable')).toEqual([
        {
          type: 'aqoona_nir_unavailable',
          label: 'Rapprochement par NIR indisponible',
          subject: 'Un (SIRET 11111111111111)',
          detail:
            status === 'scope-missing'
              ? 'La portée « collaborators:social-security:read » manque à la clé PayFit. Les collaboratrices de cette société ne peuvent pas être trouvées par leur NIR.'
              : 'Les collaboratrices de cette société ne peuvent pas être trouvées par leur NIR.',
        },
      ])
    }
  })

  it('[rule-evp-link-network-read] [rule-evp-link-incomplete-read] an unreadable network (the call fails, or no key at all): every row with a NIR of right key is PAYFIT_INCOMPLETE, the reading does not fail and no value is quoted', async () => {
    const failing = await readers.applyAqoona(data([row({ matricule: NIR_A })]), WINDOW, async () => {
      throw new Error(`boom ${NIR_A}`)
    })
    expect(await causes()).toEqual(['PAYFIT_INCOMPLETE'])
    expect(failing.anomalies.map((a) => a.type)).toEqual(['PLANNING_UNMATCHED'])
    expect(JSON.stringify(failing)).not.toContain(NIR_A)
    await resetRows()
    await readers.applyAqoona(data([row({ matricule: NIR_A })]), WINDOW, network({}))
    expect(await causes()).toEqual(['PAYFIT_INCOMPLETE'])
  })

  it('[rule-evp-link-network-read] the network is asked once, and only when a row has a NIR of right key (absent, unreadable or wrong key: PayFit is not called)', async () => {
    const asked = { n: 0 }
    await readers.applyAqoona(data([row(), row({ matricule: NIR_KO, day: '2026-10-02' }), row({ matricule: 'x', day: '2026-10-03' })]), WINDOW, network(TWO_OK, asked))
    expect(asked.n).toBe(0)
    await readers.applyAqoona(data([row({ matricule: NIR_A }), row({ matricule: NIR_B, day: '2026-10-02' })]), WINDOW, network(TWO_OK, asked))
    expect(asked.n).toBe(1)
  })

  it('[rule-evp-link-employee-not-read] [D-0024] a NIR found live for a collaborator PayFit has not recorded is not attached (PAYFIT_INCOMPLETE); with a second carrier it is ambiguous', async () => {
    await readers.applyAqoona(data([row({ matricule: NIR_A })]), WINDOW, network({ ...TWO_OK, [SIRET_1]: ok([[NIR_A, [['co1', 'e-new']]]]) }))
    expect(await stored()).toEqual([expect.objectContaining({ employee_id: null, employee_company_id: null, unlinked_cause: 'PAYFIT_INCOMPLETE' })])
    await resetRows()
    await readers.applyAqoona(data([row({ matricule: NIR_A })]), WINDOW, network({ ...TWO_OK, [SIRET_1]: ok([[NIR_A, [['co1', 'e-lea'], ['co1', 'e-new']]]]) }))
    expect(await causes()).toEqual(['NIR_AMBIGUOUS'])
    expect(await sql('select 1 from base.payfit_employees where employee_id = $1', ['e-new'])).toEqual([])
  })

  it('[rule-evp-nir-key-invalid-unused] [rule-evp-nir-key-anomaly-grain] a wrong key in Aqoona: one anomaly per person with the slot count, the row is not attached; a collaborator of wrong key in PayFit is named from payfit_employees, else « Collaboratrice <identifiant> », and makes nobody ambiguous', async () => {
    const result = await readers.applyAqoona(
      data([row({ matricule: NIR_KO }), row({ matricule: NIR_KO, day: '2026-10-02' }), row({ firstName: 'Zoé', lastName: 'Durand', matricule: NIR_B, day: '2026-10-03' })]),
      WINDOW,
      network({ [SIRET_1]: ok([], [['co1', 'e-noe'], ['co1', 'e-ghost']]), [SIRET_2]: ok([[NIR_B, [['co2', 'f-zoe']]]]) }),
    )
    expect(result.anomalies.filter((a) => a.type === 'aqoona_nir_key_invalid')).toEqual([
      {
        type: 'aqoona_nir_key_invalid',
        label: 'Clé de NIR Aqoona incorrecte',
        subject: 'Léa Martin',
        detail: "2 créneau(x) : la clé de contrôle du NIR est incorrecte, la ligne n'est pas rattachée.",
      },
    ])
    expect(result.anomalies.filter((a) => a.type === 'payfit_nir_key_invalid').map((a) => [a.subject, a.detail])).toEqual([
      ['Collaboratrice e-ghost', `Société ${SIRET_1} : la clé de contrôle du NIR est incorrecte, ce NIR n'est pas utilisé.`],
      ['Noé Petit', `Société ${SIRET_1} : la clé de contrôle du NIR est incorrecte, ce NIR n'est pas utilisé.`],
    ])
    expect(await causes()).toEqual(['NIR_KEY_INVALID', 'NIR_KEY_INVALID', null])
    expect(JSON.stringify(result)).not.toContain(NIR_KO)
  })

  it('[rule-evp-link-no-identity] [rule-evp-link-unusable-nir] a row without name nor NIR is kept, not attached, without cause, counted per address; a NIR without name is « Personne non nommée »', async () => {
    const result = await readers.applyAqoona(
      data([
        row({ firstName: '', lastName: '', matricule: '', day: '2026-10-01' }),
        row({ firstName: ' ', lastName: '', matricule: null, day: '2026-10-02' }),
        row({ firstName: '', lastName: '', matricule: NIR_B, day: '2026-10-03' }),
      ]),
      WINDOW,
      network(TWO_OK),
    )
    expect((await stored()).map((r) => [r.person_ref, r.match_method, r.unlinked_cause])).toEqual([
      ['Personne non nommée', 'AUCUN', null],
      ['Personne non nommée', 'AUCUN', null],
      ['Personne non nommée', 'AUCUN', 'NIR_UNKNOWN'],
    ])
    expect(result.anomalies.filter((a) => a.type === 'aqoona_no_identity')).toEqual([
      { type: 'aqoona_no_identity', label: 'Ligne Aqoona sans nom ni NIR', subject: 'Aqoona Pros', detail: '2 ligne(s) sans nom ni NIR.' },
    ])
    expect(result.partial).toBe(false)
  })

  it('[rule-evp-link-unknown-creche] [D-0022] an unknown establishment does not prevent the attachment (no crèche, no company, no anomaly of establishment); unattached, the establishment read is kept for the list', async () => {
    const result = await readers.applyAqoona(
      data([row({ crecheName: 'Inconnue', matricule: NIR_A }), row({ crecheName: 'Inconnue', firstName: 'Eve', lastName: 'Ailleurs', matricule: NIR_KO, day: '2026-10-02' })]),
      WINDOW,
      network({ ...TWO_OK, [SIRET_1]: ok([[NIR_A, [['co1', 'e-lea']]]]) }),
    )
    expect(await stored()).toEqual([
      expect.objectContaining({ creche_code: null, company_id: null, employee_company_id: 'co1', employee_id: 'e-lea', creche_label: null }),
      expect.objectContaining({ creche_code: null, company_id: null, employee_id: null, unlinked_cause: 'NIR_KEY_INVALID', creche_label: 'Inconnue' }),
    ])
    expect(result.anomalies.filter((a) => a.type === 'PLANNING_UNMATCHED').map((a) => a.detail)).toEqual(['Clé du NIR incorrecte dans Aqoona (crèche lue : Inconnue).'])
    expect(await sql('select reason from base.aqoona_mismatches')).toEqual([{ reason: 'Clé du NIR incorrecte dans Aqoona' }])
  })

  it('[rule-evp-link-person-both-states] [D-0023] the attachment is decided row by row: a row without NIR of a person otherwise attached stays NIR_ABSENT', async () => {
    await readers.applyAqoona(
      data([row({ matricule: NIR_A }), row({ day: '2026-10-02' })]),
      WINDOW,
      network({ ...TWO_OK, [SIRET_1]: ok([[NIR_A, [['co1', 'e-lea']]]]) }),
    )
    expect((await stored()).map((r) => [r.employee_id, r.unlinked_cause])).toEqual([['e-lea', null], [null, 'NIR_ABSENT']])
  })

  it('[rule-evp-matching-method-first-row] [rule-evp-aqoona-dedupe] identical rows are stored once and keep the values of the first row retained', async () => {
    await readers.applyAqoona(
      data([row({ matricule: NIR_A }), row(), row({ start: '13:00', end: '17:00' })]),
      WINDOW,
      network({ ...TWO_OK, [SIRET_1]: ok([[NIR_A, [['co1', 'e-lea']]]]) }),
    )
    expect((await stored()).map((r) => r.match_method)).toEqual(['NIR', 'AUCUN'])
  })

  it('[rule-evp-aqoona-etab-unique] an unknown establishment, or one shared by two verified crèches, is stored without crèche; the establishment read is kept', async () => {
    await sql("insert into base.creches (code, name, siret, verified, scope_code) values ('alpha2', 'Alpha', $1, true, 'alpha2')", [SIRET_2])
    await readers.applyAqoona(data([row(), row({ crecheName: 'Inconnue', day: '2026-10-02' })]), WINDOW, network(TWO_OK))
    expect((await stored()).map((r) => [r.creche_code, r.company_id, r.creche_label])).toEqual([[null, null, 'Alpha'], [null, null, 'Inconnue']])
  })

  it('[rule-evp-aqoona-text-normalised] one person is spelled as the first row read, whatever the case and the spaces', async () => {
    await readers.applyAqoona(
      data([row({ firstName: 'Prénom', lastName: 'NOM ' }), row({ firstName: '  prénom ', lastName: ' nom', day: '2026-10-02' }), row({ crecheName: ' ALPHA ', day: '2026-10-03' })]),
      WINDOW,
      network(TWO_OK),
    )
    const rows = await stored()
    expect(rows.slice(0, 2).map((r) => r.person_ref)).toEqual(['Prénom NOM', 'Prénom NOM'])
    expect(rows[2]).toEqual(expect.objectContaining({ person_ref: 'Léa Martin', creche_code: 'alpha' }))
  })

  it('[rule-evp-aqoona-slot-type-anomalies] [rule-evp-aqoona-nir-no-trace-in-types] one anomaly per unknown type, one for the rows without type, a NIR-looking type is not quoted', async () => {
    const result = await readers.applyAqoona(
      data([
        row({ type: 'Réunion' }),
        row({ type: 'RÉUNION', day: '2026-10-02' }),
        row({ type: '', day: '2026-10-03' }),
        row({ type: NIR_A, day: '2026-10-04' }),
        row({ type: 'Ménage', day: '2026-10-05' }),
      ]),
      WINDOW,
      network(TWO_OK),
    )
    const byType = Object.fromEntries(result.anomalies.filter((a) => a.type.startsWith('aqoona_slot_type')).map((a) => [`${a.type}|${a.subject}`, a.detail]))
    expect(Object.keys(byType).sort()).toEqual(
      ['aqoona_slot_type_missing|Aqoona Pros', 'aqoona_slot_type_unknown|Type illisible', 'aqoona_slot_type_unknown|reunion'].sort(),
    )
    expect((await stored()).map((r) => r.slot_type).sort()).toEqual(['AUTRE', 'AUTRE', 'AUTRE', 'MENAGE', 'NON_PRECISE'])
    expect(JSON.stringify(result)).not.toContain(NIR_A)
  })

  it('[rule-evp-aqoona-partial-failure] the slots of an address that failed are kept, those of the address that answered are replaced', async () => {
    await readers.applyAqoona(data([row({ addressLabel: 'Aqoona Pros' }), row({ addressLabel: 'Autre', day: '2026-10-02' })]), WINDOW, network(TWO_OK))
    const failed: AqoonaData = {
      rows: [row({ start: '09:00', end: '10:00', addressLabel: 'Autre' })],
      unusable: 0,
      slotTypes: ALIASES,
      addresses: [
        { label: 'Aqoona Pros', ok: false, unusable: 0, failure: { code: 'unreachable', detail: 'x' } as never },
        { label: 'Autre', ok: true, unusable: 0 },
      ],
    }
    const result = await readers.applyAqoona(failed, WINDOW, network(TWO_OK))
    expect(result.partial).toBe(true)
    const days = await sql<{ day: string; start_time: string }>('select day::text as day, start_time from base.aqoona_plannings order by day')
    expect(days).toEqual([
      { day: '2026-10-01', start_time: '08:00' },
      { day: '2026-10-01', start_time: '09:00' },
    ])
  })

  async function resetRows(): Promise<void> {
    await sql('delete from base.aqoona_plannings')
    await sql('delete from base.aqoona_mismatches')
  }
})
