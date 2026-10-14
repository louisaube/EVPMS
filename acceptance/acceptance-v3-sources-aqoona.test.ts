import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resetData, closePool, sql } from './harness'
import { logSince, logSize } from './renfort-helpers'
import { GET, POST, API_DIR, seedWorld, seedCreche, seedCompany, seedContract, World, closeEvp, refresh, waitRun, countRows, SIRET_A, SIRET_B } from './evp-helpers'
import { FakeNet, PayfitFake, configuredSecrets, d, describeStandard, everythingVisible, expectNoSecret, payfitWorld, withConfigFile } from './v2-helpers'
import { introspectScopes } from './v4-helpers'
import { ALPHA, AQ_UNAVAILABLE_DETAIL, BETA, companyLabel, sameName, unmatchedDetail } from './v5-helpers'
import { ALL_NIRS, NIR1, NIR2, NIR3, ProsFake, allTablesText, expectNoNir, plannings, pros, prosEntry, queryOf, spaced, withNir } from './v3-helpers'

const ERROR_CODES = ['sources.not_configured', 'sources.unreachable', 'sources.refused', 'sources.rate_limited', 'sources.unexpected_format']

// Acceptance suite of version v3-evp-acces-contrats-siret: reading of the Aqoona « Pros » address (request, mapping, slots,
// types, normalisation, de-duplication) and the NIR as a transient key against a fake PayFit. API of the variant `pros`.
describeStandard('Aqoona « Pros » reading and NIR key (v3-evp-acces-contrats-siret)', () => {
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
    introspectScopes(pf) // v4 checks the scope before reading NIR (rule-evp-payfit-scope-checked): the double grants collaborators:social-security:read
    net.clear()
    w = await seedWorld()
    await sql("update base.payfit_contracts set status = 'ACTIVE'")
  })

  const read = () => refresh(w.rh.token, 'aqoona')
  const sourceOf = async () => (await GET('/sources', w.rh.token)).body.items.find((i: any) => i.key === 'aqoona')
  const anomalies = async () => (await GET('/sources/aqoona/anomalies?size=50', w.rh.token)).body
  const ofType = async (type: string) => (await anomalies()).items.filter((i: any) => i.type === type)
  const volume = (volumes: any[], label: string) => volumes.find((v) => v.label === label)
  const prosCalls = () => net.calls('aqoona-pros')
  const payfitCalls = () => net.calls(/^payfit/)
  const typeAt = (rows: any[], start: string) => rows.find((r) => r.start === start)?.slot_type
  /**
   * Ancre sur v3 : une lecture « Pros » réussie publie le volume « Rapprochés par NIR » (v2 publiait « Matricule écarté »).
   * Les gardes de non-régression l'appellent pour ne pas passer avant le code de v3.
   */
  const expectProsReadingOfV3 = async () => {
    aq.rows([pros({ day: d(-3) })])
    expect((await read()).state).toBe('SUCCEEDED')
    expect(volume((await sourceOf()).volumes, 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count: 0 })
  }
  /** Ancre sur v3 pour un test qui lit lui-même : la lecture qui vient de réussir publie le volume « Rapprochés par NIR » (absent en v2). */
  const expectNirVolume = async (count = 0) =>
    expect(volume((await sourceOf()).volumes, 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count })
  const setNir = (siret: string, id: string, nir: string | null) => {
    const company = pf.company(siret)
    company.collaborators = company.collaborators.map((c) => (c.id === id ? (withNir(c, nir) as any) : c))
  }

  // ───────────────────────────── la requête ─────────────────────────────
  describe('the request sent to the « Pros » address', () => {
    it('[rule-evp-aqoona-read-pros] [rule-evp-aqoona-window-params] [rule-evp-aqoona-get-only] one single GET: dateBegin = D-28 and dateEnd = D+35 (Paris, YYYY-MM-DD) replace the stale values of the configured address, securityCheck and the foreign parameter are kept, nothing else is added', async () => {
      const first = d(-28)
      const run = await read()
      const lastDay = d(35)
      expect(run.state).toBe('SUCCEEDED')
      const calls = prosCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0].method).toBe('GET')
      const q = queryOf(calls[0])
      expect(q.getAll('dateBegin')).toHaveLength(1)
      expect(q.getAll('dateEnd')).toHaveLength(1)
      expect([first, d(-28)]).toContain(q.get('dateBegin'))
      expect([lastDay, d(35)]).toContain(q.get('dateEnd'))
      expect(q.get('dateBegin')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(q.get('dateEnd')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(q.get('securityCheck')).toBe(new URL(prosEntry().url).searchParams.get('securityCheck'))
      expect(q.get('lang')).toBe('fr')
      expect([...q.keys()].sort()).toEqual(['dateBegin', 'dateEnd', 'lang', 'securityCheck'])
      expect(calls[0].headers.authorization).toBeUndefined()
      expect(calls[0].headers.cookie).toBeUndefined()
      expect(String(calls[0].headers.accept)).toMatch(/application\/json/)
      expect(net.log.every((r) => r.method === 'GET' && r.tag === 'aqoona-pros')).toBe(true)
      expect(payfitCalls()).toHaveLength(0)
    })

    it('[rule-evp-aqoona-window-params] every new reading asks again with the window of the day, and « Lire maintenant » twice makes two requests, one per reading', async () => {
      await read()
      await read()
      expect(prosCalls()).toHaveLength(2)
      for (const call of prosCalls()) {
        const q = queryOf(call)
        expect(q.get('dateEnd')! > q.get('dateBegin')!).toBe(true)
      }
    })

    it('[rule-evp-aqoona-get-only] a redirection is not followed: the target is never requested and the reading reports the address unreachable', async () => {
      await expectProsReadingOfV3()
      const origin = new URL(prosEntry().bare).origin
      await net.mount('aqoona-redirected', `${origin}/aqoona-redirected`, (c) => c.json(200, [pros({ prenom: 'Redir', nom: 'Stolen' })]))
      aq.reply = { redirectTo: `${origin}/aqoona-redirected/hit?stolen=1` }
      const run = await read()
      expect(net.calls('aqoona-redirected')).toHaveLength(0)
      expect(run.state).toBe('FAILED')
      expect(ERROR_CODES).toContain((await sourceOf()).lastError.code)
      expect(await countRows('aqoona_plannings', "person_ref like 'Redir%'")).toBe(0)
    })

    it('[rule-evp-aqoona-mask] [rule-evp-aqoona-url-secret] GET /sources shows the address by its label and masked after the path; neither the securityCheck, nor the completed address with its dates is visible anywhere after a reading or a failed reading', async () => {
      await expectProsReadingOfV3()
      aq.reply = { status: 500, body: { error: 'boom', detail: `GET ${prosEntry().url}` } }
      const failed = await read()
      expect(failed.state).toBe('FAILED')
      const src = await sourceOf()
      expect(src.addresses).toHaveLength(1)
      expect(src.addresses[0]).toMatchObject({ label: 'Aqoona Pros', masked: prosEntry().masked })
      expect(ERROR_CODES).toContain(src.lastError.code)
      const visible = await everythingVisible(w.rh.token, { GET: (p, t) => GET(p, t), POST: (p, t, b) => POST(p, t, b), sql: (q) => sql(q) })
      expectNoSecret('visible', visible)
      expectNoSecret('failed run', JSON.stringify(failed))
      expect(visible).not.toContain('securityCheck')
      expect(visible).not.toContain('dateBegin')
    })

    it('[rule-evp-sources-readonly] only GET requests reach the address; a failing address keeps the plannings of the last success', async () => {
      aq.rows([pros({ day: d(-3) })])
      expect((await read()).state).toBe('SUCCEEDED')
      await expectNirVolume()
      const kept = JSON.stringify(await plannings())
      aq.reply = { status: 503, body: { error: 'down' } }
      const run = await read()
      expect(run.state).toBe('FAILED')
      expect(JSON.stringify(await plannings())).toBe(kept)
      expect(net.log.every((r) => r.method === 'GET')).toBe(true)
    })

    it('[rule-evp-aqoona-partial-failure] an address that fails keeps the plannings of its previous reading; the plannings of the address that answered are replaced', async () => {
      aq.rows([pros({ day: d(-3) })])
      expect((await read()).state).toBe('SUCCEEDED')
      const before = JSON.stringify(await plannings())
      aq.reply = { status: 503, body: { error: 'down' } }
      const failed = await read()
      expect(failed.state).not.toBe('SUCCEEDED')
      expect(JSON.stringify(await plannings())).toBe(before)
      aq.rows([pros({ day: d(-2) })])
      expect((await read()).state).toBe('SUCCEEDED')
      expect(JSON.stringify(await plannings())).not.toBe(before)
    })
  })

  // ───────────────────────────── le fichier de correspondance ─────────────────────────────
  describe('mapping file', () => {
    it('[rule-evp-aqoona-mapping-final] api/config/aqoona-mapping.json is the final « Pros » mapping of the request', () => {
      const delivered = JSON.parse(readFileSync(join(API_DIR, 'config', 'aqoona-mapping.json'), 'utf8'))
      expect(delivered).toEqual({
        records: '',
        fields: {
          matricule: 'user_matricule',
          prenom: 'user_firstname',
          nom: 'user_lastname',
          creche: 'etablissement_name',
          jour: 'planning_days_date',
          debut: 'planning_days_heure_debut',
          fin: 'planning_days_heure_fin',
          type: 'planning_days_type_creneau',
        },
        dayFormat: 'YYYY-MM-DD',
        timeFormat: 'HH:mm',
        slotTypes: {
          GARDE: ['garde', 'garde enfant', 'terrain'],
          PAUSE: ['pause', 'pauses'],
          MENAGE: ['menage', 'entretien'],
        },
      })
    })

    it('[rule-evp-aqoona-root-array] [rule-evp-aqoona-fields] the answer is a JSON array at the root, one row per slot: the fields are read under their « Pros » names', async () => {
      // v5 (rule-evp-link-nir-only): the collaborator is designated by the NIR of the row, never by the names
      setNir(SIRET_A, 'emp-ct-a1', NIR1)
      aq.rows([pros({ day: d(-3), debut: '12:00', fin: '14:15', type: 'Garde', matricule: NIR1 })])
      const run = await read()
      expect(run.state).toBe('SUCCEEDED')
      expect(await plannings()).toEqual([
        { person_ref: 'Léa Martin', creche_code: 'alpha', company_id: 'co-a', employee_id: 'emp-ct-a1', day: d(-3), start: '12:00', end: '14:15', slot_type: 'GARDE' },
      ])
      expect(volume((await sourceOf()).volumes, 'Plannings lus')).toEqual({ label: 'Plannings lus', count: 1 })
    })

    it('[rule-evp-aqoona-unexpected-format] [rule-evp-aqoona-root-array] an answer that is not an array at the root, or whose majority of rows are unusable, is sources.unexpected_format and keeps the plannings of the last success', async () => {
      aq.rows([pros({ day: d(-3) })])
      expect((await read()).state).toBe('SUCCEEDED')
      await expectNirVolume()
      const kept = JSON.stringify(await plannings())
      aq.reply = { body: { planning: { items: [pros()] } } }
      const object = await read()
      expect(object.state).toBe('FAILED')
      expect((await sourceOf()).lastError.code).toBe('sources.unexpected_format')
      const noDay = (i: number) => {
        const row: any = pros({ prenom: `P${i}` })
        delete row.planning_days_date
        return row
      }
      aq.rows([pros({ day: d(-2) }), noDay(1), noDay(2), noDay(3)])
      const mostly = await read()
      expect(mostly.state).toBe('FAILED')
      expect((await sourceOf()).lastError.code).toBe('sources.unexpected_format')
      expect(JSON.stringify(await plannings())).toBe(kept)
    })

    it('[rule-evp-aqoona-mapping-final] a mapping without « type » gives every slot NON_PRECISE; a mapping without « slotTypes » ranks any non empty type in AUTRE (the mapping is configuration)', async () => {
      const base = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'aqoona-mapping-pros.test.json'), 'utf8'))
      const { type, ...fieldsWithoutType } = base.fields
      expect(type).toBe('planning_days_type_creneau')
      aq.rows([pros({ debut: '08:00', fin: '09:00', type: 'Garde' }), pros({ debut: '09:00', fin: '10:00', type: 'Pause' })])
      await withConfigFile('AQOONA_MAPPING_FILE', { ...base, fields: fieldsWithoutType }, async () => {
        expect((await read()).state).toBe('SUCCEEDED')
        expect((await plannings()).map((r) => r.slot_type)).toEqual(['NON_PRECISE', 'NON_PRECISE'])
      })
      const { slotTypes, ...withoutAliases } = base
      expect(slotTypes.GARDE).toContain('garde')
      await withConfigFile('AQOONA_MAPPING_FILE', withoutAliases, async () => {
        expect((await read()).state).toBe('SUCCEEDED')
        expect((await plannings()).map((r) => r.slot_type)).toEqual(['AUTRE', 'AUTRE'])
      })
    })

    it('[rule-evp-aqoona-mapping-final] a mapping that does not follow its schema ends the reading FAILED with sources.not_configured, without quoting its content', async () => {
      await expectProsReadingOfV3()
      await withConfigFile('AQOONA_MAPPING_FILE', { records: '', fields: { matricule: 'secret-field-name-xyz' } }, async () => {
        const run = await read()
        expect(run.state).toBe('FAILED')
        const src = await sourceOf()
        expect(src.lastError.code).toBe('sources.not_configured')
        expect(JSON.stringify(src.lastError)).not.toContain('secret-field-name-xyz')
      })
    })
  })

  // ───────────────────────────── créneaux ─────────────────────────────
  describe('slots', () => {
    it('[rule-evp-aqoona-slots] [rule-evp-sources-no-auto-absence] the contiguous slots of a day are stored one by one, never merged; no presence or absence is deduced, no dossier or notification is created', async () => {
      aq.rows([
        pros({ debut: '08:00', fin: '10:00', type: 'Garde' }),
        pros({ debut: '10:00', fin: '10:15', type: 'PAUSE' }),
        pros({ debut: '10:15', fin: '12:00', type: 'Garde' }),
        pros({ debut: '12:00', fin: '13:00', type: 'MENAGE' }),
      ])
      expect((await read()).state).toBe('SUCCEEDED')
      expect((await plannings()).map((r) => [r.start, r.end, r.slot_type])).toEqual([
        ['08:00', '10:00', 'GARDE'],
        ['10:00', '10:15', 'PAUSE'],
        ['10:15', '12:00', 'GARDE'],
        ['12:00', '13:00', 'MENAGE'],
      ])
      expect(volume((await sourceOf()).volumes, 'Plannings lus')).toEqual({ label: 'Plannings lus', count: 4 })
      expect(await countRows('absences')).toBe(0)
      expect(await countRows('notifications')).toBe(0)
    })

    it('[rule-evp-aqoona-window] the window runs from D-28 to D+35: rows outside are ignored, the bounds are kept; the window of GET /sources is the same', async () => {
      aq.rows([-29, -28, 0, 35, 36].map((n, i) => pros({ day: d(n), debut: `${String(i + 6).padStart(2, '0')}:00`, fin: `${String(i + 6).padStart(2, '0')}:30` })))
      expect((await read()).state).toBe('SUCCEEDED')
      expect((await plannings()).map((r) => r.day)).toEqual([d(-28), d(0), d(35)])
      await expectNirVolume()
      const src = await sourceOf()
      expect(src.windowFrom).toBe(d(-28))
      expect(src.windowTo).toBe(d(35))
    })

    it('[rule-evp-aqoona-dedupe] two identical rows are stored and counted once; a different type or different hours is another slot', async () => {
      aq.rows([
        pros({ debut: '08:00', fin: '10:00', type: 'Garde' }),
        pros({ debut: '08:00', fin: '10:00', type: 'garde' }),
        pros({ debut: '08:00', fin: '10:00', type: 'Pause' }),
        pros({ debut: '10:00', fin: '12:00', type: 'Garde' }),
      ])
      expect((await read()).state).toBe('SUCCEEDED')
      expect((await plannings()).map((r) => [r.start, r.end, r.slot_type])).toEqual([
        ['08:00', '10:00', 'GARDE'],
        ['08:00', '10:00', 'PAUSE'],
        ['10:00', '12:00', 'GARDE'],
      ])
      expect(volume((await sourceOf()).volumes, 'Plannings lus')).toEqual({ label: 'Plannings lus', count: 3 })
    })

    it('[rule-evp-aqoona-dedupe] a set of rows accepted in memory is never refused by the database: identical rows of an establishment that matches no crèche collapse into one without failing the reading', async () => {
      aq.rows([pros({ etab: 'Établissement Fantôme' }), pros({ etab: 'Établissement Fantôme' }), pros({ etab: 'Établissement Fantôme', debut: '14:00', fin: '15:00' })])
      const run = await read()
      expect(run.state).toBe('SUCCEEDED')
      expect(await countRows('aqoona_plannings')).toBe(2)
      expect(await countRows('aqoona_plannings', 'creche_code is not null')).toBe(0)
    })

    it('[rule-evp-aqoona-multi-siret-same-day] [rule-evp-link-network-wide] the same person in two establishments of two SIRET the same day, same hours: two series, one per crèche and per company, both attached by her NIR to her one collaborator, no anomaly', async () => {
      setNir(SIRET_A, 'emp-ct-a1', NIR1)
      aq.rows([pros({ etab: 'Crèche Alpha', matricule: NIR1 }), pros({ etab: 'Crèche Beta', matricule: NIR1 })])
      expect((await read()).state).toBe('SUCCEEDED')
      expect((await plannings()).map((r) => [r.creche_code, r.company_id, r.employee_id])).toEqual([
        ['alpha', 'co-a', 'emp-ct-a1'],
        ['beta', 'co-b', 'emp-ct-a1'],
      ])
      await expectNirVolume(2)
      expect((await anomalies()).total).toBe(0)
    })
  })

  // ───────────────────────────── types de créneau ─────────────────────────────
  describe('slot types', () => {
    it('[rule-evp-aqoona-slot-type-normalised] every spelling of the request is ranked: Garde, garde, GARDE, Garde enfant, Terrain → GARDE; PAUSE, Pause, pauses → PAUSE; Menage, MENAGE, Ménage, Entretien → MENAGE; empty or absent → NON_PRECISE; unknown → AUTRE', async () => {
      const cases: Array<[string | undefined, string]> = [
        ['Garde', 'GARDE'], ['garde', 'GARDE'], ['GARDE', 'GARDE'], ['Garde enfant', 'GARDE'], ['  Garde   enfant ', 'GARDE'], ['Terrain', 'GARDE'],
        ['PAUSE', 'PAUSE'], ['Pause', 'PAUSE'], ['pauses', 'PAUSE'],
        ['Menage', 'MENAGE'], ['MENAGE', 'MENAGE'], ['Ménage', 'MENAGE'], ['Entretien', 'MENAGE'],
        ['', 'NON_PRECISE'], ['   ', 'NON_PRECISE'], [undefined, 'NON_PRECISE'],
        ['Formation', 'AUTRE'], ['Réunion', 'AUTRE'],
      ]
      const hh = (i: number) => String(5 + i).padStart(2, '0')
      // v5 (rule-evp-link-nir-only): every row carries the NIR of the collaborator, the names no longer attach anything
      setNir(SIRET_A, 'emp-ct-a1', NIR1)
      aq.rows(
        cases.map(([type], i) => {
          const row: any = pros({ debut: `${hh(i)}:00`, fin: `${hh(i)}:30`, type: type ?? '', matricule: NIR1 })
          if (type === undefined) delete row.planning_days_type_creneau
          return row
        }),
      )
      expect((await read()).state).toBe('SUCCEEDED')
      const rows = await plannings()
      expect(rows).toHaveLength(cases.length)
      cases.forEach(([type], i) => expect({ type, got: typeAt(rows, `${hh(i)}:00`) }).toEqual({ type, got: cases[i][1] }))
      expect(rows.every((r) => r.employee_id === 'emp-ct-a1' && r.creche_code === 'alpha')).toBe(true)
    })

    it('[rule-evp-aqoona-slot-type-normalised] the comparison ignores case, accents and the plural', async () => {
      aq.rows([
        pros({ debut: '08:00', fin: '09:00', type: 'GARDES' }),
        pros({ debut: '09:00', fin: '10:00', type: 'Pauses' }),
        pros({ debut: '10:00', fin: '11:00', type: 'Ménages' }),
        pros({ debut: '11:00', fin: '12:00', type: 'ÉNTRETIEN' }),
      ])
      await read()
      expect((await plannings()).map((r) => r.slot_type)).toEqual(['GARDE', 'PAUSE', 'MENAGE', 'MENAGE'])
    })

    it('[rule-evp-aqoona-slot-type-anomalies] one anomaly per distinct unknown type (counting every spelling together) and one for all the rows without type; they block neither the storage nor the matching', async () => {
      // v5 (rule-evp-link-nir-only): the six rows carry the NIR of the collaborator, so that the matching is what is proved not blocked
      setNir(SIRET_A, 'emp-ct-a1', NIR1)
      aq.rows([
        pros({ debut: '06:00', fin: '07:00', type: 'Formation', matricule: NIR1 }),
        pros({ debut: '07:00', fin: '08:00', type: 'FORMATION ', matricule: NIR1 }),
        pros({ debut: '08:00', fin: '09:00', type: 'Réunion', matricule: NIR1 }),
        pros({ debut: '09:00', fin: '10:00', type: '', matricule: NIR1 }),
        pros({ debut: '10:00', fin: '11:00', type: '  ', matricule: NIR1 }),
        pros({ debut: '11:00', fin: '12:00', type: 'Garde', matricule: NIR1 }),
      ])
      const run = await read()
      expect(run.state).toBe('SUCCEEDED')
      expect((await sourceOf()).state).not.toBe('FAILED')
      const unknown = await ofType('aqoona_slot_type_unknown')
      expect(unknown).toHaveLength(2)
      expect(unknown.every((a: any) => a.label === 'Type de créneau Aqoona inconnu' && a.subject.length >= 1 && a.subject.length <= 100)).toBe(true)
      expect(unknown.map((a: any) => a.subject.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()).sort()).toEqual(['formation', 'reunion'])
      const formation = unknown.find((a: any) => /formation/i.test(a.subject))
      expect(formation.detail).toMatch(/2/)
      const missing = await ofType('aqoona_slot_type_missing')
      expect(missing).toHaveLength(1)
      expect(missing[0]).toMatchObject({ label: 'Créneau Aqoona sans type', subject: 'Aqoona Pros' })
      expect(missing[0].detail).toMatch(/2/)
      expect(await countRows('aqoona_plannings', 'employee_id is not null')).toBe(6)
    })

    it('[rule-evp-aqoona-nir-no-trace-in-types] a slot type that looks like a NIR is ranked in AUTRE and its anomaly says « Type illisible » instead of quoting it', async () => {
      aq.rows([pros({ type: NIR1 }), pros({ debut: '14:00', fin: '15:00', type: spaced(NIR2) })])
      const run = await read()
      expect(run.state).toBe('SUCCEEDED')
      expect((await plannings()).map((r) => r.slot_type)).toEqual(['AUTRE', 'AUTRE'])
      const unknown = await ofType('aqoona_slot_type_unknown')
      expect(unknown.length).toBeGreaterThanOrEqual(1)
      expect(unknown.every((a: any) => a.subject === 'Type illisible')).toBe(true)
      expectNoNir('anomalies', JSON.stringify(await anomalies()))
      expectNoNir('tables', await allTablesText())
    })
  })

  // ───────────────────────────── noms et établissements ─────────────────────────────
  describe('names and establishments', () => {
    it('[rule-evp-aqoona-text-normalised] the example of the request: stray spaces, case and accents are ignored for the person and the establishment; person_ref is « Prénom NOM » cleaned', async () => {
      await seedCompany('co-x', '99999999999999', 'Société X')
      await seedCreche('exemple', { name: "Les MicroStars d'Exemple", siret: '99999999999999' })
      await seedContract('co-x', 'ct-x1', 'Prénom', 'NOM')
      aq.rows([
        { user_firstname: 'Prénom', user_lastname: 'NOM ', user_matricule: '', etablissement_name: "Les MicroStars d'Exemple ", planning_days_date: d(-3), planning_days_heure_debut: '12:00', planning_days_heure_fin: '14:15', planning_days_type_creneau: 'Garde' },
        { user_firstname: '  prénom ', user_lastname: ' nom', user_matricule: '', etablissement_name: "  LES  MICROSTARS D'EXEMPLE", planning_days_date: d(-2), planning_days_heure_debut: '12:00', planning_days_heure_fin: '14:15', planning_days_type_creneau: 'Garde' },
        { user_firstname: 'PRENOM', user_lastname: 'Nom', user_matricule: '', etablissement_name: "les micro stars d'exemple", planning_days_date: d(-1), planning_days_heure_debut: '12:00', planning_days_heure_fin: '14:15', planning_days_type_creneau: 'Garde' },
      ])
      expect((await read()).state).toBe('SUCCEEDED')
      const rows = await plannings()
      expect(rows).toHaveLength(3)
      // v5 (rule-evp-link-nir-only): the names normalise the person and the establishment, but never designate a collaborator
      for (const r of rows) expect(r).toMatchObject({ person_ref: 'Prénom NOM', creche_code: 'exemple', company_id: 'co-x', employee_id: null, slot_type: 'GARDE' })
      expect(rows[0]?.person_ref).toBe('Prénom NOM')
    })

    it('[rule-evp-aqoona-text-normalised] « Micro-Stars », « MicroStars », « Micro Stars » and a spelling with stray spaces are the same establishment', async () => {
      await seedCompany('co-x', '99999999999999', 'Société X')
      await seedCreche('ms', { name: 'Micro-Stars', siret: '99999999999999' })
      await seedContract('co-x', 'ct-x1', 'Ada', 'Lovelace')
      aq.rows(['Micro-Stars', 'MicroStars', 'Micro Stars', '  micro   stars  '].map((etab, i) => pros({ prenom: 'Ada', nom: 'Lovelace', etab, day: d(-4 + i) })))
      expect((await read()).state).toBe('SUCCEEDED')
      const rows = await plannings()
      expect(rows).toHaveLength(4)
      expect(rows.every((r) => r.creche_code === 'ms' && r.employee_id === null)).toBe(true)
    })

    it('[rule-evp-aqoona-etab-unique] an establishment that matches two verified crèches, an unknown one or only an unverified crèche is stored without crèche and reported « Planning non rattaché »', async () => {
      await seedCreche('bis1', { name: 'Bis Stars', siret: '88888888888881' })
      await seedCreche('bis2', { name: 'BisStars', siret: '88888888888882' })
      await seedCreche('brouillon', { name: 'Crèche Brouillon', siret: '88888888888883', verified: false })
      aq.rows([
        pros({ etab: 'bis stars', day: d(-5) }),
        pros({ etab: 'Établissement inconnu', day: d(-4) }),
        pros({ etab: 'Crèche Brouillon', day: d(-3) }),
        pros({ etab: 'Crèche Alpha', day: d(-2) }),
      ])
      expect((await read()).state).toBe('SUCCEEDED')
      const rows = await plannings()
      await expectNirVolume()
      expect(rows.filter((r) => r.creche_code !== null).map((r) => r.creche_code)).toEqual(['alpha'])
      expect(rows).toHaveLength(4)
      const unmatched = await ofType('PLANNING_UNMATCHED')
      expect(unmatched.length).toBeGreaterThanOrEqual(1)
      expect(unmatched.every((a: any) => a.label === 'Planning non rattaché')).toBe(true)
    })

    it('[rule-evp-aqoona-person-ref] person_ref is always « Prénom NOM », never the value of user_matricule; a registration number that is not a NIR is kept nowhere', async () => {
      aq.rows([
        pros({ matricule: 'MAT-00042', day: d(-5) }),
        pros({ matricule: '12345', day: d(-4) }),
        pros({ matricule: NIR1, day: d(-3) }),
        pros({ matricule: '', day: d(-2) }),
      ])
      expect((await read()).state).toBe('SUCCEEDED')
      const rows = await plannings()
      expect(rows.map((r) => r.person_ref)).toEqual(['Léa Martin', 'Léa Martin', 'Léa Martin', 'Léa Martin'])
      const tables = await allTablesText()
      expect(tables).not.toContain('MAT-00042')
      expectNoNir('tables', tables)
    })
  })

  // ───────────────────────────── NIR : appels à PayFit ─────────────────────────────
  describe('NIR: calls to PayFit', () => {
    it('[rule-evp-aqoona-nir-lazy] without any NIR in the window, PayFit is not called at all', async () => {
      aq.rows([pros({ matricule: '' }), pros({ matricule: 'MAT-1', day: d(-2) }), pros({ matricule: '12345', day: d(-1) })])
      expect((await read()).state).toBe('SUCCEEDED')
      expect(payfitCalls()).toHaveLength(0)
      expect(volume((await sourceOf()).volumes, 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count: 0 })
    })

    it('[rule-evp-aqoona-nir-lazy] [rule-evp-link-network-read] [rule-evp-sources-readonly] with a NIR row for one company only, the NIR of every company is requested (the NIR is searched across the network), in read only; the PayFit tables are untouched', async () => {
      const before = JSON.stringify([
        await sql('select * from base.payfit_companies order by id'),
        await sql('select * from base.payfit_employees order by company_id, employee_id'),
        await sql('select * from base.payfit_contracts order by company_id, payfit_contract_id'),
        await sql('select count(*)::int as n from base.payfit_absences'),
      ])
      aq.rows([pros({ matricule: NIR1, day: d(-2) }), pros({ etab: 'Crèche Beta', prenom: 'Zoé', nom: 'Durand', matricule: '', day: d(-2) })])
      expect((await read()).state).toBe('SUCCEEDED')
      const calls = payfitCalls()
      expect(calls.length).toBeGreaterThanOrEqual(1)
      expect(calls.some((c) => /\/companies\/co-a\/collaborators/.test(c.path))).toBe(true)
      expect(calls.some((c) => /\/companies\/co-b\/collaborators/.test(c.path))).toBe(true)
      expect(calls.some((c) => /\/(contracts|contracts-fr|absences)/.test(c.path))).toBe(false)
      expect(calls.every((c) => c.method === 'GET' || (c.method === 'POST' && c.tag === 'payfit-introspect'))).toBe(true)
      expect(
        JSON.stringify([
          await sql('select * from base.payfit_companies order by id'),
          await sql('select * from base.payfit_employees order by company_id, employee_id'),
          await sql('select * from base.payfit_contracts order by company_id, payfit_contract_id'),
          await sql('select count(*)::int as n from base.payfit_absences'),
        ]),
      ).toBe(before)
    })

    it('[rule-evp-aqoona-nir-transient-key] [rule-evp-aqoona-nir-over-name] with the NIR delivered by PayFit (field name per the plan of the module: hypothesis, see the coverage file), a NIR that matches one collaborator wins over differing names; the volume « Rapprochés par NIR » counts it', async () => {
      setNir(SIRET_A, 'emp-ct-a1', NIR1)
      aq.rows([pros({ prenom: 'Prénom', nom: 'Différent', matricule: spaced(NIR1), day: d(-3) }), pros({ prenom: 'Noé', nom: 'Petit', matricule: '', day: d(-2) })])
      const run = await read()
      expect(run.state).toBe('SUCCEEDED')
      const rows = await plannings()
      // v5: the second row, without NIR, is not attached by its names any more
      expect(rows.map((r) => r.employee_id)).toEqual(['emp-ct-a1', null])
      expect(volume((await sourceOf()).volumes, 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count: 1 })
      expect(volume(run.volumes, 'Matricule écarté')).toBeUndefined()
    })

    // The network of the variant `pros` is the 40 keys of PAYFIT_API_KEYS and the fake PayFit refuses 38 of them: the network is not
    // fully read, so a NIR found nowhere is « NIR non vérifié » (rule-evp-link-incomplete-read, D-0021), never « NIR inconnu ».
    // NIR_UNKNOWN, which needs every company of the network read, is proved on the two-key network of the variant `network`
    // (acceptance-v5-linking.test.ts, « [rule-evp-link-causes] NIR_UNKNOWN »).
    it('[rule-evp-link-nir-only] [rule-evp-link-causes] [rule-evp-link-incomplete-read] a NIR that matches nobody does not fall back to the names: the row is not attached, and while some companies of the network cannot be read the cause is « NIR non vérifié »', async () => {
      setNir(SIRET_A, 'emp-ct-a2', NIR3)
      aq.rows([pros({ matricule: NIR1, day: d(-3) })])
      expect((await read()).state).toBe('SUCCEEDED')
      expect((await plannings())[0]).toEqual(expect.objectContaining({ employee_id: null }))
      expect(volume((await sourceOf()).volumes, 'Rapprochés par NIR')).toEqual({ label: 'Rapprochés par NIR', count: 0 })
      expect((await ofType('PLANNING_UNMATCHED')).map((i: any) => i.detail)).toEqual([unmatchedDetail('PAYFIT_INCOMPLETE', 'Crèche Alpha')])
    })

    it('[rule-evp-aqoona-nir-ambiguous][D-0014] a NIR carried by two distinct collaborators of the company: slot stored without employee_id, anomaly « Rattachement par NIR ambigu », no fallback on the names', async () => {
      setNir(SIRET_A, 'emp-ct-a1', NIR1)
      setNir(SIRET_A, 'emp-ct-a2', NIR1)
      aq.rows([pros({ matricule: NIR1 })])
      const started = await POST('/sources/aqoona/refresh', w.rh.token)
      expect(started.status).toBe(202)
      expect((await waitRun(w.rh.token, started.body.runId)).state).toBe('SUCCEEDED')
      const rows = await plannings()
      expect(rows).toHaveLength(1)
      expect(rows[0].employee_id).toBeNull()
      // v5: the detail is the label of the cause, then the crèche read
      const items = (await ofType('PLANNING_UNMATCHED')).filter((i: any) => i.detail === unmatchedDetail('NIR_AMBIGUOUS', 'Crèche Alpha'))
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({ label: 'Planning non rattaché' })
      expect(sameName(items[0].subject, 'Léa Martin')).toBe(true)
    })

    it('[rule-evp-aqoona-nir-ambiguous] one collaborator carrying two contracts and one NIR is one person: matched normally', async () => {
      await sql("insert into base.payfit_contracts (company_id, payfit_contract_id, employee_id, start_date, status) values ('co-a', 'ct-a1-bis', 'emp-ct-a1', '2024-01-01', 'ACTIVE')")
      pf.company(SIRET_A).contracts.push({ contractId: 'ct-a1-bis', collaboratorId: 'emp-ct-a1', startDate: '2024-01-01', endDate: null })
      setNir(SIRET_A, 'emp-ct-a1', NIR1)
      aq.rows([pros({ prenom: 'Prénom', nom: 'Autre', matricule: NIR1 })])
      expect((await read()).state).toBe('SUCCEEDED')
      expect((await plannings())[0]).toEqual(expect.objectContaining({ employee_id: 'emp-ct-a1' }))
      expect(await ofType('PLANNING_UNMATCHED')).toEqual([])
    })

    it('[rule-evp-aqoona-nir-unavailable] [rule-evp-link-incomplete-read] [rule-evp-company-named-in-anomalies] scope missing (403), company unreachable (500) or key absent: the NIR of that company cannot be read, so its rows are not attached (no fallback on the names), the anomaly « Rapprochement par NIR indisponible » names the company (name and SIRET), the reading stays SUCCEEDED and not PARTIAL', async () => {
      await seedCompany('co-nokey', '77777777777777', 'Société sans clé')
      await seedCreche('nokey', { name: 'Crèche Sans Clé', siret: '77777777777777' })
      await seedContract('co-nokey', 'ct-nk1', 'Nina', 'Clé')
      pf.failAlways(SIRET_A, 'collaborators', 403)
      pf.failAlways(SIRET_B, 'collaborators', 500)
      aq.rows([
        pros({ matricule: NIR1, day: d(-3) }),
        pros({ etab: 'Crèche Beta', prenom: 'Zoé', nom: 'Durand', matricule: NIR2, day: d(-3) }),
        pros({ etab: 'Crèche Sans Clé', prenom: 'Nina', nom: 'Clé', matricule: NIR3, day: d(-3) }),
      ])
      const run = await read()
      expect(run.state).toBe('SUCCEEDED')
      expect((await sourceOf()).state).not.toBe('PARTIAL')
      // the anomalies are checked first, through the API, so that a failure here is a failed expectation and not a read of a column that v2 does not have
      const items = await ofType('aqoona_nir_unavailable')
      expect(items.map((i: any) => i.subject).sort()).toEqual([ALPHA, BETA, companyLabel('Société sans clé', '77777777777777')].sort())
      expect(items.every((i: any) => i.label === 'Rapprochement par NIR indisponible' && i.detail === AQ_UNAVAILABLE_DETAIL)).toBe(true)
      const rows = await plannings()
      expect(rows.map((r) => r.employee_id)).toEqual([null, null, null])
      expect((await ofType('PLANNING_UNMATCHED')).map((i: any) => i.detail).sort()).toEqual(
        [unmatchedDetail('PAYFIT_INCOMPLETE', 'Crèche Alpha'), unmatchedDetail('PAYFIT_INCOMPLETE', 'Crèche Beta'), unmatchedDetail('PAYFIT_INCOMPLETE', 'Crèche Sans Clé')].sort(),
      )
      expectNoNir('anomalies', JSON.stringify(await anomalies()))
    })
  })

  // ───────────────────────────── le NIR n'est jamais conservé ─────────────────────────────
  describe('the NIR is never kept', () => {
    it('[rule-evp-aqoona-nir-never-stored] [rule-evp-secrets-never-exposed] no NIR in any table, answer, export, audit entry, notification, anomaly, run or server log — also when PayFit delivers it, when a slot type looks like a NIR and when the reading fails with an upstream message echoing it', async () => {
      const offset = logSize()
      setNir(SIRET_A, 'emp-ct-a1', NIR1)
      setNir(SIRET_A, 'emp-ct-a2', NIR3)
      setNir(SIRET_B, 'emp-ct-b1', NIR3)
      aq.rows([
        pros({ matricule: spaced(NIR1), day: d(-5), type: 'Garde' }),
        pros({ matricule: NIR2, day: d(-4), type: NIR3 }),
        pros({ prenom: 'Noé', nom: 'Petit', matricule: NIR3, day: d(-3) }),
        pros({ etab: 'Crèche Beta', prenom: 'Zoé', nom: 'Durand', matricule: NIR3, day: d(-2) }),
      ])
      const run = await read()
      expect(run.state).toBe('SUCCEEDED')
      // v3 anchor, first expectation after the reading: the NIR delivered by PayFit is used as a key (then forgotten), v2 discarded it.
      // NIR1 → emp-ct-a1 (attached); NIR3 → emp-ct-a2 (company A) and emp-ct-b1 (company B): ambiguous since v5 (D-0020); NIR2 matches nobody.
      await expectNirVolume(1)
      expect((await refresh(w.rh.token, 'payfit')).state).toBe('SUCCEEDED')
      aq.reply = { status: 502, body: { error: 'bad gateway', detail: `ligne ${NIR1} ${spaced(NIR2)}` } }
      const failed = await read()
      expect(failed.state).toBe('FAILED')
      aq.reply = { body: { echo: NIR2 } }
      expect((await read()).state).toBe('FAILED')
      pf.failAlways(SIRET_A, 'collaborators', { status: 500, body: { error: 'x', detail: NIR1 } })
      aq.rows([pros({ matricule: NIR1, day: d(-1) })])
      expect((await read()).state).toBe('SUCCEEDED')
      const visible = await everythingVisible(w.rh.token, { GET: (p, t) => GET(p, t), POST: (p, t, b) => POST(p, t, b), sql: (q) => sql(q) })
      expectNoNir('visible', visible)
      expectNoNir('tables', await allTablesText())
      expectNoNir('runs', JSON.stringify([run, failed]))
      expectNoNir('server log', logSince(offset))
      expectNoSecret('visible', visible, configuredSecrets())
      expect(ALL_NIRS).toHaveLength(5)
    })
  })
})
