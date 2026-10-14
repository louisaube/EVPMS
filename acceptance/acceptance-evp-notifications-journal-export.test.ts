import { resetData, closePool, sql } from './harness'
import {
  http, GET, POST, qs, UNKNOWN_UUID, seedWorld, seedAbsence, createAbsence, World, auditRows, auditCount, countRows, addDays, todayParis, sortedKeys,
  closeEvp, callsLog, writeFixture, clearFixtures, payfitFixture, refresh, monthShift, uploadPiece, Status,
} from './evp-helpers'

const d = (n: number) => addDays(todayParis(), n)
const SYSTEM_ID = '00000000-0000-0000-0000-000000000000'

async function seedNotification(o: { absenceId: string; scope?: string; kind?: string; title?: string; message?: string; createdAt?: string }): Promise<string> {
  const rows = await sql(
    `insert into base.notifications (kind, absence_id, scope_code, title, message, created_at)
     values ($1, $2, $3, $4, $5, coalesce($6::timestamptz, now())) returning id`,
    [o.kind ?? 'CONFIRMATION', o.absenceId, o.scope ?? 'alpha', o.title ?? 'Absence retrouvée dans PayFit', o.message ?? 'Le dossier est présent dans PayFit.', o.createdAt ?? null],
  )
  return rows[0].id
}

