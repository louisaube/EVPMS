import { resetData, closePool, sql } from './harness'
import {
  http, GET, POST, UNKNOWN_UUID, seedWorld, seedAbsence, World, auditCount, countRows, addDays, todayParis,
  closeEvp, callsLog, clearFixtures, writeFixture, payfitFixture, waitRun, statusOf, absenceRow,
} from './evp-helpers'

const d = (n: number) => addDays(todayParis(), n)

// Acceptance suite of version v1-evp: completeness complement. Each test names the rule it observes through the API;
// the rules that only concern the screens of the studio are justified in `COVERAGE-v1-evp.md`.
describe('EVP completeness complement', () => {
  let w: World

  beforeEach(async () => {
    await resetData()
    clearFixtures()
    w = await seedWorld()
  })
  afterAll(async () => {
    await closeEvp()
    await closePool()
  })

  const accountBody = (over: Record<string, unknown> = {}) => ({
    email: 'nina.ro@micro-stars.fr', name: 'Nina RO', role: 'RO', active: true, crecheCodes: ['alpha'], ...over,
  })

  // ───────────────────────────── access administration ─────────────────────────────
  describe('access administration', () => {
    it('[rule-evp-access-domain] only an address of the micro-stars.fr domain can be given access: look-alike domains answer 422 access.invalid_domain and create nothing', async () => {
      for (const email of ['nina@gmail.com', 'nina@xmicro-stars.fr', 'nina@micro-stars.fr.evil.com', 'nina@sub.micro-stars.fr']) {
        const res = await POST('/access-accounts', w.rh.token, accountBody({ email }))
        expect(res.status).toBe(422)
        expect(res.body.code).toBe('access.invalid_domain')
      }
      expect(await countRows('evp_accounts', "email like 'nina@%'")).toBe(0)
      expect((await POST('/access-accounts', w.rh.token, accountBody())).status).toBe(201)
    })

    it('[rule-evp-access-no-password] an account created by the access screen has no usable password: the password login is refused', async () => {
      expect((await POST('/access-accounts', w.rh.token, accountBody())).status).toBe(201)
      const res = await http('POST', '/auth/login', { body: { email: 'nina.ro@micro-stars.fr', password: 'Passw0rd!x', returnToken: true } })
      expect(res.status).toBe(401)
      expect(res.body.token).toBeUndefined()
    })

    it('[rule-evp-access-guard] directrice and RO cannot list nor create accesses (403, nothing created); anonymous gets 401', async () => {
      for (const who of [w.dirA, w.roA]) {
        expect((await GET('/access-accounts', who.token)).status).toBe(403)
        expect((await POST('/access-accounts', who.token, accountBody())).status).toBe(403)
      }
      expect((await GET('/access-accounts')).status).toBe(401)
      expect((await POST('/access-accounts', undefined, accountBody())).status).toBe(401)
      expect(await countRows('evp_accounts', "email = 'nina.ro@micro-stars.fr'")).toBe(0)
    })

    it('[rule-evp-account-inactive-logout] a deactivated account is refused on its very next request, so the studio can end its session', async () => {
      expect((await GET('/profile', w.dirA.token)).status).toBe(200)
      await sql('update base.evp_accounts set active = false where user_id = $1', [w.dirA.id])
      const res = await GET('/profile', w.dirA.token)
      expect(res.status).toBe(403)
      expect(res.body.code).toBe('access.account_inactive')
    })
  })

  // ───────────────────────────── dossiers ─────────────────────────────
  describe('dossiers', () => {
    it('[rule-evp-batch-validate-rh-only] the batch validation is reserved to RH: other roles get 403 and nothing is validated; anonymous 401', async () => {
      const id = await seedAbsence({ contractId: w.ctA.id, declaredBy: w.dirA.id, status: 'A_VALIDER', startDate: d(-6), endDate: d(-4) })
      for (const who of [w.dirA, w.roA, w.adm, w.sup]) expect((await POST('/absences/validate-batch', who.token, { absenceIds: [id] })).status).toBe(403)
      expect((await POST('/absences/validate-batch', undefined, { absenceIds: [id] })).status).toBe(401)
      expect(await statusOf(id)).toBe('A_VALIDER')
      expect(await auditCount('absences:validate')).toBe(0)
      const ok = await POST('/absences/validate-batch', w.rh.token, { absenceIds: [id] })
      expect(ok.status).toBe(200)
      expect(await statusOf(id)).toBe('A_SAISIR')
    })

    it('[rule-evp-validate-is-not-transmit] a validation only makes the dossier « à saisir »: no call leaves for PayFit, no presence is recorded', async () => {
      const id = await seedAbsence({ contractId: w.ctA.id, declaredBy: w.dirA.id, status: 'A_VALIDER', startDate: d(-6), endDate: d(-4) })
      const log = callsLog()
      const res = await POST(`/absences/${id}/validate`, w.rh.token)
      expect(res.status).toBe(200)
      expect(res.body.status).toBe('A_SAISIR')
      expect(callsLog()).toBe(log)
      expect(await countRows('payfit_proofs')).toBe(0)
      const row = await absenceRow(id)
      expect(row.status).toBe('A_SAISIR')
      expect(row.saisie_declaree).toBe(false)
    })

    it('[rule-evp-detail-404-indistinct] a dossier outside the perimeter answers exactly like an unknown one: 404 repository.not_found, no trace of its content', async () => {
      const foreign = await seedAbsence({ contractId: w.ctB.id, crecheCode: 'beta', declaredBy: w.rh.id })
      for (const who of [w.dirA, w.roA]) {
        const hidden = await GET(`/absences/${foreign}`, who.token)
        const unknown = await GET(`/absences/${UNKNOWN_UUID}`, who.token)
        expect(hidden.status).toBe(404)
        expect(hidden.body.code).toBe('repository.not_found')
        expect(hidden.body).toEqual(unknown.body)
        expect(hidden.text).not.toContain('Zoé')
      }
      expect((await GET(`/absences/${foreign}`, w.dirB.token)).status).toBe(200)
    })
  })

  // ───────────────────────────── à faire ─────────────────────────────
  describe('todo', () => {
    it('[rule-evp-todo-role-counters] the counters of each role count the dossiers of its own perimeter only', async () => {
      await seedAbsence({ contractId: w.ctA.id, declaredBy: w.rh.id, status: 'A_COMPLETER', startDate: d(-100), endDate: d(-100) })
      await seedAbsence({ contractId: w.ctA2.id, declaredBy: w.rh.id, status: 'A_COMPLETER', startDate: d(-110), endDate: d(-110) })
      await seedAbsence({ contractId: w.ctB.id, crecheCode: 'beta', declaredBy: w.rh.id, status: 'A_COMPLETER', startDate: d(-120), endDate: d(-120) })
      const count = async (who: { token: string }) => (await GET('/todo', who.token)).body.counters.aCompleter.count
      expect(await count(w.dirA)).toBe(2)
      expect(await count(w.roA)).toBe(2)
      expect(await count(w.dirB)).toBe(1)
      expect(await count(w.roB)).toBe(1)
      expect(await count(w.rh)).toBe(3)
    })

    it('[rule-evp-todo-read-notification-no-effect] reading a notification changes nothing in the counters nor in the priority dossiers', async () => {
      const id = await seedAbsence({ contractId: w.ctA.id, declaredBy: w.dirA.id, status: 'A_COMPLETER', startDate: d(-100), endDate: d(-100) })
      const [n] = await sql(
        `insert into base.notifications (kind, absence_id, scope_code, title, message)
         values ('CONFIRMATION', $1, 'alpha', 'Absence retrouvée dans PayFit', 'Le dossier est présent dans PayFit.') returning id`,
        [id],
      )
      const before = (await GET('/todo', w.dirA.token)).body
      expect((await POST(`/notifications/${n.id}/read`, w.dirA.token)).status).toBe(200)
      const after = (await GET('/todo', w.dirA.token)).body
      expect(after.counters).toEqual(before.counters)
      expect(after.priority).toEqual(before.priority)
      expect(await statusOf(id)).toBe('A_COMPLETER')
    })
  })

  // ───────────────────────────── journal ─────────────────────────────
  describe('journal', () => {
    const seedEntry = (summary: string, at: string) =>
      sql(
        `insert into base.audit_logs (occurred_at, actor_id, actor_email, action, object_type, object_id, scope_code, summary)
         values ($1::timestamptz, $2, $3, 'access:create', 'Accès', 'obj', null, $4)`,
        [at, w.rh.id, w.rh.email, summary],
      )

    it('[rule-evp-journal-order] the journal lists the most recent entry first', async () => {
      await seedEntry('Ancienne', '2026-03-01T00:00:00Z')
      await seedEntry('Récente', '2026-03-03T00:00:00Z')
      await seedEntry('Intermédiaire', '2026-03-02T00:00:00Z')
      const res = await GET('/journal-entries', w.rh.token)
      expect(res.status).toBe(200)
      expect(res.body.items.map((i: any) => i.summary)).toEqual(['Récente', 'Intermédiaire', 'Ancienne'])
      const times = res.body.items.map((i: any) => Date.parse(i.occurredAt))
      expect([...times].sort((x, y) => y - x)).toEqual(times)
    })

    it('[rule-evp-journal-guard] only RH and SUPERADMIN open the journal: directrice, RO and ADMINISTRATRICE get 403, anonymous 401', async () => {
      await seedEntry('Secrète', '2026-03-01T00:00:00Z')
      for (const who of [w.dirA, w.roA, w.adm]) {
        const res = await GET('/journal-entries', who.token)
        expect(res.status).toBe(403)
        expect(res.text).not.toContain('Secrète')
      }
      expect((await GET('/journal-entries')).status).toBe(401)
      expect((await GET('/journal-entries', w.rh.token)).status).toBe(200)
      expect((await GET('/journal-entries', w.sup.token)).status).toBe(200)
    })
  })

  // ───────────────────────────── sources ─────────────────────────────
  describe('sources', () => {
    it('[rule-evp-sources-guard] only RH and SUPERADMIN read the sources and their anomalies: directrice, RO and ADMINISTRATRICE get 403, anonymous 401', async () => {
      for (const path of ['/sources', '/sources/payfit/anomalies']) {
        for (const who of [w.dirA, w.roA, w.adm]) expect((await GET(path, who.token)).status).toBe(403)
        expect((await GET(path)).status).toBe(401)
        expect((await GET(path, w.rh.token)).status).toBe(200)
        expect((await GET(path, w.sup.token)).status).toBe(200)
      }
    })

    it('[rule-evp-sources-payfit-aqoona-manual] PayFit and Aqoona are read only when RH launches them: others get 403 and no run starts', async () => {
      writeFixture('payfit', payfitFixture([]))
      writeFixture('aqoona', { rows: [] })
      for (const key of ['payfit', 'aqoona']) {
        for (const who of [w.dirA, w.roA, w.adm]) expect((await POST(`/sources/${key}/refresh`, who.token)).status).toBe(403)
        expect((await POST(`/sources/${key}/refresh`)).status).toBe(401)
      }
      expect(await countRows('source_runs')).toBe(0)
      for (const key of ['payfit', 'aqoona']) {
        const started = await POST(`/sources/${key}/refresh`, w.rh.token)
        expect(started.status).toBe(202)
        expect((await waitRun(w.rh.token, started.body.runId)).state).toBe('SUCCEEDED')
      }
      expect(await countRows('source_runs')).toBeGreaterThanOrEqual(2)
    })
  })
})
