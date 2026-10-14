import { resetData, closePool, sql } from './harness'
import { logSince, logSize } from './renfort-helpers'
import { GET, POST, seedWorld, seedContract, createAbsence, World, countRows, closeEvp, refresh, waitRun } from './evp-helpers'
import {
  AQ_ALT_MAPPING, AqoonaFake, FakeNet, aqBody, aqRow, d, describeStandard, everythingVisible, expectNoSecret, withConfigFile, configuredSecrets,
} from './v2-helpers'

const ERROR_CODES = ['sources.not_configured', 'sources.unreachable', 'sources.refused', 'sources.rate_limited', 'sources.unexpected_format']
const NIRS = ['1850575123456', '2 85 05 75 123 456 78', '185052A123456', '2 90 11 2B 045 012 31']

const withoutDay = (row: ReturnType<typeof aqRow>) => {
  const copy: any = JSON.parse(JSON.stringify(row))
  delete copy.planning_days_date
  return copy
}
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

// Acceptance suite of version v2-evp-sources: real, read-only reading of the Aqoona tokenised addresses (JSON).
// The addresses come from AQOONA_URLS of api/.env.test (at least two) and are served by fake servers; the field mapping is
// the test file acceptance/fixtures/aqoona-mapping.test.json designated by AQOONA_MAPPING_FILE.
describeStandard('Aqoona reading (v2-evp-sources)', () => {
  const net = new FakeNet()
  let aq: AqoonaFake
  let w: World

  beforeAll(async () => {
    aq = new AqoonaFake()
    await aq.mount(net)
  })
  afterAll(async () => {
    await net.close()
    await closeEvp()
    await closePool()
  })
  beforeEach(async () => {
    await resetData()
    aq.reset()
    net.clear()
    w = await seedWorld()
  })

  const read = () => refresh(w.rh.token, 'aqoona')
  async function readSlow() {
    const started = await POST('/sources/aqoona/refresh', w.rh.token)
    expect(started.status).toBe(202)
    return waitRun(w.rh.token, started.body.runId, 170_000)
  }
  const sourceOf = async () => (await GET('/sources', w.rh.token)).body.items.find((i: any) => i.key === 'aqoona')
  const anomalies = async () => (await GET('/sources/aqoona/anomalies?size=50', w.rh.token)).body
  const labels = (a: any) => a.items.map((i: any) => i.label)
  const rowsOf = (rows: unknown[]) => ({ body: aqBody(rows) })
  const plannings = () => sql('select person_ref, creche_code, day::text as day from base.aqoona_plannings order by day, person_ref')
  const callsOf = (i: number) => net.calls(`aqoona-${i}`)

  // ───────────────────────────── requête ─────────────────────────────
  describe('the request sent to each address', () => {
    it('[rule-evp-aqoona-get-only] [rule-evp-aqoona-url-secret] one single GET per address, on the address as configured: no header of authentication, no parameter added but dateBegin and dateEnd (v3, rule-evp-aqoona-window-params)', async () => {
      const run = await read()
      expect(run.state).toBe('SUCCEEDED')
      for (const e of aq.entries) {
        const calls = callsOf(e.index)
        expect(calls).toHaveLength(1)
        expect(calls[0].method).toBe('GET')
        const sent = new URLSearchParams(calls[0].search)
        expect(sent.get('dateBegin')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(sent.get('dateEnd')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        sent.delete('dateBegin')
        sent.delete('dateEnd')
        const configured = new URLSearchParams(new URL(e.url).search)
        expect([...sent.entries()].sort()).toEqual([...configured.entries()].sort())
        expect(calls[0].headers.authorization).toBeUndefined()
        expect(calls[0].headers.cookie).toBeUndefined()
        expect(String(calls[0].headers.accept)).toMatch(/application\/json/)
      }
      expect(net.log.every((r) => r.method === 'GET')).toBe(true)
    })

    it('[rule-evp-aqoona-get-only] a redirection is not followed: the target is never requested and the address is reported unreachable', async () => {
      const origin = new URL(aq.entries[0].bare).origin
      await net.mount('aqoona-redirected', `${origin}/aqoona-redirected`, (c) => c.json(200, aqBody([aqRow({ prenom: 'Redir', nom: 'Cible' })])))
      aq.set(0, { redirectTo: `${origin}/aqoona-redirected/hit?stolen=1` })
      const run = await read()
      expect(net.calls('aqoona-redirected')).toHaveLength(0)
      expect(await countRows('aqoona_plannings', "person_ref = 'Redir Cible'")).toBe(0)
      expect(run.state).toBe('SUCCEEDED')
      expect((await sourceOf()).state).toBe('PARTIAL')
      const item = (await anomalies()).items.find((i: any) => i.type === 'aqoona_address_unreachable')
      expect(item.subject).toBe(aq.entries[0].label)
    })

    it('[rule-evp-aqoona-get-only] an answer larger than 20 MB is refused: the reading ends FAILED and keeps the plannings of the last success', async () => {
      aq.set(0, rowsOf([aqRow({ matricule: 'MAT-KEEP', day: d(-3) })]))
      await read()
      const kept = JSON.stringify(await plannings())
      aq.setAll({ bytes: 21 * 1024 * 1024 })
      const run = await read()
      expect(run.state).toBe('FAILED')
      expect(ERROR_CODES).toContain((await sourceOf()).lastError.code)
      expect(JSON.stringify(await plannings())).toBe(kept)
    }, 120_000)

    it('[rule-evp-sources-readonly] only reading calls are made on the addresses (GET), and nothing else is contacted', async () => {
      await read()
      expect(net.log.length).toBeGreaterThan(0)
      expect(net.log.every((r) => r.method === 'GET' && /^aqoona-\d+$/.test(r.tag))).toBe(true)
    })
  })

  // ───────────────────────────── correspondance et fenêtre ─────────────────────────────
  describe('field mapping, window and matching', () => {
    it('[rule-evp-aqoona-fields] [rule-evp-aqoona-field-mapping] the fields are found where the mapping file says (dotted paths below the record array): person, crèche, day, start and end', async () => {
      aq.set(0, rowsOf([aqRow({ matricule: 'MAT-00042', day: d(-3) }), aqRow({ matricule: null, prenom: 'Noé', nom: 'Petit', day: d(-2) })]))
      const run = await read()
      expect(run.state).toBe('SUCCEEDED')
      const rows = await plannings()
      expect(rows).toHaveLength(2)
      expect(rows.map((r) => r.day)).toEqual([d(-3), d(-2)])
      // v3 (rule-evp-aqoona-person-ref): « Prénom NOM », never the value of user_matricule
      expect(rows.map((r) => r.person_ref)).toEqual(['Léa Martin', 'Noé Petit'])
      expect(rows.every((r) => r.creche_code === 'alpha')).toBe(true)
    })

    it('[rule-evp-aqoona-field-mapping] a mapping file with a record array at the root, days as DD/MM/YYYY and times as HH:mm:ss is honoured (the format is configuration, not code)', async () => {
      await withConfigFile('AQOONA_MAPPING_FILE', AQ_ALT_MAPPING, async () => {
        aq.set(0, { body: [{ mat: 'MAT-ALT', first: 'Léa', last: 'Martin', site: 'Crèche Alpha', day: dmy(d(-3)), from: '08:00:00', to: '16:30:00' }] })
        const run = await read()
        expect(run.state).toBe('SUCCEEDED')
        expect(await plannings()).toEqual([{ person_ref: 'Léa Martin', creche_code: 'alpha', day: d(-3) }])
      })
    })

    it('[rule-evp-aqoona-field-mapping] [rule-evp-aqoona-mapping-provisional] a mapping file that does not follow its schema ends the reading FAILED with sources.not_configured, without quoting its content', async () => {
      await withConfigFile('AQOONA_MAPPING_FILE', { records: 'planning.items', fields: { matricule: 'secret-field-name-xyz' } }, async () => {
        const run = await read()
        expect(run.state).toBe('FAILED')
        const src = await sourceOf()
        expect(src.lastError.code).toBe('sources.not_configured')
        expect(JSON.stringify(src.lastError)).not.toContain('secret-field-name-xyz')
      })
    })

    it('[rule-evp-aqoona-window] the window runs from D-28 to D+35: slots outside it are ignored, the bounds are kept', async () => {
      aq.set(0, rowsOf([-29, -28, 0, 35, 36].map((n, i) => aqRow({ matricule: `MAT-W${i}`, day: d(n) }))))
      expect((await read()).state).toBe('SUCCEEDED')
      expect((await plannings()).map((r) => r.day)).toEqual([d(-28), d(0), d(35)])
      const src = await sourceOf()
      expect(src.windowFrom).toBe(d(-28))
      expect(src.windowTo).toBe(d(35))
    })

    // v3: « Matricule écarté » no longer exists (rule-evp-aqoona-nir-transient-key replaces rule-evp-sources-nir-discarded for the « Pros » flow;
    // the reading by NIR is covered by acceptance-v3-nir-siret.test.ts). What stays true here: a value of user_matricule is stored nowhere.
    it('[rule-evp-aqoona-nir-never-stored] [rule-evp-aqoona-person-ref] a registration number, NIR-like or not, is never stored, displayed, logged nor reported, and no « Matricule écarté » volume is produced', async () => {
      const offset = logSize()
      aq.set(0, rowsOf([
        ...NIRS.map((m, i) => aqRow({ matricule: m, day: d(-3 - i) })),
        aqRow({ matricule: 'MAT-00042', prenom: 'Noé', nom: 'Petit', day: d(-9) } as any),
        aqRow({ matricule: '12345', prenom: 'Noé', nom: 'Petit', day: d(-10) } as any),
      ]))
      const run = await read()
      expect(run.state).toBe('SUCCEEDED')
      const volume = (v: any[]) => v.find((x) => x.label === 'Matricule écarté')
      expect(volume((await sourceOf()).volumes)).toBeUndefined()
      expect(volume(run.volumes)).toBeUndefined()
      const dumps = [
        JSON.stringify(await sql('select p::text as t from base.aqoona_plannings p')),
        JSON.stringify(await sql('select m::text as t from base.aqoona_mismatches m')),
        JSON.stringify(await sql('select a::text as t from base.source_anomalies a')),
        JSON.stringify(await sql('select r::text as t from base.source_runs r')),
        JSON.stringify(await sql('select l::text as t from base.audit_logs l')),
        (await GET('/sources', w.rh.token)).text,
        (await GET('/sources/aqoona/anomalies?size=50', w.rh.token)).text,
        logSince(offset),
      ]
      for (const text of dumps) {
        for (const m of NIRS) {
          expect(text).not.toContain(m)
          expect(text).not.toContain(m.replace(/\s/g, ''))
        }
      }
      expect(dumps.join('\n')).not.toContain('MAT-00042')
      expect(await countRows('aqoona_plannings', "person_ref = 'Noé Petit'")).toBe(2)
      expect(await countRows('aqoona_plannings', "person_ref = 'Léa Martin'")).toBe(4)
      expect(await countRows('aqoona_plannings')).toBe(6)
    })

    // v3 (rule-evp-aqoona-etab-unique): the crèche is attached as soon as the establishment is unique among the verified crèches, whether or
    // not the collaborator is found; the collaborator (employee_id) is attached only when the match by name is unique in the company of the crèche.
    // v5 (rule-evp-link-nir-only): the collaborator is attached by NIR alone, so rows without NIR keep their crèche and no collaborator.
    it('[rule-evp-sources-links] [rule-evp-aqoona-etab-unique] [rule-evp-link-nir-only] the planning is matched by normalised crèche name; the collaborator is never matched by first and last name, so rows without NIR have none', async () => {
      await seedContract('co-b', 'ct-b2', 'Léa', 'Martin')
      aq.set(0, rowsOf([
        aqRow({ day: d(-1) }),
        aqRow({ prenom: 'Zoé', nom: 'Durand', creche: 'Crèche Alpha', day: d(-2) } as any),
        aqRow({ prenom: 'Inconnu', nom: 'Total', creche: 'Crèche Alpha', day: d(-3) } as any),
        aqRow({ creche: 'Crèche Fantôme', day: d(-4) }),
        aqRow({ creche: 'crèche beta', day: d(-5) }),
      ]))
      await read()
      expect(await countRows('aqoona_plannings')).toBe(5)
      const attached = await sql('select day::text as day, creche_code from base.aqoona_plannings where creche_code is not null order by day')
      expect(attached).toEqual([
        { day: d(-5), creche_code: 'beta' },
        { day: d(-3), creche_code: 'alpha' },
        { day: d(-2), creche_code: 'alpha' },
        { day: d(-1), creche_code: 'alpha' },
      ])
      const withCollaborator = await sql('select day::text as day from base.aqoona_plannings where employee_id is not null order by day')
      expect(withCollaborator).toEqual([])
      const a = await anomalies()
      expect(a.total).toBeGreaterThanOrEqual(3)
      expect((await sourceOf()).anomalyCount).toBe(a.total)
    })

    it('[rule-evp-sources-no-invention] two collaborators with the same name in the same crèche are never guessed: the row keeps its crèche but no collaborator, and an anomaly is visible', async () => {
      await seedContract('co-a', 'ct-twin', 'Léa', 'Martin')
      aq.set(0, rowsOf([aqRow({})]))
      await read()
      expect(await countRows('aqoona_plannings', 'employee_id is not null')).toBe(0)
      expect(await countRows('aqoona_plannings', "creche_code = 'alpha'")).toBe(1)
      expect(await countRows('aqoona_plannings')).toBe(1)
      expect((await anomalies()).total).toBeGreaterThanOrEqual(1)
    })

    it('[rule-evp-sources-no-auto-absence] [rule-evp-sources-aqoona] reading the planning never produces an absence, a notification or a dossier change', async () => {
      const created = await createAbsence(w.dirA.token, { contractId: w.ctA.id })
      expect(created.status).toBe(201)
      const dossiers = JSON.stringify(await sql('select * from base.absences order by id'))
      aq.set(0, rowsOf([aqRow({ day: d(-5) }), aqRow({ day: d(-4) })]))
      await read()
      expect(JSON.stringify(await sql('select * from base.absences order by id'))).toBe(dossiers)
      expect(await countRows('notifications')).toBe(0)
    })
  })

  // ───────────────────────────── format inattendu ─────────────────────────────
  describe('unexpected formats', () => {
    it('[rule-evp-aqoona-unexpected-format][D-0004] four records, one without a usable day: run SUCCEEDED, 3 plannings, one anomaly « Ligne Aqoona inexploitable »', async () => {
      aq.set(0, rowsOf([aqRow({ matricule: 'MAT-1', day: d(-1) }), aqRow({ matricule: 'MAT-2', day: d(-2) }), aqRow({ matricule: 'MAT-3', day: d(-3) }), withoutDay(aqRow({ matricule: 'MAT-4' }))]))
      const started = await POST('/sources/aqoona/refresh', w.rh.token)
      expect(started.status).toBe(202)
      const run = await waitRun(w.rh.token, started.body.runId)
      expect(run.state).toBe('SUCCEEDED')
      expect(await countRows('aqoona_plannings')).toBe(3)
      const listed = await GET('/sources/aqoona/anomalies?size=50', w.rh.token)
      expect(listed.status).toBe(200)
      const items = listed.body.items.filter((i: any) => i.label === 'Ligne Aqoona inexploitable')
      expect(items).toHaveLength(1)
      expect(items[0].detail).toContain('1')
    })

    it('[rule-evp-aqoona-unexpected-format] exactly half of the records unusable is tolerated; more than half fails the whole reading with sources.unexpected_format and keeps the plannings of the last success', async () => {
      aq.set(0, rowsOf([aqRow({ matricule: 'MAT-KEEP', day: d(-6) })]))
      await read()
      aq.set(0, rowsOf([aqRow({ matricule: 'MAT-1', day: d(-1) }), aqRow({ matricule: 'MAT-2', day: d(-2) }), withoutDay(aqRow({})), withoutDay(aqRow({}))]))
      expect((await read()).state).toBe('SUCCEEDED')
      expect(await countRows('aqoona_plannings')).toBe(2)
      aq.set(0, rowsOf([aqRow({ prenom: 'Neuf', nom: 'Rejete', day: d(-1) }), withoutDay(aqRow({})), withoutDay(aqRow({})), withoutDay(aqRow({}))]))
      aq.set(1, rowsOf([withoutDay(aqRow({})), withoutDay(aqRow({}))]))
      const failed = await read()
      expect(failed.state).toBe('FAILED')
      expect((await sourceOf()).lastError.code).toBe('sources.unexpected_format')
      expect(await countRows('aqoona_plannings', "person_ref = 'Neuf Rejete'")).toBe(0)
      expect(await countRows('aqoona_plannings')).toBe(2)
    })

    it.each([
      ['an answer that is not JSON', { raw: '<html><body>Connexion</body></html>' }],
      ['a JSON that is not valid', { raw: '{"planning": {"items": [' }],
      ['a root that is an object holding a string instead of the array', { body: { planning: { items: 'oops' } } }],
      ['a root that is an object instead of the array (rule-evp-aqoona-root-array)', { body: { autre: [] } }],
    ])('[rule-evp-aqoona-unexpected-format] [rule-evp-sources-error-codes] %s ends the reading FAILED with sources.unexpected_format', async (_name, reply) => {
      aq.setAll(reply)
      const run = await read()
      expect(run.state).toBe('FAILED')
      expect((await sourceOf()).lastError.code).toBe('sources.unexpected_format')
    })
  })

  // ───────────────────────────── erreurs ─────────────────────────────
  describe('errors of the addresses', () => {
    it.each([
      [401, 'sources.refused', /Adresse Aqoona refusée/],
      [403, 'sources.refused', /Adresse Aqoona refusée/],
      [404, 'sources.unreachable', /./],
    ])('[rule-evp-sources-error-codes] [rule-evp-sources-failure-state] when every address answers %i the reading ends FAILED with %s, without retry, and the source shows ERROR', async (status, code, message) => {
      aq.set(0, rowsOf([aqRow({ matricule: 'MAT-KEEP', day: d(-3) })]))
      const ok = await read()
      expect(ok.state).toBe('SUCCEEDED')
      const first = await sourceOf()
      const kept = JSON.stringify(await plannings())
      net.clear()
      aq.setAll({ status })
      const run = await read()
      expect(run.state).toBe('FAILED')
      expect(run.errorMessage.length).toBeGreaterThanOrEqual(1)
      expect(run.errorMessage.length).toBeLessThanOrEqual(200)
      const src = await sourceOf()
      expect(src.state).toBe('ERROR')
      expect(src.lastError.code).toBe(code)
      expect(src.lastError.message).toMatch(message)
      expect(src.lastReadAt).toBe(first.lastReadAt)
      expect(JSON.stringify(await plannings())).toBe(kept)
      for (const e of aq.entries) expect(callsOf(e.index)).toHaveLength(1)
    })

    it.each([
      [500, 'a 5xx'],
      [429, 'a 429'],
    ])('[rule-evp-sources-error-codes] [rule-evp-sources-timeouts] %i on every address is retried (3 attempts at most) then the reading ends FAILED with sources.unreachable (%s)', async (status) => {
      aq.setAll({ status })
      const run = await readSlow()
      expect(run.state).toBe('FAILED')
      expect((await sourceOf()).lastError.code).toBe('sources.unreachable')
      for (const e of aq.entries) {
        expect(callsOf(e.index).length).toBeGreaterThanOrEqual(2)
        expect(callsOf(e.index).length).toBeLessThanOrEqual(3)
      }
    }, 180_000)

    it.each([[429], [503]])('[rule-evp-sources-timeouts] a transient %i is retried and the reading succeeds', async (status) => {
      aq.queue(0, { status })
      aq.set(0, rowsOf([aqRow({ prenom: 'Retry', nom: 'Test', day: d(-3) })]))
      const run = await read()
      expect(run.state).toBe('SUCCEEDED')
      expect(callsOf(0)).toHaveLength(2)
      expect(await countRows('aqoona_plannings', "person_ref = 'Retry Test'")).toBe(1)
    })

    it('[rule-evp-sources-timeouts] [rule-evp-sources-error-codes] addresses that never answer end the reading FAILED with sources.unreachable after the 30 second delay of the call', async () => {
      aq.setAll({ hang: true })
      const t0 = Date.now()
      const run = await readSlow()
      expect(run.state).toBe('FAILED')
      expect(Date.now() - t0).toBeGreaterThanOrEqual(25_000)
      expect((await sourceOf()).lastError.code).toBe('sources.unreachable')
    }, 180_000)

    it('[rule-evp-sources-partial-failure][D-0007] two addresses, one fails: run SUCCEEDED, source PARTIAL, the plannings of the address that answers are copied, those of the failing address are kept, anomaly aqoona_address_unreachable named by the label of the address', async () => {
      // person_ref is « Prénom NOM » (v3): the slots are told apart by person and day.
      const refs = async () => (await plannings()).map((r) => `${r.person_ref} ${r.day}`).sort()
      aq.set(0, rowsOf([aqRow({ prenom: 'Anne', nom: 'Alpha', day: d(-3) })]))
      aq.set(1, rowsOf([aqRow({ prenom: 'Zoé', nom: 'Durand', creche: 'Crèche Beta', day: d(-4) })]))
      expect((await read()).state).toBe('SUCCEEDED')
      expect(await refs()).toEqual([`Anne Alpha ${d(-3)}`, `Zoé Durand ${d(-4)}`])
      expect((await sourceOf()).state).toBe('UP_TO_DATE')
      const first = await sourceOf()

      aq.set(0, rowsOf([aqRow({ prenom: 'Anne', nom: 'Alpha', day: d(-2) })]))
      aq.set(1, { status: 401 })
      const run = await read()
      expect(run.state).toBe('SUCCEEDED')
      expect(run.errorMessage).toBeNull()
      const src = await sourceOf()
      expect(src.state).toBe('PARTIAL')
      expect(src.lastError).toBeNull()
      expect(Date.parse(src.lastReadAt)).toBeGreaterThan(Date.parse(first.lastReadAt))
      expect(await refs()).toEqual([`Anne Alpha ${d(-2)}`, `Zoé Durand ${d(-4)}`])
      const items = (await anomalies()).items.filter((i: any) => i.type === 'aqoona_address_unreachable')
      expect(items).toHaveLength(1)
      expect(items[0].label).toBe('Adresse Aqoona inaccessible')
      expect(items[0].subject).toBe(aq.entries[1].label)
      expectNoSecret('anomaly', JSON.stringify(items))

      aq.set(1, rowsOf([aqRow({ prenom: 'Zoé', nom: 'Durand', creche: 'Crèche Beta', day: d(-5) })]))
      expect((await read()).state).toBe('SUCCEEDED')
      expect((await sourceOf()).state).toBe('UP_TO_DATE')
      expect(await refs()).toEqual([`Anne Alpha ${d(-2)}`, `Zoé Durand ${d(-5)}`])
    })
  })

  // ───────────────────────────── droits et secrets ─────────────────────────────
  describe('rights and secrets', () => {
    it('[rule-evp-sources-manual] RH and the superadmin launch the Aqoona reading; directrice, RO and administratrice are refused (403), anonymous 401, and the addresses are never called for them', async () => {
      for (const who of [w.dirA, w.roA, w.adm]) expect((await POST('/sources/aqoona/refresh', who.token)).status).toBe(403)
      expect((await POST('/sources/aqoona/refresh')).status).toBe(401)
      expect(net.log).toHaveLength(0)
      const started = await POST('/sources/aqoona/refresh', w.sup.token)
      expect(started.status).toBe(202)
      expect((await waitRun(w.sup.token, started.body.runId)).state).toBe('SUCCEEDED')
    })

    it('[rule-evp-aqoona-url-secret] [rule-evp-secrets-never-exposed] the full addresses (their token above all) appear nowhere after a success and after a failure: run, source, anomalies, audit trail, notifications, exports, database dumps, server log', async () => {
      const offset = logSize()
      aq.set(0, rowsOf([aqRow({ matricule: 'MAT-1', day: d(-3) })]))
      await read()
      aq.setAll({ status: 500 })
      const failed = await readSlow()
      expect(failed.state).toBe('FAILED')
      expectNoSecret('run', JSON.stringify(failed))
      expectNoSecret('visible', await everythingVisible(w.sup.token, { GET, POST, sql }))
      expectNoSecret('server log', logSince(offset), configuredSecrets())
    }, 180_000)

    it('[rule-evp-sources-refresh-audited] the audit entry of a launched Aqoona reading carries neither address nor token', async () => {
      await read()
      const rows = await sql("select l::text as t from base.audit_logs l where l.action = 'sources:refresh'")
      expect(rows).toHaveLength(1)
      expectNoSecret('audit', JSON.stringify(rows))
    })
  })
})