async function seedAudit(o: { action: string; type: string; objectId?: string; actorId: string; email: string; at?: string; summary?: string; scope?: string | null }): Promise<string> {
  const rows = await sql(
    `insert into base.audit_logs (occurred_at, actor_id, actor_email, action, object_type, object_id, scope_code, summary)
     values (coalesce($1::timestamptz, now()), $2, $3, $4, $5, $6, $7, $8) returning id`,
    [o.at ?? null, o.actorId, o.email, o.action, o.type, o.objectId ?? 'obj', o.scope ?? null, o.summary ?? `Résumé ${o.action}`],
  )
  return rows[0].id
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += c
    } else if (c === '"') quoted = true
    else if (c === ';') {
      row.push(cell)
      cell = ''
    } else if (c === '\r') {
      // part of CRLF
    } else if (c === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

// Acceptance suite of version v1-evp: notifications, journal, CSV export.
describe('EVP notifications, journal and export', () => {
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

  // ───────────────────────────── notifications ─────────────────────────────
  describe('notifications', () => {
    let a1: string
    let b1: string

    beforeEach(async () => {
      a1 = await seedAbsence({ contractId: w.ctA.id, declaredBy: w.dirA.id, status: 'DANS_PAYFIT' })
      b1 = await seedAbsence({ contractId: w.ctB.id, crecheCode: 'beta', declaredBy: w.dirB.id, status: 'DANS_PAYFIT' })
    })

    it('[rule-evp-notif-list] [rule-evp-notif-scope] the list gives the events of the perimeter with the specified fields; a directrice never sees another crèche', async () => {
      const na = await seedNotification({ absenceId: a1 })
      const nb = await seedNotification({ absenceId: b1, scope: 'beta', kind: 'MODIFICATION' })
      const ids = async (who: { token: string }) => (await GET('/notifications', who.token)).body.items.map((i: any) => i.id)
      expect(await ids(w.dirA)).toEqual([na])
      expect(await ids(w.roA)).toEqual([na])
      expect(await ids(w.dirB)).toEqual([nb])
      for (const who of [w.rh, w.adm, w.sup]) expect((await ids(who)).sort()).toEqual([na, nb].sort())
      const res = await GET('/notifications', w.dirA.token)
      expect(sortedKeys(res.body)).toEqual(['items', 'truncated', 'unreadCount'])
      expect(sortedKeys(res.body.items[0])).toEqual(['absenceId', 'createdAt', 'crecheName', 'employeeName', 'id', 'kind', 'message', 'read', 'title'])
      expect(res.body.items[0]).toMatchObject({ kind: 'CONFIRMATION', absenceId: a1, crecheName: 'Crèche Alpha', employeeName: 'Léa Martin', read: false })
      expect(res.body.unreadCount).toBe(1)
      expect(res.body.truncated).toBe(false)
    })

    it('[rule-evp-notif-list] the five kinds are returned: confirmation, modification, cancellation, disappearance, restoration', async () => {
      for (const kind of ['CONFIRMATION', 'MODIFICATION', 'ANNULATION', 'DISPARITION', 'RESTAURATION']) await seedNotification({ absenceId: a1, kind })
      const kinds = (await GET('/notifications', w.rh.token)).body.items.map((i: any) => i.kind).sort()
      expect(kinds).toEqual(['ANNULATION', 'CONFIRMATION', 'DISPARITION', 'MODIFICATION', 'RESTAURATION'])
    })

    it('[rule-evp-notif-max-100] [rule-evp-notif-list] at most 100 notifications, newest first; truncated only above 100; the unread counter counts them all', async () => {
      await sql(
        `insert into base.notifications (kind, absence_id, scope_code, title, message, created_at)
         select 'CONFIRMATION', $1, 'alpha', 'Titre ' || g, 'Message', now() - (g || ' minutes')::interval from generate_series(1, 100) g`,
        [a1],
      )
      const exact = await GET('/notifications', w.dirA.token)
      expect(exact.body.items).toHaveLength(100)
      expect(exact.body.truncated).toBe(false)
      await seedNotification({ absenceId: a1, createdAt: new Date(Date.now() - 86400 * 1000).toISOString(), title: 'La plus ancienne' })
      const over = await GET('/notifications', w.dirA.token)
      expect(over.body.items).toHaveLength(100)
      expect(over.body.truncated).toBe(true)
      expect(over.body.items.map((i: any) => i.title)).not.toContain('La plus ancienne')
      const times = over.body.items.map((i: any) => Date.parse(i.createdAt))
      expect([...times].sort((x, y) => y - x)).toEqual(times)
      expect((await GET('/notifications/unread-count', w.dirA.token)).body).toEqual({ unreadCount: 101 })
      expect(over.body.unreadCount).toBe(101)
    })

    it('[rule-evp-notif-list] unreadOnly keeps only the notifications not yet read by the caller', async () => {
      const n1 = await seedNotification({ absenceId: a1 })
      const n2 = await seedNotification({ absenceId: a1, kind: 'MODIFICATION' })
      await POST(`/notifications/${n1}/read`, w.dirA.token)
      const unread = await GET('/notifications?unreadOnly=true', w.dirA.token)
      expect(unread.body.items.map((i: any) => i.id)).toEqual([n2])
      expect((await GET('/notifications?unreadOnly=false', w.dirA.token)).body.items).toHaveLength(2)
      expect((await GET('/notifications?unreadOnly=maybe', w.dirA.token)).status).toBe(400)
    })

    it('[rule-evp-notif-per-user-read] [rule-evp-notif-read-decides-nothing] marking a notification read affects only the reader: a colleague of the same crèche still sees it unread', async () => {
      const n1 = await seedNotification({ absenceId: a1 })
      const res = await POST(`/notifications/${n1}/read`, w.dirA.token)
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ id: n1, read: true })
      const mine = (await GET('/notifications', w.dirA.token)).body
      expect(mine.items[0].read).toBe(true)
      expect(mine.unreadCount).toBe(0)
      for (const who of [w.roA, w.rh, w.adm, w.sup]) {
        const theirs = (await GET('/notifications', who.token)).body
        expect(theirs.items[0].read).toBe(false)
        expect(theirs.unreadCount).toBe(1)
        expect((await GET('/notifications/unread-count', who.token)).body).toEqual({ unreadCount: 1 })
      }
      expect((await GET('/notifications/unread-count', w.dirA.token)).body).toEqual({ unreadCount: 0 })
    })

    it('[rule-evp-notif-read-decides-nothing] [rule-evp-notification-read-no-effect] [rule-evp-notif-read-not-journaled] reading is idempotent, writes only the read state, touches no dossier and leaves no audit entry', async () => {
      const n1 = await seedNotification({ absenceId: a1 })
      const dossier = JSON.stringify(await sql('select * from base.absences order by id'))
      const events = await countRows('absence_events')
      const audits = await auditCount()
      const notifications = JSON.stringify(await sql('select * from base.notifications order by id'))
      for (let i = 0; i < 2; i++) expect((await POST(`/notifications/${n1}/read`, w.rh.token)).status).toBe(200)
      expect(JSON.stringify(await sql('select * from base.absences order by id'))).toBe(dossier)
      expect(await countRows('absence_events')).toBe(events)
      expect(await auditCount()).toBe(audits)
      expect(JSON.stringify(await sql('select * from base.notifications order by id'))).toBe(notifications)
      expect(await countRows('notification_reads', 'user_id = $1', [w.rh.id])).toBe(1)
      expect((await GET(`/absences/${a1}`, w.rh.token)).body.status).toBe('DANS_PAYFIT')
    })

    it('[rule-evp-notif-scope] a notification of another crèche is 404, byte for byte the same as an unknown one, and nothing is written', async () => {
      const nb = await seedNotification({ absenceId: b1, scope: 'beta' })
      for (const who of [w.dirA, w.roA]) {
        const foreign = await POST(`/notifications/${nb}/read`, who.token)
        const unknown = await POST(`/notifications/${UNKNOWN_UUID}/read`, who.token)
        expect(foreign.status).toBe(404)
        expect(foreign.body).toEqual(unknown.body)
      }
      expect(await countRows('notification_reads')).toBe(0)
    })

    it('[rule-evp-notif-list] malformed identifier 400; anonymous 401 on the three routes', async () => {
      expect((await POST('/notifications/nope/read', w.dirA.token)).status).toBe(400)
      expect((await GET('/notifications')).status).toBe(401)
      expect((await GET('/notifications/unread-count')).status).toBe(401)
      expect((await POST(`/notifications/${UNKNOWN_UUID}/read`)).status).toBe(401)
    })

    it('[rule-evp-notif-list] every EVP role, ADMINISTRATRICE included, reads its notifications and counter', async () => {
      await seedNotification({ absenceId: a1 })
      for (const who of [w.dirA, w.roA, w.rh, w.adm, w.sup]) {
        expect((await GET('/notifications', who.token)).status).toBe(200)
        expect((await GET('/notifications/unread-count', who.token)).status).toBe(200)
      }
    })

    it('[rule-evp-notif-scope] there is no route to create, change or delete a notification', async () => {
      const n1 = await seedNotification({ absenceId: a1 })
      for (const [method, path] of [['POST', '/notifications'], ['PATCH', `/notifications/${n1}`], ['DELETE', `/notifications/${n1}`], ['PUT', `/notifications/${n1}`]] as const) {
        expect((await http(method, path, { token: w.sup.token, body: { title: 'x' } })).status).toBe(404)
      }
      expect(await countRows('notifications')).toBe(1)
    })
  })

  // ───────────────────────────── journal ─────────────────────────────
  describe('journal', () => {
    async function seedJournal() {
      const abs = await seedAbsence({ contractId: w.ctA.id, declaredBy: w.dirA.id })
      const at = (m: number) => new Date(Date.parse('2026-02-10T10:00:00Z') + m * 60000).toISOString()
      const ids: Record<string, string> = {}
      ids.validate = await seedAudit({ action: 'absences:validate', type: 'Absence', objectId: abs, actorId: w.rh.id, email: w.rh.email, at: at(1) })
      ids.access = await seedAudit({ action: 'access:create', type: 'Accès', objectId: w.roA.id, actorId: w.rh.id, email: w.rh.email, at: at(2) })
      ids.closure = await seedAudit({ action: 'closures:attest', type: 'Clôture', objectId: 'alpha-2026-01', actorId: w.dirA.id, email: w.dirA.email, at: at(3), scope: 'alpha' })
      ids.piece = await seedAudit({ action: 'justificatifs:read-link', type: 'Justificatif', objectId: abs, actorId: w.rh.id, email: w.rh.email, at: at(4) })
      ids.exp = await seedAudit({ action: 'exports:absences', type: 'Export', objectId: 'export', actorId: w.sup.id, email: w.sup.email, at: at(5) })
      ids.source = await seedAudit({ action: 'sources:refresh', type: 'Lecture de source', objectId: 'payfit', actorId: w.rh.id, email: w.rh.email, at: at(6) })
      ids.system = await seedAudit({ action: 'sources:reconcile', type: 'Absence', objectId: abs, actorId: SYSTEM_ID, email: 'systeme@evp.invalid', at: at(7) })
      ids.batch = await seedAudit({ action: 'absences:validate', type: 'Absence', objectId: 'lot', actorId: w.rh.id, email: w.rh.email, at: at(8) })
      // entries of the foundation, to be excluded
      await seedAudit({ action: 'users:create', type: 'Utilisateur', actorId: w.sup.id, email: w.sup.email, at: at(9) })
      await seedAudit({ action: 'groups:update', type: 'Groupe', actorId: w.sup.id, email: w.sup.email, at: at(10) })
      await seedAudit({ action: 'scopes:create', type: 'Périmètre', actorId: w.sup.id, email: w.sup.email, at: at(11) })
      await seedAudit({ action: 'users:import-confirm', type: 'Import de comptes', actorId: w.sup.id, email: w.sup.email, at: at(12) })
      return { abs, ids }
    }

    it('[rule-evp-journal-covers] [rule-evp-journal-source] RH and SUPERADMIN read the EVP actions from the audit trail, never the actions of the foundation', async () => {
      await seedJournal()
      for (const who of [w.rh, w.sup]) {
        const res = await GET('/journal-entries?size=50', who.token)
        expect(res.status).toBe(200)
        expect(res.body.total).toBe(8)
        const ops = new Set(res.body.items.map((i: any) => i.operation))
        expect([...ops].sort()).toEqual(['absences:validate', 'access:create', 'closures:attest', 'exports:absences', 'justificatifs:read-link', 'sources:reconcile', 'sources:refresh'])
        for (const i of res.body.items) expect(i.operation).not.toMatch(/^(users|groups|scopes|auth|audit|imports)/)
      }
    })

    it('[rule-evp-journal-covers] an entry has exactly id, occurredAt, actorName, actorEmail, operation, operationLabel, summary and absenceId; the label is French, not the code', async () => {
      await seedJournal()
      const res = await GET('/journal-entries?size=50', w.rh.token)
      for (const i of res.body.items) {
        expect(sortedKeys(i)).toEqual(['absenceId', 'actorEmail', 'actorName', 'id', 'occurredAt', 'operation', 'operationLabel', 'summary'])
        expect(i.operationLabel).toEqual(expect.any(String))
        expect(i.operationLabel.length).toBeGreaterThan(0)
        expect(i.operationLabel).not.toBe(i.operation)
        expect(i.operationLabel).not.toMatch(/:/)
      }
      const link = res.body.items.find((i: any) => i.operation === 'justificatifs:read-link')
      expect(link.operationLabel).toBe('Ouverture de justificatif')
    })

    it('[rule-evp-journal-source] the author name comes from the EVP accounts and automatic reconciliation entries are attributed to « Système »', async () => {
      await seedJournal()
      const res = await GET('/journal-entries?size=50', w.rh.token)
      const byOp = (op: string) => res.body.items.find((i: any) => i.operation === op)
      expect(byOp('access:create')).toMatchObject({ actorName: w.rh.name, actorEmail: w.rh.email })
      expect(byOp('exports:absences')).toMatchObject({ actorName: w.sup.name })
      expect(byOp('sources:reconcile')).toMatchObject({ actorName: 'Système' })
      expect(byOp('sources:reconcile').operationLabel).toBe('Rapprochement PayFit')
    })

    it('[rule-evp-journal-source] absenceId is set for dossier and piece entries, null for access, closure, export and batch entries', async () => {
      const { abs } = await seedJournal()
      const res = await GET('/journal-entries?size=50', w.rh.token)
      const entries = res.body.items
      expect(entries.find((i: any) => i.operation === 'justificatifs:read-link').absenceId).toBe(abs)
      expect(entries.find((i: any) => i.operation === 'sources:reconcile').absenceId).toBe(abs)
      for (const op of ['access:create', 'closures:attest', 'exports:absences', 'sources:refresh']) expect(entries.find((i: any) => i.operation === op).absenceId).toBeNull()
      const batch = entries.filter((i: any) => i.operation === 'absences:validate')
      expect(batch.map((b: any) => b.absenceId).sort((x: any, y: any) => String(x).localeCompare(String(y)))).toEqual([abs, null].sort((x, y) => String(x).localeCompare(String(y))))
    })

    it('[rule-evp-journal-pagination] newest first, 25 per page by default, sizes 10/25/50 only, from offsets the page', async () => {
      for (let i = 0; i < 30; i++) {
        await seedAudit({ action: 'access:create', type: 'Accès', actorId: w.rh.id, email: w.rh.email, at: new Date(Date.parse('2026-03-01T00:00:00Z') + i * 1000).toISOString(), summary: `Entrée ${i}` })
      }
      const def = await GET('/journal-entries', w.rh.token)
      expect(def.body.items).toHaveLength(25)
      expect(def.body.total).toBe(30)
      expect(def.body.items[0].summary).toBe('Entrée 29')
      expect(def.body.items[24].summary).toBe('Entrée 5')
      const page = await GET('/journal-entries?from=25&size=10', w.rh.token)
      expect(page.body.items.map((i: any) => i.summary)).toEqual(['Entrée 4', 'Entrée 3', 'Entrée 2', 'Entrée 1', 'Entrée 0'])
      expect((await GET('/journal-entries?size=10', w.rh.token)).body.items).toHaveLength(10)
      expect((await GET('/journal-entries?size=50', w.rh.token)).body.items).toHaveLength(30)
      for (const q of ['size=0', 'size=5', 'size=11', 'size=100', 'size=x', 'from=-1', 'from=x']) {
        const res = await GET(`/journal-entries?${q}`, w.rh.token)
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('api.validation.incoming_failed')
      }
    })

    it('[rule-evp-journal-pagination] entries with the same instant keep a stable total order across pages', async () => {
      for (let i = 0; i < 12; i++) await seedAudit({ action: 'access:create', type: 'Accès', actorId: w.rh.id, email: w.rh.email, at: '2026-03-01T00:00:00Z', summary: `Même instant ${i}` })
      const first = await GET('/journal-entries?size=10', w.rh.token)
      const second = await GET('/journal-entries?size=10&from=10', w.rh.token)
      const ids = [...first.body.items, ...second.body.items].map((i: any) => i.id)
      expect(new Set(ids).size).toBe(12)
    })

    it('[rule-evp-journal-covers] filters by operation, author, dossier and dates combine', async () => {
      const { abs } = await seedJournal()
      const ops = await GET('/journal-entries?operation=access:create', w.rh.token)
      expect(ops.body.total).toBe(1)
      const byActor = await GET(`/journal-entries${qs({ actorId: w.sup.id })}`, w.rh.token)
      expect(byActor.body.items.map((i: any) => i.operation)).toEqual(['exports:absences'])
      const byAbsence = await GET(`/journal-entries${qs({ absenceId: abs })}`, w.rh.token)
      expect(byAbsence.body.items.map((i: any) => i.operation).sort()).toEqual(['absences:validate', 'justificatifs:read-link', 'sources:reconcile'])
      const byDay = await GET('/journal-entries?dateFrom=2026-02-10&dateTo=2026-02-10&size=50', w.rh.token)
      expect(byDay.body.total).toBe(8)
      expect((await GET('/journal-entries?dateFrom=2026-02-11', w.rh.token)).body.total).toBe(0)
      expect((await GET('/journal-entries?dateTo=2026-02-09', w.rh.token)).body.total).toBe(0)
      const combined = await GET(`/journal-entries${qs({ actorId: w.rh.id, operation: 'absences:validate', dateFrom: '2026-02-10' })}`, w.rh.token)
      expect(combined.body.total).toBe(2)
    })

    it.each(['dateFrom=2026-02-10&dateTo=2026-02-09', 'dateFrom=demain', 'dateTo=2026-02-30', 'actorId=nope', 'absenceId=nope', 'operation=', 'dateFrom='])(
      '[rule-evp-journal-pagination] query %s answers 400 api.validation.incoming_failed',
      async (q) => {
        const res = await GET(`/journal-entries?${q}`, w.rh.token)
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('api.validation.incoming_failed')
      },
    )

    it('[rule-evp-journal-covers] the filter route lists the EVP operations with their French label and the authors, and nothing from the foundation', async () => {
      await seedJournal()
      const res = await GET('/journal-entries/filters', w.rh.token)
      expect(res.status).toBe(200)
      expect(sortedKeys(res.body)).toEqual(['actors', 'operations'])
      const codes = res.body.operations.map((o: any) => o.code)
      expect(codes).toEqual(expect.arrayContaining(['absences:validate', 'access:create', 'closures:attest', 'exports:absences', 'justificatifs:read-link']))
      for (const c of codes) expect(c).not.toMatch(/^(users|groups|scopes)/)
      for (const o of res.body.operations) expect(sortedKeys(o)).toEqual(['code', 'label'])
      expect(res.body.actors.map((a: any) => a.id)).toEqual(expect.arrayContaining([w.rh.id, w.sup.id]))
      const sup = res.body.actors.find((a: any) => a.id === w.sup.id)
      expect(sup).toEqual({ id: w.sup.id, name: w.sup.name })
    })

    it('[rule-evp-journal-readonly] only RH and SUPERADMIN read the journal: directrice, RO and ADMINISTRATRICE get 403 without data, anonymous 401', async () => {
      await seedJournal()
      for (const path of ['/journal-entries', '/journal-entries/filters']) {
        for (const who of [w.dirA, w.roA, w.adm]) {
          const res = await GET(path, who.token)
          expect(res.status).toBe(403)
          expect(res.text).not.toContain('absences:validate')
        }
        expect((await GET(path)).status).toBe(401)
        expect((await GET(path, w.rh.token)).status).toBe(200)
        expect((await GET(path, w.sup.token)).status).toBe(200)
      }
    })

    it('[rule-evp-journal-readonly] the role check precedes the validation of the query (403, not 400)', async () => {
      expect((await GET('/journal-entries?size=3', w.dirA.token)).status).toBe(403)
    })

    it('[rule-evp-journal-readonly] there is no route to write or delete a journal entry: 404 for every write method, the trail is unchanged', async () => {
      const id = await seedAudit({ action: 'access:create', type: 'Accès', actorId: w.rh.id, email: w.rh.email })
      const before = await auditCount()
      for (const who of [w.rh, w.sup]) {
        for (const [method, path] of [
          ['POST', '/journal-entries'], ['PUT', '/journal-entries'], ['PATCH', `/journal-entries/${id}`], ['DELETE', `/journal-entries/${id}`],
          ['DELETE', '/journal-entries'], ['POST', '/journal-entries/filters'],
        ] as const) {
          expect(((await http(method, path, { token: who.token, body: { summary: 'x' } })).status)).toBe(404)
        }
      }
      expect(await auditCount()).toBe(before)
    })

    it('[rule-evp-journal-covers] [rule-evp-journal-no-medical] actions performed through the API appear in the journal: access, closure, export, piece opening, decision, source reading; no raw value, no private file name', async () => {
      writeFixture('payfit', payfitFixture([]))
      await http('POST', '/access-accounts', { token: w.rh.token, body: { email: 'nouvelle.ro@micro-stars.fr', name: 'Nouvelle RO', role: 'RO', active: true, crecheCodes: ['alpha'] } })
      await POST(`/creches/alpha/closures/${monthShift(-3)}`, w.dirA.token, { attested: true })
      const created = await createAbsence(w.dirA.token, { contractId: w.ctA.id, comment: 'Confidentiel-4242' })
      const piece = await uploadPiece(w.dirA.token, { fileName: 'arret-prive-dupont.pdf' })
      await createAbsence(w.dirA.token, { contractId: w.ctA2.id, typeCode: 'ARRET_MALADIE', justificatifIds: [piece.id] })
      await POST(`/justificatifs/${piece.id}/read-link`, w.rh.token)
      await POST(`/absences/${created.body.id}/validate`, w.rh.token)
      await POST('/exports/absences', w.rh.token, { from: d(-30), to: d(30) })
      await refresh(w.rh.token, 'payfit')
      const res = await GET('/journal-entries?size=50', w.rh.token)
      const ops = new Set(res.body.items.map((i: any) => i.operation))
      for (const op of ['access:create', 'closures:attest', 'absences:create', 'justificatifs:read-link', 'absences:validate', 'exports:absences', 'sources:refresh']) expect(ops).toContain(op)
      expect(res.text).not.toContain('arret-prive-dupont')
      expect(res.text).not.toContain('Confidentiel-4242')
      for (const i of res.body.items) {
        expect(i.actorName).toEqual(expect.any(String))
        expect(i.summary.length).toBeGreaterThan(0)
        expect(i.summary.length).toBeLessThanOrEqual(500)
        expect(Math.abs(Date.now() - Date.parse(i.occurredAt))).toBeLessThan(10 * 60 * 1000)
      }
    })

    it('[rule-evp-journal-source] a password login of the foundation leaves no entry in the EVP journal', async () => {
      const { createUser, login } = await import('./harness')
      await createUser({ email: 'socle@example.com', password: 'Passw0rd!x', role: 'user' })
      await login('socle@example.com', 'Passw0rd!x')
      await http('POST', '/auth/logout')
      const res = await GET('/journal-entries?size=50', w.rh.token)
      expect(res.body.total).toBe(0)
    })
  })

  // ───────────────────────────── export ─────────────────────────────
  describe('POST /exports/absences', () => {
    const from = '2026-01-01'
    const to = '2026-01-31'

    async function seedPeriod() {
      const ids: Record<string, string> = {}
      const reason = (text: string) => ({ kind: 'reject', by: w.rh.id, at: new Date().toISOString(), reason: text })
      ids.inside = await seedAbsence({ contractId: w.ctA.id, declaredBy: w.dirA.id, status: 'A_VALIDER', startDate: '2026-01-10', endDate: '2026-01-12', startHalf: 'APRES_MIDI', endHalf: 'MATIN' })
      ids.endsOnFrom = await seedAbsence({ contractId: w.ctA.id, declaredBy: w.dirA.id, status: 'ANNULEE', startDate: '2025-12-20', endDate: '2026-01-01', typeCode: 'AUTRE', lastDecision: reason('Doublon') })
      ids.startsOnTo = await seedAbsence({ contractId: w.ctA2.id, declaredBy: w.dirA.id, status: 'DANS_PAYFIT', startDate: '2026-01-31', endDate: '2026-02-02' })
      ids.before = await seedAbsence({ contractId: w.ctA2.id, declaredBy: w.dirA.id, status: 'A_VALIDER', startDate: '2025-12-01', endDate: '2025-12-31' })
      ids.after = await seedAbsence({ contractId: w.ctA.id, declaredBy: w.dirA.id, status: 'A_VALIDER', startDate: '2026-02-01', endDate: '2026-02-03' })
      ids.spans = await seedAbsence({ contractId: w.ctA2.id, declaredBy: w.dirA.id, status: 'REJETEE', startDate: '2025-12-01', endDate: '2026-03-01', typeCode: 'SANS_JUSTIFICATIF', lastDecision: reason('=HYPERLINK("http://exemple.invalid")') })
      ids.beta = await seedAbsence({ contractId: w.ctB.id, crecheCode: 'beta', declaredBy: w.dirB.id, status: 'A_SAISIR', startDate: '2026-01-15', endDate: '2026-01-15' })
      return ids
    }

    const exportCsv = (token: string | undefined, f = from, t = to) => POST('/exports/absences', token, { from: f, to: t })

    it('[rule-evp-export-period] [rule-evp-export-all-statuses] every absence overlapping the period is exported, bounds included, whatever its state and crèche; the others are not', async () => {
      await seedPeriod()
      const res = await exportCsv(w.rh.token)
      expect(res.status).toBe(200)
      const rows = parseCsv(res.text.replace(/^﻿/, '')).filter((r) => r.length > 1)
      expect(rows).toHaveLength(1 + 5)
      const starts = rows.slice(1).map((r) => r[5]).sort()
      expect(starts).toEqual(['2025-12-01', '2025-12-20', '2026-01-10', '2026-01-15', '2026-01-31'])
    })

    it('[rule-evp-export-columns] [rule-evp-export-csv-format] the header and the cells follow the specification: BOM, semicolon, CRLF, ISO dates, half-days', async () => {
      await seedPeriod()
      const res = await exportCsv(w.rh.token)
      expect(res.text.charCodeAt(0)).toBe(0xfeff)
      expect(res.text).toContain('\r\n')
      expect(res.text.replace(/\r\n/g, '')).not.toMatch(/\n|\r/)
      const rows = parseCsv(res.text.slice(1)).filter((r) => r.length > 1)
      expect(rows[0]).toEqual(['Crèche', 'Salariée', 'Contrat', 'Type', 'Code PayFit', 'Début', 'Demi-journée de début', 'Fin', 'Demi-journée de fin', 'Statut', 'Motif administratif'])
      for (const r of rows) expect(r).toHaveLength(11)
      const inside = rows.find((r) => r[5] === '2026-01-10')!
      expect(['Crèche Alpha', 'alpha']).toContain(inside[0])
      expect(inside[1]).toBe('Léa Martin')
      expect(inside[2]).toContain('ct-a1')
      expect(['Congés payés', 'CONGES_PAYES']).toContain(inside[3])
      expect(inside[4]).toBe('CP')
      expect(inside.slice(5, 9)).toEqual(['2026-01-10', 'APRES_MIDI', '2026-01-12', 'MATIN'])
      expect(inside[9].length).toBeGreaterThan(0)
      const statuses = new Set(rows.slice(1).map((r) => r[9]))
      expect(statuses.size).toBe(5)
    })

    it('[rule-evp-export-columns] the administrative reason of the last decision is exported', async () => {
      await seedPeriod()
      const rows = parseCsv((await exportCsv(w.rh.token)).text.slice(1)).filter((r) => r.length > 1)
      expect(rows.find((r) => r[5] === '2025-12-20')![10]).toContain('Doublon')
      expect(rows.find((r) => r[5] === '2026-01-10')![10]).toBe('')
    })

    it('[rule-evp-export-csv-format] a cell starting with =, +, - or @ is prefixed with an apostrophe (no formula injection)', async () => {
      await seedPeriod()
      const nasty = ['=1+1', '+33 6', '-2+3', '@SUM(A1)']
      for (const [i, text] of nasty.entries()) {
        await seedAbsence({ contractId: w.ctA2.id, declaredBy: w.dirA.id, status: 'REJETEE', startDate: `2026-01-${String(20 + i).padStart(2, '0')}`, endDate: `2026-01-${String(20 + i).padStart(2, '0')}`, lastDecision: { kind: 'reject', by: w.rh.id, at: new Date().toISOString(), reason: text } })
      }
      const res = await exportCsv(w.rh.token)
      const rows = parseCsv(res.text.slice(1)).filter((r) => r.length > 1)
      for (const text of nasty) expect(rows.some((r) => r[10] === `'${text}`)).toBe(true)
      expect(rows.find((r) => r[5] === '2025-12-01')![10]).toBe(`'=HYPERLINK("http://exemple.invalid")`)
      for (const r of rows.slice(1)) for (const cell of r) expect(cell).not.toMatch(/^[=+\-@]/)
    })

    it('[rule-evp-export-period] a period without absence gives the header alone; the file name carries the period', async () => {
      const res = await exportCsv(w.rh.token, '2030-01-01', '2030-01-31')
      expect(res.status).toBe(200)
      expect(parseCsv(res.text.slice(1)).filter((r) => r.length > 1)).toHaveLength(1)
      expect(res.headers.get('content-disposition')).toBe('attachment; filename="absences-2030-01-01_2030-01-31.csv"')
      expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    })

    it('[rule-evp-export-csv-format] the response is an attachment named after the period', async () => {
      await seedPeriod()
      const res = await exportCsv(w.sup.token)
      expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
      expect(res.headers.get('content-disposition')).toBe('attachment; filename="absences-2026-01-01_2026-01-31.csv"')
      expect(res.headers.get('cache-control') ?? '').toMatch(/no-store/)
    })

    it('[rule-evp-export-roles] only RH and SUPERADMIN export: directrice, RO and ADMINISTRATRICE get 403 and leave no trace, anonymous 401', async () => {
      await seedPeriod()
      for (const who of [w.dirA, w.roA, w.adm]) {
        const res = await exportCsv(who.token)
        expect(res.status).toBe(403)
        expect(res.text).not.toContain('Léa Martin')
      }
      expect((await exportCsv(undefined)).status).toBe(401)
      expect(await auditCount('exports:absences')).toBe(0)
      expect((await exportCsv(w.rh.token)).status).toBe(200)
      expect((await exportCsv(w.sup.token)).status).toBe(200)
    })

    it('[rule-evp-export-roles] the role check precedes the validation of the body (403, not 400)', async () => {
      expect((await POST('/exports/absences', w.dirA.token, {})).status).toBe(403)
    })

    it('[rule-evp-export-max-span] a period of 366 days is accepted, 367 days is refused 400, to before from is refused, one day is accepted', async () => {
      expect((await exportCsv(w.rh.token, '2024-01-01', '2024-12-31')).status).toBe(200)
      const over = await exportCsv(w.rh.token, '2024-01-01', '2025-01-01')
      expect(over.status).toBe(400)
      expect(over.body.code).toBe('api.validation.incoming_failed')
      expect((await exportCsv(w.rh.token, '2026-01-31', '2026-01-30')).status).toBe(400)
      expect((await exportCsv(w.rh.token, '2026-01-31', '2026-01-31')).status).toBe(200)
    })

    it('[rule-evp-export-period] malformed or missing dates are refused 400 and leave no trace', async () => {
      for (const body of [{}, { from }, { to }, { from: 'hier', to }, { from, to: '2026-02-30' }, { from: '01/01/2026', to: '31/01/2026' }, { from: 1, to: 2 }, { from: null, to: null }]) {
        const res = await POST('/exports/absences', w.rh.token, body)
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('api.validation.incoming_failed')
      }
      expect(await auditCount('exports:absences')).toBe(0)
    })

    it('[rule-evp-export-audited] an export writes one audit entry with the period and the number of rows, without any employee name; a refused one writes none', async () => {
      await seedPeriod()
      const res = await exportCsv(w.rh.token)
      const lines = parseCsv(res.text.slice(1)).filter((r) => r.length > 1).length - 1
      const entries = await auditRows('exports:absences')
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ actor_id: w.rh.id, object_type: 'Export' })
      expect(entries[0].summary).toMatch(new RegExp(`(^|\\D)${lines}(\\D|$)`))
      for (const name of ['Léa', 'Martin', 'Noé', 'Petit', 'Zoé', 'Durand']) expect(entries[0].summary).not.toContain(name)
      await exportCsv(w.dirA.token)
      await exportCsv(w.rh.token, '2026-02-01', '2026-01-01')
      expect(await auditCount('exports:absences')).toBe(1)
    })

    it('[rule-evp-export-no-payfit-write] [rule-evp-export-post-for-audit] an export triggers no source reading and no connector call, and changes no dossier', async () => {
      await seedPeriod()
      const dossiers = JSON.stringify(await sql('select * from base.absences order by id'))
      const log = callsLog()
      await exportCsv(w.rh.token)
      expect(callsLog()).toBe(log)
      expect(await countRows('source_runs')).toBe(0)
      expect(JSON.stringify(await sql('select * from base.absences order by id'))).toBe(dossiers)
    })

    it('[rule-evp-export-post-for-audit] the export is a POST: GET is not a route', async () => {
      expect((await http('GET', '/exports/absences', { token: w.rh.token })).status).toBe(404)
    })
  })

  // helper typing guard (keeps Status imported for readers of the file)
  it('[rule-evp-decision-states] the seven states of the specification are the only ones the database accepts', async () => {
    const states: Status[] = ['A_COMPLETER', 'ANTICIPEE', 'A_VALIDER', 'A_SAISIR', 'DANS_PAYFIT', 'REJETEE', 'ANNULEE']
    const rows = await sql("select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'base' and t.typname = 'absence_status'")
    expect(rows.map((r) => r.enumlabel).sort()).toEqual([...states].sort())
  })
})
