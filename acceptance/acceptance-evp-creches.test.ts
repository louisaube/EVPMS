import { resetData, closePool, sql } from './harness'
import {
  http, GET, POST, PATCH, qs, UNKNOWN_UUID, seedWorld, seedCreche, seedAccount, seedAbsence, createAbsence, World, auditRows, auditCount,
  countRows, monthShift, todayParis, addDays, sortedKeys, closeEvp,
} from './evp-helpers'

// Acceptance suite of version v1-evp: crèches, imported contracts, monthly closure, payroll month.
describe('EVP crèches, contracts and monthly closure', () => {
  let w: World

  beforeEach(async () => {
    await resetData()
    w = await seedWorld()
  })
  afterAll(async () => {
    await closeEvp()
    await closePool()
  })

  // ───────────────────────────── GET /creches ─────────────────────────────
  describe('GET /creches', () => {
    it('[rule-evp-creche-scope] a directrice sees only her crèche, with exactly the specified fields', async () => {
      const res = await GET('/creches', w.dirA.token)
      expect(res.status).toBe(200)
      expect(res.body.items).toEqual([
        { code: 'alpha', name: 'Crèche Alpha', siret: '11111111111111', directriceName: 'Camille Alpha', roNames: ['Rosa Alpha'], verified: true },
      ])
      expect(sortedKeys(res.body.items[0])).toEqual(['code', 'directriceName', 'name', 'roNames', 'siret', 'verified'])
    })

    it('[rule-evp-creche-scope] a RO sees only the crèches explicitly assigned to her, another RO sees hers', async () => {
      expect((await GET('/creches', w.roA.token)).body.items.map((c: any) => c.code)).toEqual(['alpha'])
      expect((await GET('/creches', w.roB.token)).body.items.map((c: any) => c.code)).toEqual(['beta'])
      const lone = await seedAccount('RO', { creches: [] })
      expect((await GET('/creches', lone.token)).status).toBe(403)
    })

    it('[rule-evp-creche-scope] RH, ADMINISTRATRICE and SUPERADMIN see all crèches', async () => {
      await seedCreche('gamma', { name: 'Crèche Gamma', verified: false })
      for (const a of [w.rh, w.adm, w.sup]) {
        const res = await GET('/creches', a.token)
        expect(res.status).toBe(200)
        expect(res.body.items.map((c: any) => c.code).sort()).toEqual(['alpha', 'beta', 'gamma'])
      }
    })

    it('[rule-evp-creche-scope] a crèche created after the account existed is visible to global roles but not to a directrice of another crèche', async () => {
      await seedCreche('delta', { name: 'Crèche Delta' })
      expect((await GET('/creches', w.rh.token)).body.items.map((c: any) => c.code)).toContain('delta')
      expect((await GET('/creches', w.dirA.token)).body.items.map((c: any) => c.code)).toEqual(['alpha'])
    })

    it('[rule-evp-creche-readonly] there is no route to create, change or delete a crèche: 404 for every write method, nothing changes', async () => {
      const before = await countRows('creches')
      for (const [method, path] of [['POST', '/creches'], ['PATCH', '/creches/alpha'], ['PUT', '/creches/alpha'], ['DELETE', '/creches/alpha']] as const) {
        const res = await http(method, path, { token: w.sup.token, body: { code: 'zzz', name: 'x', siret: '12345678901234' } })
        expect(res.status).toBe(404)
      }
      expect(await countRows('creches')).toBe(before)
      expect((await sql("select name from base.creches where code = 'alpha'"))[0].name).toBe('Crèche Alpha')
    })

    it('[rule-evp-creche-scope] anonymous gets 401', async () => {
      expect((await GET('/creches')).status).toBe(401)
    })
  })

  // ───────────────────────────── GET /creches/:code/contracts ─────────────────────────────
  describe('GET /creches/:code/contracts', () => {
    it('[rule-evp-creche-link-siret] [rule-evp-declare-employee-key] lists the contracts of the PayFit company linked by SIRET, with the local contract identifier', async () => {
      const res = await GET('/creches/alpha/contracts', w.dirA.token)
      expect(res.status).toBe(200)
      expect(res.body.items).toHaveLength(2)
      const lea = res.body.items.find((i: any) => i.employeeName === 'Léa Martin')
      expect(lea).toEqual({ contractId: w.ctA.id, payfitContractId: 'ct-a1', employeeName: 'Léa Martin', startDate: '2020-01-01', endDate: null })
      expect(res.body.items.map((i: any) => i.employeeName)).not.toContain('Zoé Durand')
    })

    it('[rule-evp-declare-employee-key] two collaborators with the same name are two distinct contracts, identified by company + contract, not by name', async () => {
      await sql("insert into base.payfit_employees (company_id, employee_id, first_name, last_name) values ('co-a', 'emp-twin', 'Léa', 'Martin')")
      await sql("insert into base.payfit_contracts (company_id, payfit_contract_id, employee_id, start_date) values ('co-a', 'ct-twin', 'emp-twin', '2021-01-01')")
      const res = await GET(`/creches/alpha/contracts${qs({ search: 'Martin' })}`, w.dirA.token)
      expect(res.body.items).toHaveLength(2)
      expect(new Set(res.body.items.map((i: any) => i.contractId)).size).toBe(2)
      expect(await sql("select 1 from base.payfit_contracts where company_id = 'co-a' and payfit_contract_id = 'ct-a1'")).toHaveLength(1)
    })

    it('[rule-evp-declare-employee-key] the same PayFit contract identifier in two companies is two contracts', async () => {
      await sql("insert into base.payfit_employees (company_id, employee_id, first_name, last_name) values ('co-b', 'emp-x', 'Léa', 'Martin')")
      const ok = await sql("insert into base.payfit_contracts (company_id, payfit_contract_id, employee_id, start_date) values ('co-b', 'ct-a1', 'emp-x', '2021-01-01') returning id")
      expect(ok[0].id).not.toBe(w.ctA.id)
      await expect(
        sql("insert into base.payfit_contracts (company_id, payfit_contract_id, employee_id, start_date) values ('co-b', 'ct-a1', 'emp-x', '2022-01-01')"),
      ).rejects.toThrow()
    })

    it('[rule-evp-creche-link-siret] search narrows by employee name and size caps the list', async () => {
      const byName = await GET(`/creches/alpha/contracts${qs({ search: 'Petit' })}`, w.rh.token)
      expect(byName.body.items.map((i: any) => i.employeeName)).toEqual(['Noé Petit'])
      expect((await GET('/creches/alpha/contracts?size=1', w.rh.token)).body.items).toHaveLength(1)
      expect((await GET('/creches/alpha/contracts?size=20', w.rh.token)).status).toBe(200)
    })

    it.each(['size=0', 'size=21', 'size=x', `search=${'a'.repeat(101)}`])('[rule-evp-creche-link-siret] query %s answers 400 api.validation.incoming_failed', async (q) => {
      const res = await GET(`/creches/alpha/contracts?${q}`, w.rh.token)
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('api.validation.incoming_failed')
    })

    it('[rule-evp-creche-link-siret] a crèche without a PayFit company for its SIRET gets no contract', async () => {
      await seedCreche('gamma', { name: 'Gamma', siret: '33333333333333' })
      const res = await GET('/creches/gamma/contracts', w.rh.token)
      expect(res.status).toBe(200)
      expect(res.body.items).toEqual([])
    })

    it('[rule-evp-creche-scope] a crèche outside the perimeter answers 404, the same as an unknown crèche', async () => {
      const foreign = await GET('/creches/beta/contracts', w.dirA.token)
      const unknown = await GET('/creches/zzz/contracts', w.dirA.token)
      expect(foreign.status).toBe(404)
      expect(unknown.status).toBe(404)
      expect(foreign.body).toEqual(unknown.body)
      expect((await GET('/creches/beta/contracts', w.roA.token)).status).toBe(404)
      expect(foreign.text).not.toContain('Zoé')
    })

    it('[rule-evp-declare-roles] ADMINISTRATRICE gets 403 (no declaration), anonymous 401', async () => {
      expect((await GET('/creches/alpha/contracts', w.adm.token)).status).toBe(403)
      expect((await GET('/creches/alpha/contracts')).status).toBe(401)
    })
  })

  // ───────────────────────────── GET /creches/:code/closures ─────────────────────────────
  describe('GET /creches/:code/closures', () => {
    const windowMonths = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => monthShift(from + i))

    it('[rule-evp-closure-attest] lists the current payroll month and the five previous ones, open by default', async () => {
      const res = await GET('/creches/alpha/closures', w.dirA.token)
      expect(res.status).toBe(200)
      const months = res.body.items.map((i: any) => i.month).sort()
      expect(months).toHaveLength(6)
      const candidates = [windowMonths(-5, 0), windowMonths(-4, 1)].map((c) => c.join(','))
      expect(candidates).toContain(months.join(','))
      for (const item of res.body.items) {
        expect(sortedKeys(item)).toEqual(['closedAt', 'closedByName', 'month', 'openCount', 'status'])
        expect(item).toMatchObject({ status: 'OUVERT', openCount: 0, closedAt: null, closedByName: null })
      }
    })

    it('[rule-evp-closure-open-blocks] openCount counts the open states of the crèche and payroll month only', async () => {
      const m = monthShift(-1)
      for (const status of ['A_COMPLETER', 'ANTICIPEE', 'A_VALIDER', 'A_SAISIR', 'DANS_PAYFIT', 'REJETEE', 'ANNULEE'] as const) {
        const day = addDays(todayParis(), -60 - 5 * ['A_COMPLETER', 'ANTICIPEE', 'A_VALIDER', 'A_SAISIR', 'DANS_PAYFIT', 'REJETEE', 'ANNULEE'].indexOf(status))
        await seedAbsence({ contractId: w.ctA.id, declaredBy: w.rh.id, status, payrollMonth: m, startDate: day, endDate: day })
      }
      await seedAbsence({ contractId: w.ctB.id, crecheCode: 'beta', declaredBy: w.rh.id, status: 'A_VALIDER', payrollMonth: m })
      await seedAbsence({ contractId: w.ctA.id, declaredBy: w.rh.id, status: 'A_VALIDER', payrollMonth: monthShift(-3), startDate: addDays(todayParis(), -200), endDate: addDays(todayParis(), -200) })
      const res = await GET('/creches/alpha/closures', w.dirA.token)
      const item = res.body.items.find((i: any) => i.month === m)
      expect(item.openCount).toBe(4)
      expect(res.body.items.find((i: any) => i.month === monthShift(-3)).openCount).toBe(1)
    })

    it('[rule-evp-closure-attest] a closed month, even older than the window, is listed as CLOTURE with its author and instant', async () => {
      await sql("insert into base.closures (creche_code, month, scope_code, closed_at, closed_by) values ('alpha', '2020-01', 'alpha', '2020-02-03T10:00:00Z', $1)", [w.dirA.id])
      const res = await GET('/creches/alpha/closures', w.rh.token)
      const item = res.body.items.find((i: any) => i.month === '2020-01')
      expect(item).toMatchObject({ status: 'CLOTURE', closedByName: 'Camille Alpha' })
      expect(Date.parse(item.closedAt)).toBe(Date.parse('2020-02-03T10:00:00Z'))
      expect(res.body.items).toHaveLength(7)
    })

    it('[rule-evp-creche-scope] a crèche outside the perimeter answers 404, the same as an unknown one; global roles read any crèche', async () => {
      const foreign = await GET('/creches/beta/closures', w.dirA.token)
      const unknown = await GET('/creches/zzz/closures', w.dirA.token)
      expect(foreign.status).toBe(404)
      expect(foreign.body).toEqual(unknown.body)
      for (const a of [w.rh, w.adm, w.sup]) expect((await GET('/creches/beta/closures', a.token)).status).toBe(200)
      expect((await GET('/creches/alpha/closures')).status).toBe(401)
    })
  })

  // ───────────────────────────── POST /creches/:code/closures/:month ─────────────────────────────
  describe('POST /creches/:code/closures/:month', () => {
    const month = () => monthShift(-3)
    const attest = (token: string | undefined, code = 'alpha', m = month(), body: unknown = { attested: true }) =>
      POST(`/creches/${code}/closures/${m}`, token, body)

    it('[rule-evp-closure-attest] [rule-evp-closure-audited] a directrice attests a month: CLOTURE with author and instant, listed as closed, one audit entry', async () => {
      const res = await attest(w.dirA.token)
      expect(res.status).toBe(200)
      expect(sortedKeys(res.body)).toEqual(['closedAt', 'closedByName', 'month', 'status'])
      expect(res.body).toMatchObject({ month: month(), status: 'CLOTURE', closedByName: 'Camille Alpha' })
      expect(Math.abs(Date.now() - Date.parse(res.body.closedAt))).toBeLessThan(60000)
      expect(await countRows('closures', "creche_code = 'alpha' and month = $1 and closed_by = $2", [month(), w.dirA.id])).toBe(1)
      const listed = (await GET('/creches/alpha/closures', w.dirA.token)).body.items.find((i: any) => i.month === month())
      expect(listed.status).toBe('CLOTURE')
      const entries = await auditRows('closures:attest')
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ actor_id: w.dirA.id, object_type: 'Clôture' })
    })

    it('[rule-evp-closure-api-roles] the API lets directrice, RO, RH and SUPERADMIN attest within their perimeter, and refuses ADMINISTRATRICE with 403', async () => {
      expect((await attest(w.adm.token)).status).toBe(403)
      expect((await attest(w.roA.token, 'alpha', monthShift(-4))).status).toBe(200)
      expect((await attest(w.rh.token, 'alpha', monthShift(-5))).status).toBe(200)
      expect((await attest(w.sup.token, 'beta', monthShift(-4))).status).toBe(200)
      expect(await countRows('closures', "month = $1 and creche_code = 'alpha'", [month()])).toBe(0)
      expect((await attest(undefined)).status).toBe(401)
    })

    it('[rule-evp-closure-open-blocks] any open dossier, even « à saisir », blocks the attestation with 409 closures.open_absences and details.openCount', async () => {
      const day = addDays(todayParis(), -100)
      await seedAbsence({ contractId: w.ctA.id, declaredBy: w.rh.id, status: 'A_SAISIR', payrollMonth: month(), startDate: day, endDate: day })
      await seedAbsence({ contractId: w.ctA2.id, declaredBy: w.rh.id, status: 'A_COMPLETER', payrollMonth: month(), startDate: day, endDate: day })
      await seedAbsence({ contractId: w.ctA2.id, declaredBy: w.rh.id, status: 'DANS_PAYFIT', payrollMonth: month(), startDate: addDays(day, 10), endDate: addDays(day, 10) })
      const res = await attest(w.dirA.token)
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('closures.open_absences')
      expect(res.body.details.openCount).toBe(2)
      expect(await countRows('closures')).toBe(0)
      expect(await auditCount('closures:attest')).toBe(0)
    })

    it.each(['A_COMPLETER', 'ANTICIPEE', 'A_VALIDER', 'A_SAISIR'] as const)('[rule-evp-closure-open-blocks] a %s dossier blocks the attestation', async (status) => {
      await seedAbsence({ contractId: w.ctA.id, declaredBy: w.rh.id, status, payrollMonth: month() })
      expect((await attest(w.dirA.token)).status).toBe(409)
    })

    it.each(['DANS_PAYFIT', 'REJETEE', 'ANNULEE'] as const)('[rule-evp-closure-open-blocks] a %s dossier does not block the attestation', async (status) => {
      await seedAbsence({ contractId: w.ctA.id, declaredBy: w.rh.id, status, payrollMonth: month() })
      expect((await attest(w.dirA.token)).status).toBe(200)
    })

    it('[rule-evp-closure-open-blocks] open dossiers of another crèche or of another payroll month do not block', async () => {
      await seedAbsence({ contractId: w.ctB.id, crecheCode: 'beta', declaredBy: w.rh.id, status: 'A_VALIDER', payrollMonth: month() })
      await seedAbsence({ contractId: w.ctA.id, declaredBy: w.rh.id, status: 'A_VALIDER', payrollMonth: monthShift(-4) })
      expect((await attest(w.dirA.token)).status).toBe(200)
    })

    it('[rule-evp-closure-open-blocks] the count is replayed at attestation: a dossier opened after the listing blocks it', async () => {
      const listed = await GET('/creches/alpha/closures', w.dirA.token)
      expect(listed.body.items.find((i: any) => i.month === month()).openCount).toBe(0)
      await seedAbsence({ contractId: w.ctA.id, declaredBy: w.rh.id, status: 'A_VALIDER', payrollMonth: month() })
      expect((await attest(w.dirA.token)).status).toBe(409)
    })

    it('[rule-evp-closure-attest] a month already closed answers 409 closures.already_closed, with a single row and a single audit entry', async () => {
      expect((await attest(w.dirA.token)).status).toBe(200)
      const again = await attest(w.dirA.token)
      expect(again.status).toBe(409)
      expect(again.body.code).toBe('closures.already_closed')
      expect(await countRows('closures', "creche_code = 'alpha' and month = $1", [month()])).toBe(1)
      expect(await auditCount('closures:attest')).toBe(1)
    })

    it('[rule-evp-closure-attest] four parallel attestations of the same month give one 200 and three 409, no 5xx', async () => {
      const results = await Promise.all([1, 2, 3, 4].map(() => attest(w.dirA.token)))
      expect(results.filter((r) => r.status === 200)).toHaveLength(1)
      expect(results.filter((r) => r.status === 409)).toHaveLength(3)
      expect(await countRows('closures')).toBe(1)
    })

    it('[rule-evp-closure-month-bounds] a future month is refused 400, the current and past months are accepted', async () => {
      for (const m of [monthShift(2), monthShift(24), '2999-12']) {
        const res = await attest(w.dirA.token, 'alpha', m)
        expect(res.status).toBe(400)
      }
      expect(await countRows('closures')).toBe(0)
      expect((await attest(w.dirA.token, 'alpha', '2020-01')).status).toBe(200)
    })

    it.each(['2026-13', '2026-00', '26-01', '2026-1', 'abcd-ef', '2026-01-01', '2026/01'])('[rule-evp-closure-month-bounds] malformed month %s answers 400 api.validation.incoming_failed', async (m) => {
      const res = await attest(w.dirA.token, 'alpha', m)
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('api.validation.incoming_failed')
    })

    it('[rule-evp-closure-attest] attested must be the literal true: false, missing, string and extra shapes answer 400, nothing closed', async () => {
      for (const body of [{ attested: false }, {}, { attested: 'true' }, { attested: 1 }, { attested: null }]) {
        const res = await attest(w.dirA.token, 'alpha', month(), body)
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('api.validation.incoming_failed')
      }
      expect(await countRows('closures')).toBe(0)
      expect(await auditCount('closures:attest')).toBe(0)
    })

    it('[rule-evp-creche-scope] a crèche outside the perimeter answers 404 and writes nothing, the same as an unknown crèche', async () => {
      const foreign = await attest(w.dirA.token, 'beta')
      const unknown = await attest(w.dirA.token, 'zzz')
      expect(foreign.status).toBe(404)
      expect(foreign.body).toEqual(unknown.body)
      expect((await attest(w.roA.token, 'beta')).status).toBe(404)
      expect(await countRows('closures')).toBe(0)
    })

    it('[rule-evp-closure-no-reopen] there is no route to reopen or delete a closure: 404, the closure stays', async () => {
      await attest(w.dirA.token)
      for (const [method, path] of [
        ['DELETE', `/creches/alpha/closures/${month()}`], ['PATCH', `/creches/alpha/closures/${month()}`],
        ['PUT', `/creches/alpha/closures/${month()}`], ['POST', `/creches/alpha/closures/${month()}/reopen`],
      ] as const) {
        const res = await http(method, path, { token: w.rh.token, body: { attested: false } })
        expect(res.status).toBe(404)
      }
      expect(await countRows('closures')).toBe(1)
    })
  })

  // ───────────────────────────── mois de paie ─────────────────────────────
  describe('payroll month (rule of the 25th)', () => {
    /**
     * `created_at` d'un dossier est antidaté par SQL, puis `PATCH /absences/:id` rejoue les contrôles et recalcule le mois de paie
     * avec la date de création d'origine (plan du module, `PATCH`).
     */
    async function payrollMonthFor(createdAt: string, start: string): Promise<string> {
      const res = await createAbsence(w.rh.token, { contractId: w.ctA.id, startDate: addDays(todayParis(), -30), endDate: addDays(todayParis(), -30) })
      expect(res.status).toBe(201)
      await sql('update base.absences set created_at = $1::timestamptz where id = $2', [createdAt, res.body.id])
      const patched = await PATCH(`/absences/${res.body.id}`, w.rh.token, { startDate: start, endDate: start, startHalf: 'MATIN', endHalf: 'APRES_MIDI' })
      expect(patched.status).toBe(200)
      return patched.body.payrollMonth
    }

    it.each([
      ['created on the 25th, start in the same month → month of the start', '2026-03-25T12:00:00Z', '2026-03-10', '2026-03'],
      ['created on the 1st, start in the previous month → month of the start', '2026-03-01T12:00:00Z', '2026-02-20', '2026-02'],
      ['created on the 26th, start in the same month → month following the creation', '2026-03-26T12:00:00Z', '2026-03-10', '2026-04'],
      ['created on the 31st, start in the previous month → month following the creation', '2026-03-31T12:00:00Z', '2026-02-27', '2026-04'],
      ['created on the 26th, start in a later future month → that future month', '2026-03-26T12:00:00Z', '2026-05-02', '2026-05'],
      ['created on the 26th, start in the month following the creation → that month', '2026-03-26T12:00:00Z', '2026-04-02', '2026-04'],
      ['created on the 25th, start in a future month → that month (start month)', '2026-03-25T12:00:00Z', '2026-05-02', '2026-05'],
      ['created on 26 December, start in December → January of the next year', '2025-12-26T12:00:00Z', '2025-12-05', '2026-01'],
    ])('[rule-evp-closure-payroll-month] %s', async (_label, createdAt, start, expected) => {
      expect(await payrollMonthFor(createdAt, start)).toBe(expected)
    })

    it('[rule-evp-closure-payroll-month] a dossier created today carries a well-formed payroll month consistent with the rule', async () => {
      const t = todayParis()
      const start = addDays(t, -2)
      const res = await createAbsence(w.rh.token, { contractId: w.ctA.id, startDate: start, endDate: start })
      expect(res.status).toBe(201)
      const day = Number(t.slice(8, 10))
      const startMonth = start.slice(0, 7)
      const next = monthShift(1)
      const allowed = day <= 25 ? [startMonth] : startMonth === t.slice(0, 7) || startMonth < t.slice(0, 7) ? [next] : [startMonth]
      expect(allowed).toContain(res.body.payrollMonth)
      expect(res.body.payrollMonth).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/)
    })
  })
})
