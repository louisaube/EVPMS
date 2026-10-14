import jwt from 'jsonwebtoken'
import { getConfig } from '../../../platform/config/config'
import { call, closePool, resetData, sql } from '../../../platform/testing/helpers'

type EvpRole = 'DIRECTRICE' | 'RO' | 'RH' | 'ADMINISTRATRICE' | 'SUPERADMIN'

const PATH = '/sources/aqoona/matching-rates'

interface SlotSpec {
  /** company of the crèche read (`company_id`) */
  company?: string | null
  /** linked: `[company of reference, employee]` */
  linked?: [string, string]
  /** unlinked: the cause */
  cause?: string
  mode?: string
  creche?: string | null
}

describe('GET /sources/aqoona/matching-rates', () => {
  const tokens = {} as Record<EvpRole, string>
  let slot = 0

  async function seed(role: EvpRole): Promise<void> {
    const email = `${role.toLowerCase()}@micro-stars.fr`
    const [user] = await sql<{ id: string }>("insert into base.users (email, role) values ($1, 'user') returning id", [email])
    await sql("insert into base.credentials (user_id, password, type) values ($1, 'x', 'token')", [user.id])
    await sql('insert into base.evp_accounts (user_id, name, email, role, active) values ($1, $2, $3, $4, true)', [user.id, role, email, role])
    tokens[role] = jwt.sign({ role: 'user', sv: 0 }, getConfig().jwtSecret, { algorithm: 'HS256', subject: user.id, expiresIn: 3600 })
  }
  const get = (token?: string) => call(PATH, { headers: token ? { authorization: `Bearer ${token}` } : {} })
  const readOnce = () =>
    sql("insert into base.source_runs (source_key, state, finished_at, volumes) values ('aqoona', 'SUCCEEDED', now(), '[]')")
  /** A slot: linked to `[company, employee]`, or unlinked for a cause, of the person named `person` ("Personne n" if omitted). */
  async function addSlot(spec: SlotSpec, person?: string): Promise<void> {
    slot += 1
    const [employeeCompany, employee] = spec.linked ?? [null, null]
    await sql(
      `insert into base.aqoona_plannings
         (person_ref, creche_code, company_id, employee_company_id, employee_id, day, start_time, end_time, slot_type, match_method, unlinked_cause)
       values ($1, $2, $3, $4, $5, current_date, '08:00', '12:00', 'GARDE', $6, $7)`,
      [
        person ?? `Personne ${slot}`,
        spec.creche === undefined ? 'alpha' : spec.creche,
        spec.company === undefined ? 'co-a' : spec.company,
        employeeCompany,
        employee,
        spec.mode ?? (spec.linked ? 'NIR' : 'AUCUN'),
        spec.cause ?? null,
      ],
    )
  }
  const linked = (company: string, employee: string): SlotSpec => ({ linked: [company, employee] })
  const unlinked = (company: string | null, cause = 'NIR_ABSENT'): SlotSpec => ({ company, cause })

  beforeEach(async () => {
    await resetData()
    for (const role of ['DIRECTRICE', 'RO', 'RH', 'ADMINISTRATRICE', 'SUPERADMIN'] as EvpRole[]) await seed(role)
    await sql("insert into base.payfit_companies (id, siret, name) values ('co-b', '22222222222222', 'école Bêta'), ('co-a', '11111111111111', 'Alpha')")
  })
  afterAll(closePool)

  it('[rule-evp-matching-rates-same-rights] RH and SUPERADMIN read, the other roles get 403, no session 401', async () => {
    expect((await get(tokens.RH)).status).toBe(200)
    expect((await get(tokens.SUPERADMIN)).status).toBe(200)
    for (const role of ['DIRECTRICE', 'RO', 'ADMINISTRATRICE'] as EvpRole[]) {
      const res = await get(tokens[role])
      expect(res.status).toBe(403)
      expect(Object.keys(await res.json()).sort()).toEqual(['code', 'message', 'status'])
    }
    expect((await get()).status).toBe(401)
  })

  it('[rule-evp-matching-rates-route] never read with success: unavailable, empty, no window, even with slots stored', async () => {
    await addSlot(linked('co-a', 'e1'))
    const body = await (await get(tokens.RH)).json()
    expect(body).toEqual({ available: false, lastReadAt: null, windowFrom: null, windowTo: null, items: [] })
  })

  it('[rule-evp-matching-rates-route] read with success and no slot: available, no item, with the last reading and the window', async () => {
    await readOnce()
    const body = await (await get(tokens.RH)).json()
    expect(body).toMatchObject({ available: true, items: [] })
    expect(body.lastReadAt).toEqual(expect.any(String))
    expect(body.windowFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it.each(['NOM', 'INCONNU'])('[rule-evp-matching-rates-unknown-mode] a slot of mode %s (written before v5) makes the whole answer unavailable, window kept', async (mode) => {
    await readOnce()
    await addSlot(linked('co-a', 'e1'))
    await addSlot({ company: 'co-a', mode })
    const body = await (await get(tokens.RH)).json()
    expect(body).toMatchObject({ available: false, items: [] })
    expect(body.lastReadAt).toEqual(expect.any(String))
    expect(body.windowTo).toEqual(expect.any(String))
  })

  it('[rule-evp-matching-rates-people] [rule-evp-matching-rates-percent] [rule-evp-matching-rates-no-company] people, not slots: counts exact, percent to one decimal, French order, last line without company', async () => {
    await readOnce()
    // Alpha: two linked people (one on three slots), one unlinked person on two slots
    await addSlot(linked('co-a', 'e1'))
    await addSlot(linked('co-a', 'e1'))
    await addSlot(linked('co-a', 'e1'))
    await addSlot(linked('co-a', 'e2'))
    await addSlot(unlinked('co-a'), 'Una Seule')
    await addSlot(unlinked('co-a', 'NIR_UNKNOWN'), 'una seule')
    // Bêta: one linked person
    await addSlot(linked('co-b', 'f1'))
    // no company: an unlinked person of an unknown crèche, one of a company PayFit no longer knows
    await addSlot(unlinked(null), 'Ida Ailleurs')
    await addSlot(unlinked('co-gone'), 'Oya Partie')
    const body = await (await get(tokens.RH)).json()
    expect(body.available).toBe(true)
    expect(body.items.map((i: any) => i.name)).toEqual(['Alpha', 'école Bêta', 'Sans société identifiée'])
    expect(body.items[0]).toEqual({
      companyId: 'co-a',
      siret: '11111111111111',
      name: 'Alpha',
      total: 3,
      linked: { count: 2, percent: 66.7 },
      unlinked: { count: 1, percent: 33.3 },
    })
    expect(body.items[1]).toMatchObject({ total: 1, linked: { count: 1, percent: 100 }, unlinked: { count: 0, percent: 0 } })
    expect(body.items[2]).toEqual({
      companyId: null,
      siret: null,
      name: 'Sans société identifiée',
      total: 2,
      linked: { count: 0, percent: 0 },
      unlinked: { count: 2, percent: 100 },
    })
  })

  it('[rule-evp-matching-rates-company-of-person] a linked person counts for her company of reference, an unlinked person for each company of the crèches where she was read; a person on both sides of a company counts in both parts', async () => {
    await readOnce()
    // a floating employee of Bêta read in a crèche of Alpha: counted in Bêta
    await addSlot({ company: 'co-a', linked: ['co-b', 'f1'] })
    // an unlinked person read in a crèche of each company: counted in both lines
    await addSlot(unlinked('co-a'), 'Una Deux')
    await addSlot(unlinked('co-b'), 'Una Deux')
    // the same person linked on one slot and unlinked on another (D-0023)
    await addSlot(linked('co-a', 'e1'), 'Camille Durand')
    await addSlot({ ...unlinked('co-a'), creche: 'beta' }, 'Camille Durand')
    const body = await (await get(tokens.RH)).json()
    expect(body.items.map((i: any) => [i.companyId, i.linked.count, i.unlinked.count])).toEqual([
      ['co-a', 1, 2],
      ['co-b', 1, 1],
    ])
  })

  it('[rule-evp-link-no-identity] a slot without identity (no cause) is not a person: neither linked nor unlinked', async () => {
    await readOnce()
    await addSlot({ company: 'co-a', mode: 'AUCUN' })
    expect((await (await get(tokens.RH)).json()).items).toEqual([])
  })

  it('[rule-evp-matching-rates-live] [rule-evp-sources-readonly] reading writes nothing: no audit entry, no run', async () => {
    await readOnce()
    await addSlot(linked('co-a', 'e1'))
    const runs = await sql('select 1 from base.source_runs')
    await get(tokens.RH)
    expect(await sql('select 1 from base.audit_logs')).toEqual([])
    expect(await sql('select 1 from base.source_runs')).toHaveLength(runs.length)
  })

  it('[rule-evp-matching-rates-no-nir] the answer holds no long digit series other than SIRET and no name of a person', async () => {
    await readOnce()
    await addSlot(linked('co-a', 'e1'), 'Léa Martin')
    await addSlot(unlinked('co-a'), 'Una Seule')
    const text = await (await get(tokens.RH)).text()
    expect(text.replace(/11111111111111/g, '')).not.toMatch(/\d{9,}/)
    expect(text).not.toMatch(/Léa|Martin|Una|Seule/)
  })

  it('[rule-evp-aqoona-nir-never-stored] the checks refuse another mode than NIR, NOM, AUCUN, INCONNU, another cause than the five, and default the mode to INCONNU', async () => {
    await expect(addSlot({ company: 'co-a', mode: 'AUTRE' })).rejects.toThrow()
    await expect(addSlot({ company: 'co-a', cause: 'NIR_BIDON' })).rejects.toThrow()
    await sql("insert into base.aqoona_plannings (person_ref, day, start_time, end_time) values ('X', current_date, '08:00', '09:00')")
    expect((await sql('select match_method from base.aqoona_plannings'))[0].match_method).toBe('INCONNU')
  })
})
