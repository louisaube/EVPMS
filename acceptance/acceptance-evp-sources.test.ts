import { resetData, closePool, sql } from './harness'
import { logSince, logSize, sleep } from './renfort-helpers'
import {
  http, GET, POST, UNKNOWN_UUID, seedWorld, seedAccount, seedContract, seedAbsence, createAbsence, World, auditRows, auditCount, countRows, addDays, todayParis,
  sortedKeys, closeEvp, callsLog, writeFixture, clearFixtures, payfitFixture, refresh, waitRun, PF, SIRET_A, assignmentInvariantViolations, envSecrets,
} from './evp-helpers'

const d = (n: number) => addDays(todayParis(), n)
const pfAbs = (over: Record<string, unknown> = {}) => ({
  companyId: 'co-a', id: 'pf-1', contractId: 'ct-a1', typeCode: 'CP', status: PF.ok, startDate: d(-6), startHalf: 'MATIN', endDate: d(-4), endHalf: 'APRES_MIDI', ...over,
})
const WRITE_VERB = /[.:]\s*(write|send|push|post|put|patch|delete|create|update|upsert|insert|set|append|clear|import)/i

function paris(): { y: number; m: number } {
  const [y, m] = todayParis().split('-').map(Number)
  return { y, m }
}
const firstOfMonth = (shift: number) => {
  const { y, m } = paris()
  const idx = y * 12 + (m - 1) + shift
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`
}
const lastOfMonth = (shift: number) => addDays(firstOfMonth(shift + 1), -1)

// Acceptance suite of version v1-evp: read-only sources (Workspace, Sheets, PayFit, Aqoona) and PayFit reconciliation.
describe('EVP sources and PayFit reconciliation', () => {
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

  const sourceOf = async (token: string, key: string) => (await GET('/sources', token)).body.items.find((i: any) => i.key === key)
  const anomalies = async (token: string, key: string, size = 50) => (await GET(`/sources/${key}/anomalies?size=${size}`, token)).body
  const labels = (a: any) => a.items.map((i: any) => i.label)

  // ───────────────────────────── GET /sources ─────────────────────────────
  describe('GET /sources', () => {
    it('[rule-evp-sources-manual] one item per source with the specified fields; nothing has been read yet and nothing is read by itself', async () => {
      const res = await GET('/sources', w.rh.token)
      expect(res.status).toBe(200)
      expect(res.body.items.map((i: any) => i.key).sort()).toEqual(['aqoona', 'payfit', 'sheets', 'workspace'])
      for (const i of res.body.items) {
        expect(sortedKeys(i)).toEqual(['addresses', 'anomalyCount', 'canRefresh', 'currentRunId', 'key', 'label', 'lastError', 'lastReadAt', 'state', 'volumes', 'windowFrom', 'windowTo'])
        expect(['NEVER_READ', 'UP_TO_DATE', 'RUNNING', 'ERROR', 'UNAVAILABLE', 'PARTIAL']).toContain(i.state)
        expect(i.lastError).toBeNull() // [rule-evp-sources-failure-state] nothing has failed yet
        expect(i.addresses).toEqual(expect.any(Array))
        expect(Array.isArray(i.volumes)).toBe(true)
        expect(i.currentRunId).toBeNull()
      }
      for (const key of ['sheets', 'payfit', 'aqoona']) {
        const s = res.body.items.find((i: any) => i.key === key)
        expect(s.state).toBe('NEVER_READ')
        expect(s.lastReadAt).toBeNull()
      }
      await sleep(1000)
      await GET('/profile', w.rh.token)
      expect(await countRows('source_runs')).toBe(0)
      expect(callsLog()).toBe('')
    })

    it('[rule-evp-sources-manual] [rule-evp-sources-sheets-superadmin] canRefresh follows the capability of the caller: RH PayFit and Aqoona, SUPERADMIN also Sheets, Workspace never', async () => {
      const rh = (await GET('/sources', w.rh.token)).body.items
      const sup = (await GET('/sources', w.sup.token)).body.items
      const can = (items: any[]) => Object.fromEntries(items.map((i) => [i.key, i.canRefresh]))
      expect(can(rh)).toEqual({ workspace: false, sheets: false, payfit: true, aqoona: true })
      expect(can(sup)).toEqual({ workspace: false, sheets: true, payfit: true, aqoona: true })
    })

    it('[rule-evp-sources-manual] only RH and SUPERADMIN read the state of the sources: others 403, anonymous 401', async () => {
      for (const who of [w.dirA, w.roA, w.adm]) expect((await GET('/sources', who.token)).status).toBe(403)
      expect((await GET('/sources')).status).toBe(401)
    })
  })

  // ───────────────────────────── refresh ─────────────────────────────
  describe('POST /sources/:key/refresh', () => {
    it('[rule-evp-sources-manual] [rule-evp-sources-refresh-audited] RH launches a PayFit reading: 202 RUNNING, then SUCCEEDED; the source becomes up to date and the launch is traced', async () => {
      writeFixture('payfit', payfitFixture([]))
      const started = await POST('/sources/payfit/refresh', w.rh.token)
      expect(started.status).toBe(202)
      expect(sortedKeys(started.body)).toEqual(['runId', 'state'])
      expect(started.body.state).toBe('RUNNING')
      const run = await waitRun(w.rh.token, started.body.runId)
      expect(run.state).toBe('SUCCEEDED')
      expect(sortedKeys(run)).toEqual(['errorMessage', 'finishedAt', 'id', 'startedAt', 'state', 'step', 'volumes'])
      expect(run).toMatchObject({ id: started.body.runId, errorMessage: null })
      expect(run.finishedAt).not.toBeNull()
      expect(Array.isArray(run.volumes)).toBe(true)
      const src = await sourceOf(w.rh.token, 'payfit')
      expect(src.state).toBe('UP_TO_DATE')
      expect(Math.abs(Date.now() - Date.parse(src.lastReadAt))).toBeLessThan(120000)
      expect(src.currentRunId).toBeNull()
      const entries = await auditRows('sources:refresh')
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ actor_id: w.rh.id, object_type: 'Lecture de source' })
    })

    it('[rule-evp-sources-payfit] the PayFit window runs from the start of M-2 to the end of M+2 (Europe/Paris)', async () => {
      writeFixture('payfit', payfitFixture([]))
      await refresh(w.rh.token, 'payfit')
      const src = await sourceOf(w.rh.token, 'payfit')
      expect(src.windowFrom).toBe(firstOfMonth(-2))
      expect(src.windowTo).toBe(lastOfMonth(2))
    })

    it('[rule-evp-sources-aqoona] the Aqoona window runs from J-28 to J+35', async () => {
      writeFixture('aqoona', { rows: [] })
      await refresh(w.rh.token, 'aqoona')
      const src = await sourceOf(w.rh.token, 'aqoona')
      expect(src.windowFrom).toBe(d(-28))
      expect(src.windowTo).toBe(d(35))
    })

    it('[rule-evp-sources-sheets-superadmin] the Sheets reading is reserved to the superadmin: RH, others 403 and nothing is launched', async () => {
      writeFixture('sheets', { rows: [] })
      for (const who of [w.rh, w.dirA, w.roA, w.adm]) expect((await POST('/sources/sheets/refresh', who.token)).status).toBe(403)
      expect(await countRows('source_runs')).toBe(0)
      expect(await auditCount('sources:refresh')).toBe(0)
      const ok = await POST('/sources/sheets/refresh', w.sup.token)
      expect(ok.status).toBe(202)
      await waitRun(w.sup.token, ok.body.runId)
    })

    it('[rule-evp-sources-manual] PayFit and Aqoona readings are refused to directrice, RO and ADMINISTRATRICE (403), anonymous 401; the superadmin may launch them', async () => {
      writeFixture('payfit', payfitFixture([]))
      writeFixture('aqoona', { rows: [] })
      for (const key of ['payfit', 'aqoona']) {
        for (const who of [w.dirA, w.roA, w.adm]) expect((await POST(`/sources/${key}/refresh`, who.token)).status).toBe(403)
        expect((await POST(`/sources/${key}/refresh`)).status).toBe(401)
      }
      expect(await countRows('source_runs')).toBe(0)
      const run = await POST('/sources/payfit/refresh', w.sup.token)
      expect(run.status).toBe(202)
      await waitRun(w.sup.token, run.body.runId)
    })

    it('[rule-evp-sources-workspace-scope] Workspace cannot be refreshed through the API: 404, whoever the caller; an unknown source is refused', async () => {
      for (const who of [w.rh, w.sup]) expect((await POST('/sources/workspace/refresh', who.token)).status).toBe(404)
      expect([400, 404]).toContain((await POST('/sources/gmail/refresh', w.sup.token)).status)
      expect((await POST('/sources/workspace/refresh', w.dirA.token)).status).toBe(403)
      expect(await countRows('source_runs')).toBe(0)
    })

    it('[rule-evp-sources-run-single] a second launch while a reading runs is refused 409 sources.run_in_progress', async () => {
      const many = Array.from({ length: 3000 }, (_, i) => pfAbs({ id: `pf-bulk-${i}`, startDate: d(-5 - (i % 40)), endDate: d(-5 - (i % 40)) }))
      writeFixture('payfit', payfitFixture(many as any))
      const results = await Promise.all([1, 2, 3, 4].map(() => POST('/sources/payfit/refresh', w.rh.token)))
      const statuses = results.map((r) => r.status)
      expect(statuses.every((s) => s === 202 || s === 409)).toBe(true)
      expect(statuses.filter((s) => s === 202).length).toBeGreaterThanOrEqual(1)
      expect(statuses.filter((s) => s === 409).length).toBeGreaterThanOrEqual(1)
      for (const r of results.filter((r) => r.status === 409)) expect(r.body.code).toBe('sources.run_in_progress')
      for (const r of results.filter((r) => r.status === 202)) await waitRun(w.rh.token, r.body.runId)
      const running = await sql("select count(*)::int as n from base.source_runs where source_key = 'payfit' and state = 'RUNNING'")
      expect(running[0].n).toBe(0)
    })

    it('[rule-evp-sources-run-single] another source can be read while PayFit is running', async () => {
      const many = Array.from({ length: 3000 }, (_, i) => pfAbs({ id: `pf-bulk-${i}`, startDate: d(-5 - (i % 40)), endDate: d(-5 - (i % 40)) }))
      writeFixture('payfit', payfitFixture(many as any))
      writeFixture('aqoona', { rows: [] })
      const first = await POST('/sources/payfit/refresh', w.rh.token)
      const second = await POST('/sources/aqoona/refresh', w.rh.token)
      expect(first.status).toBe(202)
      expect(second.status).toBe(202)
      await waitRun(w.rh.token, first.body.runId)
      await waitRun(w.rh.token, second.body.runId)
    })

    it('[rule-evp-sources-readonly] [rule-evp-sources-credentials] a failed reading ends FAILED with a message without technical detail, and the source shows ERROR', async () => {
      writeFixture('payfit', { error: 'boom: Authorization Bearer secret-token-123 at /srv/connector/payfit.ts:42' })
      const started = await POST('/sources/payfit/refresh', w.rh.token)
      const run = await waitRun(w.rh.token, started.body.runId)
      expect(run.state).toBe('FAILED')
      expect(run.finishedAt).not.toBeNull()
      expect(typeof run.errorMessage).toBe('string')
      expect(run.errorMessage.length).toBeGreaterThan(0)
      for (const leak of ['secret-token-123', '/srv/connector', 'payfit.ts', 'Bearer', 'boom']) expect(run.errorMessage).not.toContain(leak)
      expect((await sourceOf(w.rh.token, 'payfit')).state).toBe('ERROR')
      expect((await GET('/sources', w.rh.token)).text).not.toContain('secret-token-123')
      writeFixture('payfit', payfitFixture([]))
      const retry = await refresh(w.rh.token, 'payfit')
      expect(retry.state).toBe('SUCCEEDED')
      expect((await sourceOf(w.rh.token, 'payfit')).state).toBe('UP_TO_DATE')
    })

    it('[rule-evp-sources-readonly] a reading calls only read methods of the connectors: nothing is ever written to PayFit, Aqoona, Sheets or Workspace', async () => {
      writeFixture('sheets', { rows: [] })
      writeFixture('payfit', payfitFixture([]))
      writeFixture('aqoona', { rows: [] })
      await refresh(w.sup.token, 'sheets')
      await refresh(w.rh.token, 'payfit')
      await refresh(w.rh.token, 'aqoona')
      const lines = callsLog().split(/\r?\n/).filter(Boolean)
      expect(lines.length).toBeGreaterThan(0)
      for (const line of lines) expect(line).not.toMatch(WRITE_VERB)
    })
  })

  // ───────────────────────────── refresh-all ─────────────────────────────
  describe('POST /sources/refresh-all', () => {
    beforeEach(() => {
      writeFixture('sheets', { rows: [] })
      writeFixture('payfit', payfitFixture([]))
      writeFixture('aqoona', { rows: [] })
    })

    it('[rule-evp-sources-sheets-superadmin] the superadmin chains Sheets, PayFit then Aqoona; the run reports its steps', async () => {
      const started = await POST('/sources/refresh-all', w.sup.token)
      expect(started.status).toBe(202)
      expect(sortedKeys(started.body)).toEqual(['runId', 'steps'])
      expect(started.body.steps).toEqual(['sheets', 'payfit', 'aqoona'])
      const run = await waitRun(w.sup.token, started.body.runId)
      expect(run.state).toBe('SUCCEEDED')
      const lines = callsLog().split(/\r?\n/).filter(Boolean)
      const first = (re: RegExp) => lines.findIndex((l) => re.test(l))
      const [s, p, a] = [first(/sheets/i), first(/payfit/i), first(/aqoona/i)]
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThan(p)
      expect(p).toBeLessThan(a)
      for (const key of ['sheets', 'payfit', 'aqoona']) expect((await sourceOf(w.sup.token, key)).state).toBe('UP_TO_DATE')
      const traced = await sql("select actor_id, object_type from base.audit_logs where action like 'sources:refresh%'")
      expect(traced.length).toBeGreaterThanOrEqual(1)
      for (const t of traced) expect(t).toMatchObject({ actor_id: w.sup.id, object_type: 'Lecture de source' })
    })

    it('[rule-evp-sources-sheets-superadmin] RH, directrice, RO and ADMINISTRATRICE get 403 on « Toutes les sources »; anonymous 401; nothing runs', async () => {
      for (const who of [w.rh, w.dirA, w.roA, w.adm]) expect((await POST('/sources/refresh-all', who.token)).status).toBe(403)
      expect((await POST('/sources/refresh-all')).status).toBe(401)
      expect(await countRows('source_runs')).toBe(0)
    })

    it('[rule-evp-sources-run-single] [rule-evp-sources-sheets-superadmin] a failing step stops the chain: the run is FAILED and the following sources are not read', async () => {
      writeFixture('sheets', { error: 'boom' })
      const started = await POST('/sources/refresh-all', w.sup.token)
      const run = await waitRun(w.sup.token, started.body.runId)
      expect(run.state).toBe('FAILED')
      expect(typeof run.errorMessage).toBe('string')
      const log = callsLog()
      expect(log).not.toMatch(/payfit/i)
      expect(log).not.toMatch(/aqoona/i)
      expect((await sourceOf(w.sup.token, 'payfit')).state).toBe('NEVER_READ')
    })
  })

  // ───────────────────────────── runs and anomalies ─────────────────────────────
  describe('GET /sources/runs/:id and /sources/:key/anomalies', () => {
    it('[rule-evp-sources-manual] a run is readable by RH and SUPERADMIN only; unknown 404, malformed 400, anonymous 401', async () => {
      writeFixture('payfit', payfitFixture([]))
      const started = await POST('/sources/payfit/refresh', w.rh.token)
      await waitRun(w.rh.token, started.body.runId)
      for (const who of [w.rh, w.sup]) expect((await GET(`/sources/runs/${started.body.runId}`, who.token)).status).toBe(200)
      for (const who of [w.dirA, w.roA, w.adm]) expect((await GET(`/sources/runs/${started.body.runId}`, who.token)).status).toBe(403)
      expect((await GET(`/sources/runs/${UNKNOWN_UUID}`, w.rh.token)).status).toBe(404)
      expect((await GET('/sources/runs/nope', w.rh.token)).status).toBe(400)
      expect((await GET(`/sources/runs/${started.body.runId}`)).status).toBe(401)
    })

    it('[rule-evp-sources-no-invention] anomalies are paginated with from and size in {10, 25, 50}; bad pagination or source is refused', async () => {
      const rows = Array.from({ length: 12 }, (_, i) => ({ name: `Crèche ${i}`, code: `Code Invalide ${i}!`, siret: '', directriceName: 'X', ros: [] }))
      writeFixture('sheets', { rows })
      await refresh(w.sup.token, 'sheets')
      const all = await anomalies(w.rh.token, 'sheets')
      expect(all.total).toBeGreaterThanOrEqual(12)
      for (const i of all.items) expect(sortedKeys(i)).toEqual(['detail', 'label', 'subject', 'type'])
      const page = await GET('/sources/sheets/anomalies?size=10', w.rh.token)
      expect(page.body.items).toHaveLength(10)
      const next = await GET('/sources/sheets/anomalies?size=10&from=10', w.rh.token)
      expect(next.body.items.length).toBeGreaterThanOrEqual(2)
      expect(next.body.total).toBe(page.body.total)
      for (const q of ['size=0', 'size=5', 'size=100', 'size=x', 'from=-1']) {
        const res = await GET(`/sources/sheets/anomalies?${q}`, w.rh.token)
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('api.validation.incoming_failed')
      }
      expect((await GET('/sources/gmail/anomalies', w.rh.token)).status).toBe(400)
    })

    it('[rule-evp-sources-manual] anomalies are readable by RH and SUPERADMIN only', async () => {
      for (const who of [w.dirA, w.roA, w.adm]) expect((await GET('/sources/sheets/anomalies', who.token)).status).toBe(403)
      expect((await GET('/sources/sheets/anomalies')).status).toBe(401)
      for (const who of [w.rh, w.sup]) expect((await GET('/sources/payfit/anomalies', who.token)).status).toBe(200)
    })
  })

  // ───────────────────────────── Google Sheets ─────────────────────────────
  describe('Google Sheets reading (« Contacts des crèches »)', () => {
    const sheet = (rows: unknown[]) => writeFixture('sheets', { rows })
    const gamma = { name: 'Crèche Gamma', code: 'GAMMA', siret: '33333333333333', loginEmail: 'gamma@micro-stars.fr', directriceName: 'Gaby Gamma', ros: [{ name: 'Rita Gamma', email: 'rita.gamma@micro-stars.fr' }] }

    it('[rule-evp-sources-sheets] [rule-evp-creche-readonly] the reading builds the crèche referential: code normalised to lower case, directrice and ROs recorded, verified, visible to every global role', async () => {
      sheet([gamma])
      const run = await refresh(w.sup.token, 'sheets')
      expect(run.state).toBe('SUCCEEDED')
      const row = (await sql("select * from base.creches where code = 'gamma'"))[0]
      expect(row).toMatchObject({ name: 'Crèche Gamma', siret: '33333333333333', directrice_name: 'Gaby Gamma', verified: true, scope_code: 'gamma' })
      expect(row.ro_names).toEqual(['Rita Gamma'])
      const listed = (await GET('/creches', w.rh.token)).body.items.find((c: any) => c.code === 'gamma')
      expect(listed).toEqual({ code: 'gamma', name: 'Crèche Gamma', siret: '33333333333333', directriceName: 'Gaby Gamma', roNames: ['Rita Gamma'], verified: true })
      expect((await GET('/creches', w.dirA.token)).body.items.map((c: any) => c.code)).toEqual(['alpha'])
    })

    it('[rule-evp-creche-scope] a crèche created by the reading comes with its scope, its technical group and its link to the global group, in one piece', async () => {
      sheet([gamma])
      await refresh(w.sup.token, 'sheets')
      expect(await countRows('scopes', "code = 'gamma'")).toBe(1)
      const own = await sql("select g.id from base.groups g join base.group_scopes gs on gs.group_id = g.id join base.scopes s on s.id = gs.scope_id where g.name = 'evp:gamma' and s.code = 'gamma'")
      expect(own).toHaveLength(1)
      const all = await sql("select g.id from base.groups g join base.group_scopes gs on gs.group_id = g.id join base.scopes s on s.id = gs.scope_id where g.name = 'evp:all' and s.code = 'gamma'")
      expect(all).toHaveLength(1)
      expect((await GET('/creches/gamma/closures', w.rh.token)).status).toBe(200)
      expect(await assignmentInvariantViolations()).toEqual([])
    })

    it('[rule-evp-sources-no-invention] a code outside the format and a missing SIRET are not turned into crèches and are reported as anomalies', async () => {
      sheet([gamma, { ...gamma, name: 'Mauvais code', code: 'Bad Code!', siret: '44444444444444' }, { ...gamma, name: 'Sans SIRET', code: 'delta', siret: '' }, { ...gamma, name: 'SIRET court', code: 'epsilon', siret: '123' }])
      await refresh(w.sup.token, 'sheets')
      expect((await sql('select code from base.creches order by code')).map((r) => r.code)).toEqual(['alpha', 'beta', 'gamma'])
      const a = await anomalies(w.rh.token, 'sheets')
      expect(labels(a)).toEqual(expect.arrayContaining(['Code de crèche invalide', 'SIRET manquant ou invalide']))
      expect((await sourceOf(w.rh.token, 'sheets')).anomalyCount).toBe(a.total)
    })

    it('[rule-evp-sources-sheets] a code in upper case designates the same crèche as in lower case: no duplicate, existing crèche updated', async () => {
      sheet([{ name: 'Crèche Alpha Renommée', code: 'ALPHA', siret: SIRET_A, loginEmail: 'alpha@micro-stars.fr', directriceName: 'Camille Alpha', ros: [{ name: 'Rosa Alpha', email: 'rosa@micro-stars.fr' }] }])
      await refresh(w.sup.token, 'sheets')
      expect(await countRows('creches', "lower(code) = 'alpha'")).toBe(1)
      expect(await countRows('scopes', "lower(code) = 'alpha'")).toBe(1)
    })

    it('[rule-evp-creche-readonly] verified is recomputed: a crèche absent from the last successful reading is no longer verified, so no access can be given on it', async () => {
      sheet([gamma])
      await refresh(w.sup.token, 'sheets')
      expect((await sql("select verified from base.creches where code = 'alpha'"))[0].verified).toBe(false)
      expect((await sql("select verified from base.creches where code = 'gamma'"))[0].verified).toBe(true)
      const res = await POST('/access-accounts', w.rh.token, { email: 'x.ro@micro-stars.fr', name: 'X RO', role: 'RO', active: true, crecheCodes: ['alpha'] })
      expect(res.status).toBe(422)
      expect(res.body.code).toBe('access.creche_not_verified')
    })

    it('[rule-evp-sources-ro-gaps-not-overwritten] [rule-evp-sources-sheets] a RO gap is reported as an anomaly; no account, assignment or group is created, changed or removed', async () => {
      const snapshot = async () => JSON.stringify([
        await sql('select * from base.users order by id'), await sql('select * from base.evp_accounts order by user_id'),
        await sql('select * from base.creche_assignments order by user_id, creche_code'), await sql('select * from base.group_users order by group_id, user_id'),
      ])
      const before = await snapshot()
      sheet([
        { name: 'Crèche Alpha', code: 'alpha', siret: SIRET_A, loginEmail: 'alpha@micro-stars.fr', directriceName: 'Camille Alpha', ros: [{ name: 'Autre Personne', email: 'autre.personne@micro-stars.fr' }] },
        { name: 'Crèche Beta', code: 'beta', siret: '22222222222222', loginEmail: 'beta@micro-stars.fr', directriceName: 'Dana Beta', ros: [{ name: 'Robin Beta', email: w.roB.email }] },
      ])
      await refresh(w.sup.token, 'sheets')
      expect(labels(await anomalies(w.rh.token, 'sheets'))).toContain('Écart RO')
      expect(await snapshot()).toBe(before)
      expect(await assignmentInvariantViolations()).toEqual([])
    })

    it('[rule-evp-access-source-no-resurrect] [rule-evp-sources-ro-gaps-not-overwritten] a retired RO listed in the table is neither recreated nor reactivated: anomaly only', async () => {
      const retired = await seedAccount('RO', { name: 'Ancienne RO', email: 'ancienne.ro@micro-stars.fr', creches: [], active: false, removed: true })
      sheet([{ name: 'Crèche Alpha', code: 'alpha', siret: SIRET_A, loginEmail: 'alpha@micro-stars.fr', directriceName: 'Camille Alpha', ros: [{ name: 'Ancienne RO', email: 'ancienne.ro@micro-stars.fr' }, { name: 'Rosa Alpha', email: w.roA.email }] }])
      const users = await countRows('users')
      await refresh(w.sup.token, 'sheets')
      const row = (await sql('select active, removed_at from base.evp_accounts where user_id = $1', [retired.id]))[0]
      expect(row.active).toBe(false)
      expect(row.removed_at).not.toBeNull()
      expect(await countRows('creche_assignments', 'user_id = $1', [retired.id])).toBe(0)
      expect(await countRows('users')).toBe(users)
      expect(await countRows('evp_accounts', "email = 'ancienne.ro@micro-stars.fr'")).toBe(1)
      expect(labels(await anomalies(w.rh.token, 'sheets'))).toContain('RO retirée présente dans le tableau')
      expect((await GET('/profile', retired.token)).status).toBe(403)
    })

    it('[rule-evp-sources-sheets] a directrice assigned to a crèche whose source directrice has another name is reported; the account is not modified', async () => {
      const before = JSON.stringify(await sql('select * from base.evp_accounts order by user_id'))
      const assignments = JSON.stringify(await sql('select * from base.creche_assignments order by user_id'))
      sheet([{ name: 'Crèche Alpha', code: 'alpha', siret: SIRET_A, loginEmail: 'alpha@micro-stars.fr', directriceName: 'Camille Remplaçante', ros: [] }])
      await refresh(w.sup.token, 'sheets')
      expect(labels(await anomalies(w.rh.token, 'sheets'))).toContain('Directrice différente du tableau')
      expect(JSON.stringify(await sql('select * from base.evp_accounts order by user_id'))).toBe(before)
      expect(JSON.stringify(await sql('select * from base.creche_assignments order by user_id'))).toBe(assignments)
      expect((await GET('/profile', w.dirA.token)).status).toBe(200)
    })

    it('[rule-evp-sources-credentials] [rule-evp-sources-readonly] the anomaly texts are in French and carry no secret', async () => {
      sheet([{ ...gamma, code: 'Bad Code!' }])
      await refresh(w.sup.token, 'sheets')
      const text = JSON.stringify(await anomalies(w.rh.token, 'sheets'))
      for (const s of envSecrets()) expect(text).not.toContain(s)
      expect(text).not.toMatch(/stack|at \w+\.\w+ \(|\/srv\/|node_modules/i)
    })
  })

  // ───────────────────────────── PayFit ─────────────────────────────
  describe('PayFit reading', () => {
    it('[rule-evp-sources-payfit] the reading stores companies, collaborators, contracts and absences; a new contract becomes selectable for the crèche linked by SIRET', async () => {
      const fx = payfitFixture([pfAbs({ id: 'pf-7', startDate: d(-40), endDate: d(-38) })])
      fx.employees!.push({ companyId: 'co-a', id: 'emp-new', firstName: 'Eva', lastName: 'Nouvelle' })
      fx.contracts!.push({ companyId: 'co-a', id: 'ct-new', employeeId: 'emp-new', startDate: d(-100), endDate: null })
      writeFixture('payfit', fx)
      await refresh(w.rh.token, 'payfit')
      expect(await countRows('payfit_absences', "payfit_absence_id = 'pf-7'")).toBe(1)
      const res = await GET('/creches/alpha/contracts?search=Nouvelle', w.dirA.token)
      expect(res.body.items.map((i: any) => i.employeeName)).toEqual(['Eva Nouvelle'])
      const src = await sourceOf(w.rh.token, 'payfit')
      expect(src.volumes.length).toBeGreaterThan(0)
      for (const v of src.volumes) expect(sortedKeys(v)).toEqual(['count', 'label'])
    })

    it('[rule-evp-declare-employee-key] the same PayFit contract identifier in two companies stays two local contracts; re-reading does not duplicate', async () => {
      const fx = payfitFixture([])
      fx.employees!.push({ companyId: 'co-a', id: 'emp-x1', firstName: 'Alice', lastName: 'Identique' }, { companyId: 'co-b', id: 'emp-x2', firstName: 'Bob', lastName: 'Identique' })
      fx.contracts!.push(
        { companyId: 'co-a', id: 'ct-shared', employeeId: 'emp-x1', startDate: '2020-01-01', endDate: null },
        { companyId: 'co-b', id: 'ct-shared', employeeId: 'emp-x2', startDate: '2020-01-01', endDate: null },
      )
      writeFixture('payfit', fx)
      await refresh(w.rh.token, 'payfit')
      await refresh(w.rh.token, 'payfit')
      const rows = await sql("select id, company_id from base.payfit_contracts where payfit_contract_id = 'ct-shared'")
      expect(rows).toHaveLength(2)
      expect(new Set(rows.map((r) => r.id)).size).toBe(2)
      expect(await countRows('payfit_contracts', "company_id = 'co-a' and payfit_contract_id = 'ct-a1'")).toBe(1)
    })

    it('[rule-evp-creche-link-siret] [rule-evp-sources-no-invention] two PayFit companies with the same SIRET make the link uncertain: no contract is proposed and an anomaly is visible', async () => {
      const fx = payfitFixture([])
      fx.companies!.push({ id: 'co-dup', siret: SIRET_A, name: 'Société en double' })
      writeFixture('payfit', fx)
      await refresh(w.rh.token, 'payfit')
      const res = await GET('/creches/alpha/contracts', w.rh.token)
      expect(res.body.items).toEqual([])
      expect((await anomalies(w.rh.token, 'payfit')).total).toBeGreaterThanOrEqual(1)
      expect((await GET('/creches/beta/contracts', w.rh.token)).body.items).toHaveLength(1)
    })

    it('[rule-evp-declare-overlap-blocks] [rule-evp-declare-checks] an absence observed in PayFit over the period blocks the completeness of an overlapping declaration (blockage overlap_payfit, not an error)', async () => {
      writeFixture('payfit', payfitFixture([pfAbs({ id: 'pf-existing', startDate: d(-6), endDate: d(-4) })]))
      await refresh(w.rh.token, 'payfit')
      const overlapping = await createAbsence(w.dirA.token, { contractId: w.ctA.id, startDate: d(-5), endDate: d(-3) })
      expect(overlapping.status).toBe(201)
      expect(overlapping.body.status).toBe('A_COMPLETER')
      expect(overlapping.body.blockages.map((b: any) => b.code)).toContain('overlap_payfit')
      const clear = await createAbsence(w.dirA.token, { contractId: w.ctA.id, startDate: d(-20), endDate: d(-19) })
      expect(clear.body.status).toBe('A_VALIDER')
      const other = await createAbsence(w.dirA.token, { contractId: w.ctA2.id, startDate: d(-5), endDate: d(-3) })
      expect(other.body.status).toBe('A_VALIDER')
    })

    it('[rule-evp-sources-readonly] reading PayFit creates no dossier by itself', async () => {
      writeFixture('payfit', payfitFixture([pfAbs({ id: 'pf-a' }), pfAbs({ id: 'pf-b', contractId: 'ct-a2', startDate: d(-30), endDate: d(-29) })]))
      await refresh(w.rh.token, 'payfit')
      expect(await countRows('absences')).toBe(0)
      expect(await countRows('notifications')).toBe(0)
    })
  })

  // ───────────────────────────── Aqoona ─────────────────────────────
  describe('Aqoona reading', () => {
    const NIRS = ['1850575123456', '2 85 05 75 123 456 78', '185052A123456', '2 90 11 2B 045 012 31']
    const row = (over: Record<string, unknown> = {}) => ({ firstName: 'Léa', lastName: 'Martin', matricule: null, crecheName: 'CRÈCHE ALPHA !!', day: d(-3), start: '08:00', end: '16:00', ...over })

    // v3: « Matricule écarté » no longer exists (rule-evp-aqoona-nir-transient-key replaces rule-evp-sources-nir-discarded; the reading by NIR is
    // covered by acceptance-v3-nir-siret.test.ts). No PayFit collaborator carries a NIR in these fixtures, so no row is matched by NIR.
    it('[rule-evp-aqoona-nir-never-stored] [rule-evp-aqoona-person-ref] a registration number, NIR-like or not, is never stored, displayed, logged nor reported; no « Matricule écarté » volume, « Rapprochés par NIR » counts no row here', async () => {
      const offset = logSize()
      writeFixture('aqoona', {
        rows: [
          ...NIRS.map((m, i) => row({ matricule: m, day: d(-3 - i) })),
          row({ matricule: 'MAT-00042', firstName: 'Noé', lastName: 'Petit', day: d(-9) }),
          row({ matricule: '12345', firstName: 'Noé', lastName: 'Petit', day: d(-10) }),
        ],
      })
      const run = await refresh(w.rh.token, 'aqoona')
      expect(run.state).toBe('SUCCEEDED')
      const volume = (v: any[], label: string) => v.find((x) => x.label === label)
      expect(volume((await sourceOf(w.rh.token, 'aqoona')).volumes, 'Matricule écarté')).toBeUndefined()
      expect(volume(run.volumes, 'Matricule écarté')).toBeUndefined()
      expect(volume(run.volumes, 'Rapprochés par NIR')?.count ?? 0).toBe(0)
      const dumps = [
        JSON.stringify(await sql('select p::text as t from base.aqoona_plannings p')),
        JSON.stringify(await sql('select m::text as t from base.aqoona_mismatches m')),
        JSON.stringify(await sql('select a::text as t from base.source_anomalies a')),
        JSON.stringify(await sql('select r::text as t from base.source_runs r')),
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
      expect(await countRows('aqoona_plannings', "person_ref in ('MAT-00042', '12345')")).toBe(0)
      expect(await countRows('aqoona_plannings', "person_ref = 'Noé Petit'")).toBe(2)
      expect(await countRows('aqoona_plannings')).toBe(6)
    })

    // v3 (rule-evp-aqoona-etab-unique): the crèche is attached as soon as the establishment is unique among the verified crèches, whether or
    // not the collaborator is found; the collaborator (employee_id) is attached only when the match by name is unique in the company of the crèche.
    // v5 (rule-evp-link-nir-only): the collaborator is attached by NIR alone, so rows without NIR keep their crèche and no collaborator.
    it('[rule-evp-sources-links] [rule-evp-aqoona-etab-unique] [rule-evp-link-nir-only] the planning is matched by normalised crèche name; the collaborator is never matched by first and last name, so rows without NIR have none', async () => {
      await seedContract('co-b', 'ct-b2', 'Léa', 'Martin')
      writeFixture('aqoona', {
        rows: [
          row({ day: d(-1) }),
          row({ firstName: 'Zoé', lastName: 'Durand', crecheName: 'Crèche Alpha', day: d(-2) }),
          row({ firstName: 'Inconnu', lastName: 'Total', crecheName: 'Crèche Alpha', day: d(-3) }),
          row({ crecheName: 'Crèche Fantôme', day: d(-4) }),
          row({ crecheName: 'crèche beta', day: d(-5) }),
        ],
      })
      await refresh(w.rh.token, 'aqoona')
      expect(await countRows('aqoona_plannings')).toBe(5)
      const attached = await sql('select day::text as day, creche_code from base.aqoona_plannings where creche_code is not null order by day')
      expect(attached).toEqual(
        [{ day: d(-1), creche_code: 'alpha' }, { day: d(-2), creche_code: 'alpha' }, { day: d(-3), creche_code: 'alpha' }, { day: d(-5), creche_code: 'beta' }].sort((a, b) => a.day.localeCompare(b.day)),
      )
      const withCollaborator = await sql('select day::text as day from base.aqoona_plannings where employee_id is not null order by day')
      expect(withCollaborator).toEqual([])
      const a = await anomalies(w.rh.token, 'aqoona')
      expect(a.total).toBeGreaterThanOrEqual(3)
      expect((await sourceOf(w.rh.token, 'aqoona')).anomalyCount).toBe(a.total)
    })

    it('[rule-evp-sources-no-invention] two collaborators with the same name in the same crèche are never guessed: the row keeps its crèche but no collaborator, and an anomaly is visible', async () => {
      await seedContract('co-a', 'ct-twin', 'Léa', 'Martin')
      writeFixture('aqoona', { rows: [row()] })
      await refresh(w.rh.token, 'aqoona')
      expect(await countRows('aqoona_plannings', 'employee_id is not null')).toBe(0)
      expect(await countRows('aqoona_plannings', "creche_code = 'alpha'")).toBe(1)
      expect(await countRows('aqoona_plannings')).toBe(1)
      expect((await anomalies(w.rh.token, 'aqoona')).total).toBeGreaterThanOrEqual(1)
    })

    it('[rule-evp-sources-no-auto-absence] [rule-evp-sources-aqoona] reading the planning never produces an absence, a notification or a dossier change', async () => {
      const id = await createAbsence(w.dirA.token, { contractId: w.ctA.id })
      const dossiers = JSON.stringify(await sql('select * from base.absences order by id'))
      writeFixture('aqoona', { rows: [row({ day: d(-5) }), row({ day: d(-4) })] })
      await refresh(w.rh.token, 'aqoona')
      expect(id.status).toBe(201)
      expect(JSON.stringify(await sql('select * from base.absences order by id'))).toBe(dossiers)
      expect(await countRows('notifications')).toBe(0)
    })

    it('[rule-evp-sources-aqoona] anomalies of Aqoona carry no registration number nor medical detail', async () => {
      writeFixture('aqoona', { rows: [row({ matricule: NIRS[0], firstName: 'Inconnu', lastName: 'Total' })] })
      await refresh(w.rh.token, 'aqoona')
      const text = JSON.stringify(await anomalies(w.rh.token, 'aqoona'))
      expect(text).not.toContain('1850575123456')
    })
  })

  // ───────────────────────────── rapprochement ─────────────────────────────
  describe('PayFit reconciliation', () => {
    const sqlSeed = (over: Record<string, unknown>) =>
      seedAbsence({ contractId: w.ctA.id, declaredBy: w.dirA.id, startDate: d(-6), endDate: d(-4), ...(over as any) })
    const seedSaisir = (over: Record<string, unknown> = {}) => sqlSeed({ status: 'A_SAISIR', ...over })
    const read = async (absences: unknown[], extra: Record<string, unknown> = {}) => {
      writeFixture('payfit', payfitFixture(absences as any, extra as any))
      return refresh(w.rh.token, 'payfit')
    }
    const detail = async (id: string, who = w.rh) => (await GET(`/absences/${id}`, who.token)).body
    const notifKinds = async (id: string) => (await sql('select kind from base.notifications where absence_id = $1 order by created_at, id', [id])).map((r) => r.kind)

    it('[rule-evp-payfit-proof] [rule-evp-payfit-atomic-confirmation] an exact and unique fresh observation confirms the dossier: proof, confirmation event and notification are recorded together', async () => {
      const id = await seedSaisir({ comment: 'DETAIL-MEDICAL-999' })
      const eventsBefore = await countRows('absence_events', 'absence_id = $1', [id])
      await read([pfAbs()])
      const res = await detail(id)
      expect(res.status).toBe('DANS_PAYFIT')
      expect(res.payfitProof).toMatchObject({ company: 'Société A', code: 'CP', sourceStatus: PF.ok })
      expect(Date.parse(res.payfitProof.observedAt)).not.toBeNaN()
      expect(res.nextAction.actor).toBe('AUCUN')
      expect(res.payfitAlert).toBeNull()
      expect(await countRows('payfit_proofs', 'absence_id = $1', [id])).toBe(1)
      expect(await countRows('absence_events', 'absence_id = $1', [id])).toBe(eventsBefore + 1)
      expect(await notifKinds(id)).toEqual(['CONFIRMATION'])
      const [proof] = await sql('select * from base.payfit_proofs where absence_id = $1', [id])
      expect(proof).toMatchObject({ company_id: 'co-a', siret: SIRET_A, payfit_absence_id: 'pf-1', code: 'CP', source_status: PF.ok })
      const timeline = res.timeline
      expect(timeline[timeline.length - 1].byName ?? null).toBeNull()
    })

    it('[rule-evp-notif-created-with-proof] [rule-evp-notif-no-medical] the confirmation is notified in French to the accounts of the crèche, without any medical detail, and only to them', async () => {
      const id = await seedSaisir({ comment: 'DETAIL-MEDICAL-999', typeCode: 'ARRET_MALADIE' })
      await read([pfAbs({ typeCode: 'MAL' })])
      expect(await notifKinds(id)).toEqual(['CONFIRMATION'])
      const seen = async (who: { token: string }) => (await GET('/notifications', who.token)).body.items
      for (const who of [w.dirA, w.roA, w.rh, w.adm, w.sup]) {
        const items = await seen(who)
        expect(items).toHaveLength(1)
        expect(items[0]).toMatchObject({ kind: 'CONFIRMATION', absenceId: id, crecheName: 'Crèche Alpha', employeeName: 'Léa Martin', read: false })
        const text = `${items[0].title} ${items[0].message}`
        expect(text).not.toContain('DETAIL-MEDICAL-999')
        expect(text).not.toMatch(/diagnostic|ordonnance|médic|certificat/i)
        expect(items[0].title.length).toBeLessThanOrEqual(120)
        expect(items[0].message.length).toBeLessThanOrEqual(500)
      }
      expect(await seen(w.dirB)).toEqual([])
      expect(await seen(w.roB)).toEqual([])
    })

    it('[rule-evp-payfit-atomic-confirmation] [rule-evp-journal-source] the automatic confirmation is traced in the audit trail under the author « Système »', async () => {
      const id = await seedSaisir()
      await read([pfAbs()])
      const entries = (await auditRows('sources:reconcile')).filter((e) => e.object_id === id)
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ actor_id: '00000000-0000-0000-0000-000000000000', actor_email: 'systeme@evp.invalid' })
      const journal = (await GET(`/journal-entries?absenceId=${id}`, w.rh.token)).body
      expect(journal.items.find((i: any) => i.operation === 'sources:reconcile')).toMatchObject({ actorName: 'Système', operationLabel: 'Rapprochement PayFit' })
    })

    it('[rule-evp-payfit-proof] a code listed as compatible with the configured type is accepted', async () => {
      const id = await seedSaisir()
      await read([pfAbs({ typeCode: 'CPA' })])
      expect((await detail(id)).status).toBe('DANS_PAYFIT')
    })

    it.each([
      ['absent from PayFit', () => []],
      ['a code incompatible with the type', () => [pfAbs({ typeCode: 'ZZ' })]],
      ['a different start date', () => [pfAbs({ startDate: d(-5) })]],
      ['a different end date', () => [pfAbs({ endDate: d(-3) })]],
      ['a different start half-day', () => [pfAbs({ startHalf: 'APRES_MIDI' })]],
      ['a different end half-day', () => [pfAbs({ endHalf: 'MATIN' })]],
      ['another contract of the same company', () => [pfAbs({ contractId: 'ct-a2' })]],
      ['a contract of another company', () => [pfAbs({ companyId: 'co-b', contractId: 'ct-b1' })]],
      ['a status that is not admissible', () => [pfAbs({ status: PF.notAdmissible })]],
      ['a status cancelled at the source', () => [pfAbs({ status: PF.canceled })]],
    ] as Array<[string, () => unknown[]]>)('[rule-evp-payfit-proof] with %s the dossier stays « à saisir / vérifier »: no proof, no confirmation', async (_label, make) => {
      const id = await seedSaisir()
      await read(make())
      const res = await detail(id)
      expect(res.status).toBe('A_SAISIR')
      expect(res.nextAction.actor).toBe('LECTURE_PAYFIT')
      expect(res.payfitProof).toBeNull()
      expect(await countRows('payfit_proofs')).toBe(0)
      expect(await notifKinds(id)).toEqual([])
    })

    it('[rule-evp-payfit-proof] a company whose SIRET is not the crèche’s SIRET never confirms, even with an otherwise exact observation', async () => {
      const id = await seedSaisir()
      const fx = payfitFixture([pfAbs()])
      fx.companies![0] = { id: 'co-a', siret: '55555555555555', name: 'Société A' }
      writeFixture('payfit', fx)
      await refresh(w.rh.token, 'payfit')
      expect((await detail(id)).status).toBe('A_SAISIR')
      expect(await countRows('payfit_proofs')).toBe(0)
    })

    it('[rule-evp-payfit-proof] two observations that both match are ambiguous: no confirmation', async () => {
      const id = await seedSaisir()
      await read([pfAbs({ id: 'pf-1' }), pfAbs({ id: 'pf-2' })])
      expect((await detail(id)).status).toBe('A_SAISIR')
      expect(await countRows('payfit_proofs')).toBe(0)
    })

    it('[rule-evp-payfit-proof] a type with no compatible PayFit code can never be confirmed', async () => {
      const id = await seedSaisir()
      await sql("update base.absence_types set payfit_code = null, payfit_compatible_codes = '{}' where code = 'CONGES_PAYES'")
      await read([pfAbs()])
      expect((await detail(id)).status).toBe('A_SAISIR')
      expect(await countRows('payfit_proofs')).toBe(0)
    })

    it('[rule-evp-payfit-proof] only « validée à saisir » dossiers are candidates: other states are not promoted by a matching observation', async () => {
      const ids: Record<string, string> = {}
      let n = 0
      for (const status of ['A_COMPLETER', 'ANTICIPEE', 'A_VALIDER', 'REJETEE', 'ANNULEE']) {
        ids[status] = await sqlSeed({ status, contractId: w.ctA2.id, startDate: d(-20 - 5 * n), endDate: d(-19 - 5 * n) })
        n++
      }
      const abs = Object.values(ids).map((_, i) => pfAbs({ id: `pf-o${i}`, contractId: 'ct-a2', startDate: d(-20 - 5 * i), endDate: d(-19 - 5 * i) }))
      await read(abs)
      for (const [status, id] of Object.entries(ids)) expect((await detail(id)).status).toBe(status)
      expect(await countRows('payfit_proofs')).toBe(0)
    })

    it('[rule-evp-mark-entered-no-proof] [rule-evp-payfit-no-manual-confirm] declaring the human entry does not confirm: the dossier stays to verify until PayFit gives a proof', async () => {
      const id = await seedSaisir()
      expect((await POST(`/absences/${id}/mark-entered`, w.rh.token)).status).toBe(200)
      await read([])
      const res = await detail(id)
      expect(res).toMatchObject({ status: 'A_SAISIR', saisieDeclaree: true, payfitProof: null })
      await read([pfAbs()])
      expect((await detail(id)).status).toBe('DANS_PAYFIT')
    })

    it('[rule-evp-payfit-atomic-confirmation] each dossier is reconciled on its own: an exact match confirms its dossier and leaves a mismatching neighbour untouched', async () => {
      const good = await seedSaisir()
      const bad = await sqlSeed({ status: 'A_SAISIR', contractId: w.ctA2.id, startDate: d(-30), endDate: d(-29) })
      await read([pfAbs(), pfAbs({ id: 'pf-9', contractId: 'ct-a2', startDate: d(-30), endDate: d(-28) })])
      expect((await detail(good)).status).toBe('DANS_PAYFIT')
      expect((await detail(bad)).status).toBe('A_SAISIR')
      expect(await countRows('payfit_proofs')).toBe(1)
    })

    it('[rule-evp-payfit-alerts] an absence modified in PayFit after confirmation raises a modification alert; the dossier stays confirmed and the prior proof is kept', async () => {
      const id = await seedSaisir()
      await read([pfAbs()])
      const proofBefore = (await sql('select * from base.payfit_proofs where absence_id = $1', [id]))[0]
      await read([pfAbs({ endDate: d(-3) })])
      const res = await detail(id)
      expect(res.status).toBe('DANS_PAYFIT')
      expect(res.payfitAlert).toMatchObject({ kind: 'MODIFIEE' })
      expect(typeof res.payfitAlert.change).toBe('string')
      expect(res.payfitAlert.change.length).toBeGreaterThan(0)
      expect(res.payfitAlert.priorProof).toBeTruthy()
      expect(res.payfitProof).toBeTruthy()
      expect(res.nextAction.actor).toBe('RH')
      expect(await notifKinds(id)).toEqual(['CONFIRMATION', 'MODIFICATION'])
      const proofs = await sql('select * from base.payfit_proofs where absence_id = $1', [id])
      expect(proofs).toHaveLength(1)
      expect(proofs[0]).toMatchObject({ id: proofBefore.id, payfit_absence_id: proofBefore.payfit_absence_id, code: proofBefore.code })
      expect(proofs[0].observed_at.getTime()).toBe(proofBefore.observed_at.getTime())
    })

    it('[rule-evp-payfit-alerts] a changed code also raises a modification alert', async () => {
      const id = await seedSaisir()
      await read([pfAbs()])
      await read([pfAbs({ typeCode: 'CPA' })])
      expect((await detail(id)).payfitAlert).toMatchObject({ kind: 'MODIFIEE' })
    })

    it('[rule-evp-payfit-alerts] an absence cancelled in PayFit raises a cancellation alert without erasing what had been observed', async () => {
      const id = await seedSaisir()
      await read([pfAbs()])
      await read([pfAbs({ status: PF.canceled })])
      const res = await detail(id)
      expect(res.status).toBe('DANS_PAYFIT')
      expect(res.payfitAlert).toMatchObject({ kind: 'ANNULEE' })
      expect(res.payfitProof).toMatchObject({ code: 'CP', sourceStatus: PF.ok })
      expect(await notifKinds(id)).toEqual(['CONFIRMATION', 'ANNULATION'])
      expect(await countRows('payfit_proofs', 'absence_id = $1', [id])).toBe(1)
    })

    it('[rule-evp-payfit-alerts] an absence no longer found raises a disappearance alert only when an exhaustive reading covers the period and the entity', async () => {
      const id = await seedSaisir()
      await read([pfAbs()])
      await read([], { exhaustive: false })
      let res = await detail(id)
      expect(res.payfitAlert).toBeNull()
      expect(await notifKinds(id)).toEqual(['CONFIRMATION'])
      await read([], { exhaustive: true })
      res = await detail(id)
      expect(res.status).toBe('DANS_PAYFIT')
      expect(res.payfitAlert).toMatchObject({ kind: 'DISPARUE' })
      expect(res.payfitProof).toBeTruthy()
      expect(await notifKinds(id)).toEqual(['CONFIRMATION', 'DISPARITION'])
    })

    it('[rule-evp-payfit-alerts] an exact absence found again after an alert gives a restoration event and notification, without a second confirmation', async () => {
      const id = await seedSaisir()
      await read([pfAbs()])
      await read([], { exhaustive: true })
      expect((await detail(id)).payfitAlert).toMatchObject({ kind: 'DISPARUE' })
      const proofs = await countRows('payfit_proofs', 'absence_id = $1', [id])
      const events = await countRows('absence_events', 'absence_id = $1', [id])
      await read([pfAbs()])
      const res = await detail(id)
      expect(res.status).toBe('DANS_PAYFIT')
      expect(await notifKinds(id)).toEqual(['CONFIRMATION', 'DISPARITION', 'RESTAURATION'])
      expect(await countRows('payfit_proofs', 'absence_id = $1', [id])).toBe(proofs)
      expect(await countRows('absence_events', 'absence_id = $1', [id])).toBeGreaterThan(events)
      expect(await countRows('notifications', "absence_id = $1 and kind = 'CONFIRMATION'", [id])).toBe(1)
    })

    it('[rule-evp-payfit-alerts] reading the same data again raises nothing new: no alert, no notification, no proof', async () => {
      const id = await seedSaisir()
      await read([pfAbs()])
      const before = [await countRows('notifications'), await countRows('payfit_proofs'), await countRows('payfit_alerts'), await countRows('absence_events')]
      await read([pfAbs()])
      await read([pfAbs()])
      expect([await countRows('notifications'), await countRows('payfit_proofs'), await countRows('payfit_alerts'), await countRows('absence_events')]).toEqual(before)
      expect((await detail(id)).payfitAlert).toBeNull()
    })

    it('[rule-evp-notif-read-decides-nothing] [rule-evp-arbitrage-rh] an alert is for RH to arbitrate: reading its notification changes nothing, the next actor stays RH and no RO decision exists', async () => {
      const id = await seedSaisir()
      await read([pfAbs()])
      await read([pfAbs({ endDate: d(-3) })])
      const notif = (await GET('/notifications', w.roA.token)).body.items.find((i: any) => i.kind === 'MODIFICATION')
      const before = JSON.stringify(await detail(id))
      expect((await POST(`/notifications/${notif.id}/read`, w.roA.token)).status).toBe(200)
      expect(JSON.stringify(await detail(id))).toBe(before)
      const asRo = await detail(id, w.roA)
      expect(asRo.nextAction.actor).toBe('RH')
      expect(asRo.allowedActions).not.toContain('VALIDATE')
      expect((await POST(`/absences/${id}/cancel`, w.roA.token, { reason: 'x' })).status).toBe(409)
    })
  })
})
