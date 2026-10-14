import jwt from 'jsonwebtoken'
import { getConfig } from '../../../platform/config/config'
import { call, closePool, resetData, sql } from '../../../platform/testing/helpers'

type EvpRole = 'DIRECTRICE' | 'RO' | 'RH' | 'ADMINISTRATRICE' | 'SUPERADMIN'

const PATH = '/sources/aqoona/unlinked-people'
const LABELS: Record<string, string> = {
  NIR_ABSENT: 'NIR absent dans Aqoona',
  NIR_KEY_INVALID: 'Clé du NIR incorrecte dans Aqoona',
  NIR_UNKNOWN: 'NIR inconnu de PayFit',
  NIR_AMBIGUOUS: 'NIR porté par plusieurs collaboratrices PayFit',
  PAYFIT_INCOMPLETE: 'NIR non vérifié : lecture PayFit incomplète',
}

describe('GET /sources/aqoona/unlinked-people', () => {
  const tokens = {} as Record<EvpRole, string>
  let slot = 0

  async function seed(role: EvpRole): Promise<void> {
    const email = `${role.toLowerCase()}@micro-stars.fr`
    const [user] = await sql<{ id: string }>("insert into base.users (email, role) values ($1, 'user') returning id", [email])
    await sql("insert into base.credentials (user_id, password, type) values ($1, 'x', 'token')", [user.id])
    await sql('insert into base.evp_accounts (user_id, name, email, role, active) values ($1, $2, $3, $4, true)', [user.id, role, email, role])
    tokens[role] = jwt.sign({ role: 'user', sv: 0 }, getConfig().jwtSecret, { algorithm: 'HS256', subject: user.id, expiresIn: 3600 })
  }
  const get = (token?: string, query = '') => call(`${PATH}${query}`, { headers: token ? { authorization: `Bearer ${token}` } : {} })
  const list = async (query = '') => {
    const res = await get(tokens.RH, query)
    expect(res.status).toBe(200)
    return res.json()
  }
  const readOnce = () => sql("insert into base.source_runs (source_key, state, finished_at, volumes) values ('aqoona', 'SUCCEEDED', now(), '[]')")
  /** An unlinked slot of `person` for `cause`, read in the crèche `creche` (null: unknown, kept as `label`). */
  async function unlinked(person: string, cause: string, creche: string | null = 'alpha', label: string | null = null): Promise<void> {
    slot += 1
    await sql(
      `insert into base.aqoona_plannings (person_ref, creche_code, company_id, day, start_time, end_time, slot_type, match_method, unlinked_cause, creche_label)
       values ($1, $2, null, current_date, $3, '23:00', 'GARDE', 'AUCUN', $4, $5)`,
      [person, creche, `${String(slot % 24).padStart(2, '0')}:${String(Math.floor(slot / 24)).padStart(2, '0')}`, cause, label],
    )
  }

  beforeEach(async () => {
    slot = 0
    await resetData()
    for (const role of ['DIRECTRICE', 'RO', 'RH', 'ADMINISTRATRICE', 'SUPERADMIN'] as EvpRole[]) await seed(role)
    await sql(
      `insert into base.creches (code, name, siret, verified, scope_code) values
        ('alpha', 'Crèche Alpha', '11111111111111', true, 'alpha'), ('beta', 'Crèche Bêta', '22222222222222', true, 'beta')`,
    )
  })
  afterAll(closePool)

  it('[rule-evp-unlinked-list-same-rights] RH and SUPERADMIN read, the other roles get 403, no session 401, the answer to an error has no other key than status, code, message', async () => {
    expect((await get(tokens.RH)).status).toBe(200)
    expect((await get(tokens.SUPERADMIN)).status).toBe(200)
    for (const role of ['DIRECTRICE', 'RO', 'ADMINISTRATRICE'] as EvpRole[]) {
      const res = await get(tokens[role])
      expect(res.status).toBe(403)
      expect(Object.keys(await res.json()).sort()).toEqual(['code', 'message', 'status'])
    }
    expect((await get()).status).toBe(401)
    expect((await call(PATH, { method: 'POST', headers: { authorization: `Bearer ${tokens.RH}` } })).status).toBeGreaterThanOrEqual(400)
  })

  it('[rule-evp-unlinked-list-no-nir] never read with success: unavailable and empty; a slot of before v5 (NOM, INCONNU) makes it unavailable too, window kept', async () => {
    await unlinked('Une Personne', 'NIR_ABSENT')
    expect(await list()).toEqual({ available: false, lastReadAt: null, windowFrom: null, windowTo: null, total: 0, items: [] })
    await readOnce()
    expect(await list()).toMatchObject({ available: true, total: 1 })
    await sql("update base.aqoona_plannings set match_method = 'INCONNU'")
    const body = await list()
    expect(body).toMatchObject({ available: false, total: 0, items: [] })
    expect(body.lastReadAt).toEqual(expect.any(String))
    expect(body.windowFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('[rule-evp-unlinked-list] [rule-evp-unlinked-list-grain] one entry per person and per cause, with the cause label and the crèches sorted by name; linked slots and slots without identity are not listed', async () => {
    await readOnce()
    await unlinked('Zita Zéro', 'NIR_UNKNOWN', 'beta')
    await unlinked('Zita Zéro', 'NIR_UNKNOWN', 'alpha')
    await unlinked('zita zero', 'NIR_UNKNOWN', 'alpha')
    await unlinked('Zita Zéro', 'NIR_ABSENT', 'alpha')
    await unlinked('Ana Alpha', 'NIR_KEY_INVALID', null, 'Établissement Inconnu')
    await sql("insert into base.aqoona_plannings (person_ref, day, start_time, end_time, match_method, employee_company_id, employee_id) values ('Lia Liée', current_date, '01:00', '02:00', 'NIR', 'co-a', 'e1')")
    await sql("insert into base.aqoona_plannings (person_ref, day, start_time, end_time, match_method) values ('Personne non nommée', current_date, '01:00', '02:00', 'AUCUN')")
    const body = await list()
    expect(body.total).toBe(3)
    expect(body.items).toEqual([
      { name: 'Ana Alpha', cause: 'NIR_KEY_INVALID', causeLabel: LABELS.NIR_KEY_INVALID, creches: ['Établissement Inconnu'] },
      { name: 'Zita Zéro', cause: 'NIR_ABSENT', causeLabel: LABELS.NIR_ABSENT, creches: ['Crèche Alpha'] },
      { name: 'Zita Zéro', cause: 'NIR_UNKNOWN', causeLabel: LABELS.NIR_UNKNOWN, creches: ['Crèche Alpha', 'Crèche Bêta'] },
    ])
  })

  it('[rule-evp-unlinked-list-all-causes-visible] the five causes are listed with their French labels', async () => {
    await readOnce()
    for (const cause of Object.keys(LABELS)) await unlinked(`Personne ${cause}`, cause)
    const body = await list()
    expect(Object.fromEntries(body.items.map((i: any) => [i.cause, i.causeLabel]))).toEqual(LABELS)
  })

  it('[rule-evp-unlinked-list-grain] people without a name are grouped under « Personne non nommée », one entry per cause', async () => {
    await readOnce()
    await unlinked('Personne non nommée', 'NIR_UNKNOWN', 'alpha')
    await unlinked('Personne non nommée', 'NIR_UNKNOWN', 'beta')
    expect((await list()).items).toEqual([
      { name: 'Personne non nommée', cause: 'NIR_UNKNOWN', causeLabel: LABELS.NIR_UNKNOWN, creches: ['Crèche Alpha', 'Crèche Bêta'] },
    ])
  })

  it('[rule-evp-unlinked-list-grain] the crèches are at most 50, each a name of 1 to 200 characters', async () => {
    await readOnce()
    for (let i = 0; i < 60; i++) await unlinked('Marie Multi', 'NIR_ABSENT', null, `Établissement ${String(i).padStart(2, '0')}`)
    const item = (await list()).items[0]
    expect(item.creches).toHaveLength(50)
    expect(item.creches[0]).toBe('Établissement 00')
  })

  it('[rule-evp-unlinked-list-paging] from and size page the sorted list after the sort; total counts every entry; beyond the total the page is empty', async () => {
    await readOnce()
    for (let i = 0; i < 60; i++) await unlinked(`Personne ${String(i).padStart(2, '0')}`, 'NIR_ABSENT')
    const first = await list()
    expect([first.total, first.items.length, first.items[0].name]).toEqual([60, 25, 'Personne 00'])
    expect((await list('?size=10')).items).toHaveLength(10)
    expect((await list('?size=50')).items).toHaveLength(50)
    const second = await list('?from=25')
    expect([second.items.length, second.items[0].name]).toEqual([25, 'Personne 25'])
    const beyond = await list('?from=1000')
    expect([beyond.total, beyond.items]).toEqual([60, []])
    expect(beyond.available).toBe(true)
  })

  it.each(['size=0', 'size=30', 'size=100', 'from=-1', 'from=1.5', 'from=abc'])(
    '[rule-evp-unlinked-list-paging] %s is refused with 400',
    async (query) => {
      const res = await get(tokens.RH, `?${query}`)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body).toMatchObject({ status: 400, code: 'api.validation.incoming_failed' })
    },
  )

  it('[rule-evp-unlinked-list-no-nir] [rule-evp-sources-readonly] the answer holds no digit series, writes nothing, and traces nothing', async () => {
    await readOnce()
    await unlinked('Léa Martin', 'NIR_KEY_INVALID')
    const runs = await sql('select 1 from base.source_runs')
    const text = await (await get(tokens.RH)).text()
    expect(text).not.toMatch(/\d{5,}/)
    expect(await sql('select 1 from base.audit_logs')).toEqual([])
    expect(await sql('select 1 from base.source_runs')).toHaveLength(runs.length)
  })
})
