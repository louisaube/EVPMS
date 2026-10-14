import { resetData, closePool, sql } from './harness'
import {
  http, GET, POST, PATCH, UNKNOWN_UUID, seedWorld, seedAbsence, createAbsence, World, auditRows, auditCount, countRows, addDays, todayParis,
  closeEvp, ALL_STATUSES, Status, callsLog, absenceRow, statusOf, seedContract,
} from './evp-helpers'

const d = (n: number) => addDays(todayParis(), n)
let seq = 0
/** A fresh single day in the past, never reused, so that seeded dossiers of one contract do not collide. */
const nextDay = (): string => d(-200 - 3 * seq++)

// Acceptance suite of version v1-evp: lifecycle and decisions (submit, validate, batch, return, reject, cancel, mark-entered, server-side edit).
describe('EVP decisions and lifecycle', () => {
  let w: World

  beforeEach(async () => {
    await resetData()
    w = await seedWorld()
  })
  afterAll(async () => {
    await closeEvp()
    await closePool()
  })

  const seed = (status: Status, over: Record<string, unknown> = {}) =>
    seedAbsence({ contractId: w.ctA.id, declaredBy: w.dirA.id, status, startDate: d(-6), endDate: d(-4), ...(over as any) })
  const act = (decision: string, id: string, token?: string, body?: unknown) => POST(`/absences/${id}/${decision}`, token, body)
  const timelineLength = async (id: string) => (await GET(`/absences/${id}`, w.rh.token)).body.timeline.length

  /** Table des transitions du plan de module (source unique) : états de départ autorisés et état d'arrivée. */
  const TRANSITIONS: Record<string, { from: Status[]; to: Status; byRh?: boolean; reason?: boolean }> = {
    submit: { from: ['A_COMPLETER', 'ANTICIPEE', 'A_VALIDER'], to: 'A_VALIDER' },
    validate: { from: ['A_VALIDER'], to: 'A_SAISIR', byRh: true },
    return: { from: ['ANTICIPEE', 'A_VALIDER', 'A_SAISIR'], to: 'A_COMPLETER', byRh: true, reason: true },
    reject: { from: ['A_COMPLETER', 'ANTICIPEE', 'A_VALIDER', 'A_SAISIR'], to: 'REJETEE', byRh: true, reason: true },
    cancel: { from: ['A_COMPLETER', 'ANTICIPEE', 'A_VALIDER'], to: 'ANNULEE', reason: true },
  }

  describe('transition table', () => {
    for (const [decision, t] of Object.entries(TRANSITIONS)) {
      for (const status of ALL_STATUSES) {
        const allowed = t.from.includes(status)
        it(`[rule-evp-decision-states] [rule-evp-detail-actions-from-api] ${decision} from ${status}: ${allowed ? `200 → ${decision === 'submit' ? 'recomputed' : t.to}` : '409 absences.decision_not_allowed, dossier unchanged'}`, async () => {
          const id = await seed(status)
          const token = t.byRh ? w.rh.token : w.dirA.token
          const before = await absenceRow(id)
          const res = await act(decision, id, token, t.reason ? { reason: 'Motif administratif' } : undefined)
          if (allowed) {
            expect(res.status).toBe(200)
            if (decision !== 'submit') expect(res.body.status).toBe(t.to)
            else expect(['A_VALIDER', 'A_COMPLETER', 'ANTICIPEE']).toContain(res.body.status)
            expect(await statusOf(id)).toBe(res.body.status)
          } else {
            expect(res.status).toBe(409)
            expect(res.body.code).toBe('absences.decision_not_allowed')
            const after = await absenceRow(id)
            expect(after.status).toBe(before.status)
            expect(after.saisie_declaree).toBe(before.saisie_declaree)
            expect(await auditCount(`absences:${decision}`)).toBe(0)
          }
        })
      }
    }

    it.each(ALL_STATUSES)('[rule-evp-decision-states] [rule-evp-mark-entered-no-proof] mark-entered from %s: only A_SAISIR is accepted', async (status) => {
      const id = await seed(status)
      const res = await act('mark-entered', id, w.rh.token)
      if (status === 'A_SAISIR') expect(res.status).toBe(200)
      else {
        expect(res.status).toBe(409)
        expect(res.body.code).toBe('absences.decision_not_allowed')
        expect((await absenceRow(id)).saisie_declaree).toBe(false)
      }
    })

    it('[rule-evp-payfit-no-manual-confirm] no decision leads to DANS_PAYFIT, whatever the starting state and the role', async () => {
      for (const decision of ['submit', 'validate', 'return', 'reject', 'cancel', 'mark-entered']) {
        for (const status of ALL_STATUSES) {
          if (status === 'DANS_PAYFIT') continue
          for (const token of [w.rh.token, w.dirA.token, w.sup.token]) {
            const day = nextDay()
            const id = await seed(status, { startDate: day, endDate: day })
            await act(decision, id, token, { reason: 'x' })
            expect(await statusOf(id)).not.toBe('DANS_PAYFIT')
          }
        }
      }
      expect(await countRows('absences', "status = 'DANS_PAYFIT'")).toBe(0)
    })

    it('[rule-evp-payfit-no-manual-confirm] no route and no field confirms a presence: unknown routes are 404, PATCH with a status is 400', async () => {
      const id = await seed('A_SAISIR')
      for (const path of ['confirm', 'confirm-payfit', 'payfit-confirmed', 'mark-in-payfit', 'in-payfit']) {
        expect((await act(path, id, w.sup.token)).status).toBe(404)
        expect((await act(path, id, w.rh.token)).status).toBe(404)
      }
      for (const field of [{ status: 'DANS_PAYFIT' }, { saisieDeclaree: true }]) {
        const res = await PATCH(`/absences/${id}`, w.rh.token, field)
        expect(res.status).toBe(400)
      }
      expect(await statusOf(id)).toBe('A_SAISIR')
    })
  })

  // ───────────────────────────── submit ─────────────────────────────
  describe('POST /absences/:id/submit', () => {
    it('[rule-evp-decision-replay-controls] resubmission replays the controls: a corrected « À compléter » dossier becomes « À valider »', async () => {
      const id = await seed('A_COMPLETER')
      const res = await act('submit', id, w.dirA.token)
      expect(res.status).toBe(200)
      expect(res.body.status).toBe('A_VALIDER')
      expect(res.body.blockages).toEqual([])
    })

    it('[rule-evp-decision-replay-controls] a still-blocked dossier stays « À compléter » with its blockages (200, not an HTTP error)', async () => {
      const id = await seed('A_COMPLETER', { typeCode: 'ENFANT_MALADE' })
      const res = await act('submit', id, w.dirA.token)
      expect(res.status).toBe(200)
      expect(res.body.status).toBe('A_COMPLETER')
      expect(res.body.blockages.map((b: any) => b.code)).toContain('piece_missing')
    })

    it('[rule-evp-decision-replay-controls] an anticipated dossier whose start date has passed becomes « À valider » on submission; a dossier with a future start becomes « Anticipée »', async () => {
      const passed = await seed('ANTICIPEE', { startDate: d(-3), endDate: d(-2) })
      expect((await act('submit', passed, w.dirA.token)).body.status).toBe('A_VALIDER')
      const future = await seed('A_VALIDER', { contractId: w.ctA2.id, startDate: d(7), endDate: d(8) })
      expect((await act('submit', future, w.dirA.token)).body.status).toBe('ANTICIPEE')
    })

    it('[rule-evp-declare-no-auto-anticipation] an anticipated dossier whose start date is reached never moves by itself: reads and lists leave it « Anticipée »', async () => {
      const id = await seed('ANTICIPEE', { startDate: d(-1), endDate: d(1) })
      await GET(`/absences/${id}`, w.rh.token)
      await GET('/absences', w.rh.token)
      await GET('/todo', w.rh.token)
      await GET('/creches/alpha/closures', w.rh.token)
      expect(await statusOf(id)).toBe('ANTICIPEE')
      expect((await GET(`/absences/${id}`, w.dirA.token)).body.status).toBe('ANTICIPEE')
      expect((await act('validate', id, w.rh.token)).status).toBe(409)
    })

    it('[rule-evp-declare-roles] RO, RH and SUPERADMIN can submit in their perimeter; ADMINISTRATRICE 403; another crèche’s directrice 404; anonymous 401', async () => {
      for (const who of [w.roA, w.rh, w.sup]) {
        const day = nextDay()
        expect((await act('submit', await seed('A_COMPLETER', { startDate: day, endDate: day }), who.token)).status).toBe(200)
      }
      const id = await seed('A_COMPLETER', { contractId: w.ctA2.id })
      expect((await act('submit', id, w.adm.token)).status).toBe(403)
      const foreign = await act('submit', id, w.dirB.token)
      const unknown = await act('submit', UNKNOWN_UUID, w.dirB.token)
      expect(foreign.status).toBe(404)
      expect(foreign.body).toEqual(unknown.body)
      expect((await act('submit', id)).status).toBe(401)
      expect(await statusOf(id)).toBe('A_COMPLETER')
    })

    it('[rule-evp-audit-atomic] a submission leaves one audit entry and one more timeline event', async () => {
      const id = await seed('A_COMPLETER')
      const before = await timelineLength(id)
      await act('submit', id, w.dirA.token)
      const entries = await auditRows('absences:submit')
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ actor_id: w.dirA.id, object_type: 'Absence', object_id: id })
      expect(await timelineLength(id)).toBeGreaterThan(before)
    })
  })

  // ───────────────────────────── validate ─────────────────────────────
  describe('POST /absences/:id/validate', () => {
    it('[rule-evp-decision-marine-only] [rule-evp-validated-is-to-enter] RH validates: « Validée à saisir », nothing sent to PayFit, decision traced', async () => {
      const id = await seed('A_VALIDER')
      const log = callsLog()
      const before = await timelineLength(id)
      const res = await act('validate', id, w.rh.token)
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ id, status: 'A_SAISIR', saisieDeclaree: false })
      expect(res.body.nextAction.actor).toBe('LECTURE_PAYFIT')
      expect(res.body.lastDecision).toMatchObject({ byName: w.rh.name })
      expect(res.body.payfitProof).toBeNull()
      expect(await timelineLength(id)).toBeGreaterThan(before)
      expect(callsLog()).toBe(log)
      const entries = await auditRows('absences:validate')
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ actor_id: w.rh.id, object_type: 'Absence', object_id: id })
      expect(await countRows('payfit_proofs')).toBe(0)
    })

    it('[rule-evp-decision-marine-only] directrice, RO, ADMINISTRATRICE and even SUPERADMIN get 403 and the dossier is unchanged; anonymous 401', async () => {
      const id = await seed('A_VALIDER')
      for (const who of [w.dirA, w.roA, w.adm, w.sup]) {
        const res = await act('validate', id, who.token)
        expect(res.status).toBe(403)
      }
      expect((await act('validate', id)).status).toBe(401)
      expect(await statusOf(id)).toBe('A_VALIDER')
      expect(await auditCount('absences:validate')).toBe(0)
    })

    it('[rule-evp-decision-replay-controls] a dossier made invalid since its declaration is not validated: 409 absences.validation_blocked with the blockages, dossier unchanged', async () => {
      const id = await seed('A_VALIDER')
      await sql('update base.payfit_contracts set end_date = $1 where id = $2', [d(-30), w.ctA.id])
      const before = await timelineLength(id)
      const res = await act('validate', id, w.rh.token)
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('absences.validation_blocked')
      expect(res.body.details.blockages.map((b: any) => b.code)).toContain('outside_contract_period')
      expect(await statusOf(id)).toBe('A_VALIDER')
      expect(await auditCount('absences:validate')).toBe(0)
      expect(await timelineLength(id)).toBe(before)
    })

    it('[rule-evp-decision-replay-controls] an overlap with another active dossier and a missing piece also block the validation', async () => {
      const first = await seed('A_VALIDER')
      await seed('A_VALIDER', { typeCode: 'AUTRE', startDate: d(-5), endDate: d(-3) })
      const overlap = await act('validate', first, w.rh.token)
      expect(overlap.status).toBe(409)
      expect(overlap.body.details.blockages.map((b: any) => b.code)).toContain('overlap_evp')
      const piece = await seed('A_VALIDER', { contractId: w.ctA2.id, typeCode: 'ENFANT_MALADE' })
      const missing = await act('validate', piece, w.rh.token)
      expect(missing.status).toBe(409)
      expect(missing.body.details.blockages.map((b: any) => b.code)).toContain('piece_missing')
    })

    it('[rule-evp-decision-replay-controls] a dossier whose crèche no longer matches the company of its contract is blocked with creche_contract_mismatch, never an HTTP error from the replay', async () => {
      const id = await seed('A_VALIDER')
      await sql("update base.creches set siret = '99999999999999' where code = 'alpha'")
      const res = await act('validate', id, w.rh.token)
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('absences.validation_blocked')
      expect(res.body.details.blockages.map((b: any) => b.code)).toContain('creche_contract_mismatch')
    })

    it('[rule-evp-audit-atomic] two simultaneous validations of the same dossier give one 200 and one 409, one audit entry, one decision', async () => {
      const id = await seed('A_VALIDER')
      const results = await Promise.all([act('validate', id, w.rh.token), act('validate', id, w.rh.token)])
      expect(results.map((r) => r.status).sort()).toEqual([200, 409])
      expect(await auditCount('absences:validate')).toBe(1)
      expect(await statusOf(id)).toBe('A_SAISIR')
    })

    it('[rule-evp-decision-marine-only] unknown dossier is 404, malformed identifier 400', async () => {
      expect((await act('validate', UNKNOWN_UUID, w.rh.token)).status).toBe(404)
      expect((await act('validate', 'not-a-uuid', w.rh.token)).status).toBe(400)
    })
  })

  // ───────────────────────────── validate-batch ─────────────────────────────
  describe('POST /absences/validate-batch', () => {
    it('[rule-evp-batch-individual-controls] a mixed batch validates the valid dossiers and reports the blocked ones, in one 200', async () => {
      const ok1 = await seed('A_VALIDER')
      const ok2 = await seed('A_VALIDER', { contractId: w.ctA2.id })
      const piece = await seed('A_VALIDER', { contractId: w.ctB.id, crecheCode: 'beta', typeCode: 'ENFANT_MALADE' })
      const waiting = await seed('A_COMPLETER', { contractId: w.ctA.id, startDate: d(-50), endDate: d(-49) })
      const log = callsLog()
      const res = await POST('/absences/validate-batch', w.rh.token, { absenceIds: [ok1, piece, ok2, waiting, UNKNOWN_UUID] })
      expect(res.status).toBe(200)
      expect(Object.keys(res.body).sort()).toEqual(['blocked', 'validated'])
      expect(res.body.validated.map((v: any) => v.id).sort()).toEqual([ok1, ok2].sort())
      expect(res.body.blocked.map((b: any) => b.id).sort()).toEqual([piece, waiting, UNKNOWN_UUID].sort())
      const blockedPiece = res.body.blocked.find((b: any) => b.id === piece)
      expect(blockedPiece.employeeName).toBe('Zoé Durand')
      expect(blockedPiece.blockages.map((b: any) => b.code)).toContain('piece_missing')
      expect(res.body.blocked.find((b: any) => b.id === UNKNOWN_UUID).blockages.map((b: any) => b.code)).toContain('absence_not_found')
      for (const b of res.body.blocked) expect(b.blockages.length).toBeGreaterThan(0)
      expect(await statusOf(ok1)).toBe('A_SAISIR')
      expect(await statusOf(ok2)).toBe('A_SAISIR')
      expect(await statusOf(piece)).toBe('A_VALIDER')
      expect(await statusOf(waiting)).toBe('A_COMPLETER')
      expect(callsLog()).toBe(log)
    })

    it('[rule-evp-batch-individual-controls] [rule-evp-audit-atomic] a batch leaves one audit entry and a timeline event for each validated dossier', async () => {
      const a = await seed('A_VALIDER')
      const b = await seed('A_VALIDER', { contractId: w.ctA2.id })
      const eventsBefore = await countRows('absence_events')
      await POST('/absences/validate-batch', w.rh.token, { absenceIds: [a, b] })
      expect(await auditCount('absences:validate')).toBe(1)
      expect(await countRows('absence_events')).toBeGreaterThanOrEqual(eventsBefore + 2)
      expect((await auditRows('absences:validate'))[0]).toMatchObject({ actor_id: w.rh.id })
    })

    it('[rule-evp-batch-individual-controls] a failure of one dossier does not roll back the others: each one has its own transaction', async () => {
      const ids: string[] = []
      for (let i = 0; i < 4; i++) ids.push(await seed('A_VALIDER', { startDate: d(-100 - i * 5), endDate: d(-100 - i * 5) }))
      await sql('update base.absences set type_code = $2 where id = $1', [ids[2], 'ENFANT_MALADE'])
      const res = await POST('/absences/validate-batch', w.rh.token, { absenceIds: ids })
      expect(res.body.validated).toHaveLength(3)
      expect(res.body.blocked.map((b: any) => b.id)).toEqual([ids[2]])
    })

    it('[rule-evp-batch-max-50] 1 to 50 distinct identifiers are accepted; 0, 51, duplicates and malformed identifiers are refused 400', async () => {
      const unknown = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`)
      const one = await POST('/absences/validate-batch', w.rh.token, { absenceIds: unknown(1) })
      expect(one.status).toBe(200)
      expect(one.body.blocked).toHaveLength(1)
      const fifty = await POST('/absences/validate-batch', w.rh.token, { absenceIds: unknown(50) })
      expect(fifty.status).toBe(200)
      expect(fifty.body.blocked).toHaveLength(50)
      for (const absenceIds of [[], unknown(51), [UNKNOWN_UUID, UNKNOWN_UUID], ['not-a-uuid'], 'abc', null]) {
        const res = await POST('/absences/validate-batch', w.rh.token, { absenceIds })
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('api.validation.incoming_failed')
      }
      expect((await POST('/absences/validate-batch', w.rh.token, {})).status).toBe(400)
    })

    it('[rule-evp-decision-marine-only] only RH may validate in batch: other roles get 403, nothing is validated', async () => {
      const id = await seed('A_VALIDER')
      for (const who of [w.dirA, w.roA, w.adm, w.sup]) expect((await POST('/absences/validate-batch', who.token, { absenceIds: [id] })).status).toBe(403)
      expect((await POST('/absences/validate-batch', undefined, { absenceIds: [id] })).status).toBe(401)
      expect(await statusOf(id)).toBe('A_VALIDER')
      expect(await auditCount('absences:validate')).toBe(0)
    })

    it('[rule-evp-list-scope] an unknown identifier is reported exactly like a dossier the caller cannot see', async () => {
      const res = await POST('/absences/validate-batch', w.rh.token, { absenceIds: [UNKNOWN_UUID] })
      expect(res.body.blocked[0]).toMatchObject({ id: UNKNOWN_UUID })
      expect(res.body.blocked[0].blockages.map((b: any) => b.code)).toEqual(['absence_not_found'])
    })
  })

  // ───────────────────────────── return and reject ─────────────────────────────
  for (const [decision, endState, auditAction] of [['return', 'A_COMPLETER', 'absences:return'], ['reject', 'REJETEE', 'absences:reject']] as const) {
    describe(`POST /absences/:id/${decision}`, () => {
      it(`[rule-evp-decision-reason-required] RH ${decision}s with an administrative reason: ${endState}, reason kept in the last decision, one audit entry`, async () => {
        const id = await seed('A_VALIDER')
        const res = await act(decision, id, w.rh.token, { reason: 'Pièce illisible' })
        expect(res.status).toBe(200)
        expect(res.body.status).toBe(endState)
        expect(res.body.lastDecision).toMatchObject({ byName: w.rh.name, reason: 'Pièce illisible' })
        expect(res.body.timeline.length).toBeGreaterThan(1)
        const entries = await auditRows(auditAction)
        expect(entries).toHaveLength(1)
        expect(entries[0]).toMatchObject({ actor_id: w.rh.id, object_type: 'Absence', object_id: id })
      })

      it('[rule-evp-decision-reason-required] a reason is mandatory and bounded 1..500: empty, missing, null, non-string and 501 characters answer 400, 500 is accepted', async () => {
        const id = await seed('A_VALIDER')
        for (const body of [{ reason: '' }, {}, { reason: null }, { reason: 12 }, { reason: 'x'.repeat(501) }, undefined]) {
          const res = await act(decision, id, w.rh.token, body)
          expect(res.status).toBe(400)
          expect(res.body.code).toBe('api.validation.incoming_failed')
        }
        expect(await statusOf(id)).toBe('A_VALIDER')
        expect(await auditCount(auditAction)).toBe(0)
        expect((await act(decision, id, w.rh.token, { reason: 'x'.repeat(500) })).status).toBe(200)
      })

      it('[rule-evp-decision-marine-only] directrice, RO, ADMINISTRATRICE and SUPERADMIN get 403, anonymous 401; the dossier is unchanged', async () => {
        const id = await seed('A_VALIDER')
        for (const who of [w.dirA, w.roA, w.adm, w.sup]) expect((await act(decision, id, who.token, { reason: 'x' })).status).toBe(403)
        expect((await act(decision, id, undefined, { reason: 'x' })).status).toBe(401)
        expect(await statusOf(id)).toBe('A_VALIDER')
      })

      it('[rule-evp-decision-marine-only] the role check precedes the validation of the body: a directrice with an empty reason gets 403, not 400', async () => {
        const id = await seed('A_VALIDER')
        expect((await act(decision, id, w.dirA.token, { reason: '' })).status).toBe(403)
      })

      it('[rule-evp-decision-reason-required] unknown dossier is 404, malformed identifier 400', async () => {
        expect((await act(decision, UNKNOWN_UUID, w.rh.token, { reason: 'x' })).status).toBe(404)
        expect((await act(decision, 'nope', w.rh.token, { reason: 'x' })).status).toBe(400)
      })
    })
  }

  describe('return then resubmission', () => {
    it('[rule-evp-decision-replay-controls] a dossier returned to the declarant is resubmitted and goes back to « À valider »', async () => {
      const id = await seed('A_VALIDER')
      expect((await act('return', id, w.rh.token, { reason: 'À corriger' })).body.status).toBe('A_COMPLETER')
      expect((await GET(`/absences/${id}`, w.dirA.token)).body.nextAction.actor).toBe('DECLARANT')
      expect((await act('submit', id, w.dirA.token)).body.status).toBe('A_VALIDER')
    })
  })

  // ───────────────────────────── cancel ─────────────────────────────
  describe('POST /absences/:id/cancel', () => {
    it.each(['A_COMPLETER', 'ANTICIPEE', 'A_VALIDER'] as const)('[rule-evp-cancel-scope] directrice, RO, RH and SUPERADMIN can cancel a %s dossier of their perimeter', async (status) => {
      for (const who of [w.dirA, w.roA, w.rh, w.sup]) {
        const day = nextDay()
        const id = await seed(status, { startDate: day, endDate: day })
        const res = await act('cancel', id, who.token, { reason: 'Saisie en double' })
        expect(res.status).toBe(200)
        expect(res.body.status).toBe('ANNULEE')
        expect(res.body.lastDecision).toMatchObject({ reason: 'Saisie en double' })
      }
      expect(await countRows('absences', "status = 'ANNULEE'")).toBe(4)
    })

    it('[rule-evp-cancel-scope] a « validée à saisir » dossier is cancelled by RH only: directrice, RO and SUPERADMIN get 409', async () => {
      const id = await seed('A_SAISIR')
      for (const who of [w.dirA, w.roA, w.sup]) {
        const res = await act('cancel', id, who.token, { reason: 'Erreur' })
        expect(res.status).toBe(409)
        expect(res.body.code).toBe('absences.decision_not_allowed')
      }
      expect(await statusOf(id)).toBe('A_SAISIR')
      expect((await act('cancel', id, w.rh.token, { reason: 'Erreur' })).body.status).toBe('ANNULEE')
    })

    it.each(['DANS_PAYFIT', 'REJETEE', 'ANNULEE'] as const)('[rule-evp-cancel-scope] a %s dossier cannot be cancelled, not even by RH', async (status) => {
      const id = await seed(status)
      for (const who of [w.rh, w.dirA]) {
        const res = await act('cancel', id, who.token, { reason: 'Erreur' })
        expect(res.status).toBe(409)
        expect(res.body.code).toBe('absences.decision_not_allowed')
      }
      expect(await statusOf(id)).toBe(status)
      expect(await auditCount('absences:cancel')).toBe(0)
    })

    it('[rule-evp-cancel-scope] [rule-evp-list-scope] a dossier outside the perimeter is 404 (as an unknown one) and stays untouched; ADMINISTRATRICE 403; anonymous 401', async () => {
      const id = await seed('A_VALIDER')
      for (const who of [w.dirB, w.roB]) {
        const foreign = await act('cancel', id, who.token, { reason: 'x' })
        const unknown = await act('cancel', UNKNOWN_UUID, who.token, { reason: 'x' })
        expect(foreign.status).toBe(404)
        expect(foreign.body).toEqual(unknown.body)
      }
      expect((await act('cancel', id, w.adm.token, { reason: 'x' })).status).toBe(403)
      expect((await act('cancel', id, undefined, { reason: 'x' })).status).toBe(401)
      expect(await statusOf(id)).toBe('A_VALIDER')
    })

    it('[rule-evp-decision-reason-required] [rule-evp-declare-no-medical-detail] the reason is mandatory 1..500; a cancellation leaves one audit entry', async () => {
      const id = await seed('A_VALIDER')
      for (const body of [{ reason: '' }, {}, { reason: 'x'.repeat(501) }, { reason: 3 }]) expect((await act('cancel', id, w.dirA.token, body)).status).toBe(400)
      expect(await statusOf(id)).toBe('A_VALIDER')
      expect((await act('cancel', id, w.dirA.token, { reason: 'x'.repeat(500) })).status).toBe(200)
      expect(await auditCount('absences:cancel')).toBe(1)
    })

    it('[rule-evp-cancel-scope] a cancelled dossier frees its dates: an identical declaration can be created again', async () => {
      const first = await createAbsence(w.dirA.token, { contractId: w.ctA.id })
      await act('cancel', first.body.id, w.dirA.token, { reason: 'Erreur de saisie' })
      const again = await createAbsence(w.dirA.token, { contractId: w.ctA.id })
      expect(again.status).toBe(201)
      expect(again.body.id).not.toBe(first.body.id)
    })
  })

  // ───────────────────────────── mark-entered ─────────────────────────────
  describe('POST /absences/:id/mark-entered', () => {
    it('[rule-evp-mark-entered-no-proof] RH declares the human entry: saisieDeclaree becomes true, the state stays A_SAISIR, still to be verified, no proof', async () => {
      const id = await seed('A_SAISIR')
      const res = await act('mark-entered', id, w.rh.token)
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ id, status: 'A_SAISIR', saisieDeclaree: true, payfitProof: null })
      expect(res.body.nextAction.actor).toBe('LECTURE_PAYFIT')
      expect(await countRows('payfit_proofs')).toBe(0)
      expect(await auditCount('absences:mark-entered')).toBe(1)
    })

    it('[rule-evp-mark-entered-no-proof] it is idempotent: a second call answers 200 and the dossier stays A_SAISIR', async () => {
      const id = await seed('A_SAISIR')
      await act('mark-entered', id, w.rh.token)
      const again = await act('mark-entered', id, w.rh.token)
      expect(again.status).toBe(200)
      expect(again.body).toMatchObject({ status: 'A_SAISIR', saisieDeclaree: true })
    })

    it('[rule-evp-decision-marine-only] directrice, RO, ADMINISTRATRICE and SUPERADMIN get 403, anonymous 401, unknown 404, malformed 400', async () => {
      const id = await seed('A_SAISIR')
      for (const who of [w.dirA, w.roA, w.adm, w.sup]) expect((await act('mark-entered', id, who.token)).status).toBe(403)
      expect((await act('mark-entered', id)).status).toBe(401)
      expect((await act('mark-entered', UNKNOWN_UUID, w.rh.token)).status).toBe(404)
      expect((await act('mark-entered', 'nope', w.rh.token)).status).toBe(400)
      expect((await absenceRow(id)).saisie_declaree).toBe(false)
    })
  })

  // ───────────────────────────── PATCH ─────────────────────────────
  describe('PATCH /absences/:id (server side only)', () => {
    it.each(['A_COMPLETER', 'ANTICIPEE', 'A_VALIDER', 'A_SAISIR'] as const)('[rule-evp-declare-edit-server] a %s dossier is editable, controls replayed, state recomputed', async (status) => {
      const id = await seed(status, { saisieDeclaree: status === 'A_SAISIR' })
      const res = await PATCH(`/absences/${id}`, w.dirA.token, { comment: 'Précision administrative' })
      expect(res.status).toBe(200)
      expect(res.body.comment).toBe('Précision administrative')
      expect(res.body.status).toBe('A_VALIDER')
      expect(res.body.saisieDeclaree).toBe(false)
    })

    it.each(['DANS_PAYFIT', 'REJETEE', 'ANNULEE'] as const)('[rule-evp-declare-edit-server] a %s dossier is not editable: 409 absences.decision_not_allowed, dossier unchanged', async (status) => {
      const id = await seed(status)
      const before = await absenceRow(id)
      const res = await PATCH(`/absences/${id}`, w.dirA.token, { comment: 'Nouveau' })
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('absences.decision_not_allowed')
      expect((await absenceRow(id)).comment).toBe(before.comment)
      expect(await auditCount('absences:update')).toBe(0)
    })

    it('[rule-evp-declare-edit-server] a modified type or period replays every control: a piece-requiring type drops to « À compléter », a future start becomes « Anticipée »', async () => {
      const created = await createAbsence(w.dirA.token, { contractId: w.ctA.id })
      expect(created.body.status).toBe('A_VALIDER')
      const typed = await PATCH(`/absences/${created.body.id}`, w.dirA.token, { typeCode: 'ENFANT_MALADE' })
      expect(typed.status).toBe(200)
      expect(typed.body.status).toBe('A_COMPLETER')
      expect(typed.body.blockages.map((b: any) => b.code)).toContain('piece_missing')
      const back = await PATCH(`/absences/${created.body.id}`, w.dirA.token, { typeCode: 'CONGES_PAYES', startDate: d(10), endDate: d(11) })
      expect(back.body.status).toBe('ANTICIPEE')
      expect(back.body).toMatchObject({ startDate: d(10), endDate: d(11), typeCode: 'CONGES_PAYES' })
    })

    it('[rule-evp-declare-edit-server] correcting a period that overlapped another dossier clears the blockage', async () => {
      await createAbsence(w.dirA.token, { contractId: w.ctA.id, startDate: d(-6), endDate: d(-4) })
      const second = await createAbsence(w.dirA.token, { contractId: w.ctA.id, startDate: d(-5), endDate: d(-3) })
      expect(second.body.status).toBe('A_COMPLETER')
      const fixed = await PATCH(`/absences/${second.body.id}`, w.dirA.token, { startDate: d(-3), endDate: d(-3), startHalf: 'MATIN', endHalf: 'APRES_MIDI' })
      expect(fixed.status).toBe(200)
      expect(fixed.body.status).toBe('A_VALIDER')
      expect(fixed.body.blockages).toEqual([])
    })

    it('[rule-evp-declare-edit-server] a modification of a « validée à saisir » dossier sends it back to « À valider » and resets the declared entry', async () => {
      const id = await seed('A_SAISIR', { saisieDeclaree: true })
      const res = await PATCH(`/absences/${id}`, w.rh.token, { endDate: d(-3) })
      expect(res.body.status).toBe('A_VALIDER')
      expect(res.body.saisieDeclaree).toBe(false)
      expect(res.body.nextAction.actor).toBe('RH')
    })

    it('[rule-evp-declare-comment-bound] the comment can be cleared with null; 500 characters accepted, 501 and null characters refused', async () => {
      const id = await seed('A_VALIDER', { comment: 'avant' })
      expect((await PATCH(`/absences/${id}`, w.dirA.token, { comment: null })).body.comment).toBeNull()
      expect((await PATCH(`/absences/${id}`, w.dirA.token, { comment: 'x'.repeat(500) })).status).toBe(200)
      for (const comment of ['x'.repeat(501), 'a\u0000b', 7]) expect((await PATCH(`/absences/${id}`, w.dirA.token, { comment })).status).toBe(400)
    })

    it('[rule-evp-declare-edit-server] [rule-evp-declare-half-day-order] an empty body, an unknown key, the crèche, the contract or the state are refused 400 and nothing changes', async () => {
      const id = await seed('A_VALIDER')
      const before = await absenceRow(id)
      for (const body of [
        {}, { unknown: 1 }, { crecheCode: 'beta' }, { contractId: w.ctA2.id }, { status: 'A_SAISIR' }, { saisieDeclaree: true }, { typeCode: 'INCONNU' },
        { startDate: '2026-02-30' }, { startHalf: 'MIDI' }, { endDate: 'demain' }, { justificatifIds: [] },
      ]) {
        const res = await PATCH(`/absences/${id}`, w.dirA.token, body)
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('api.validation.incoming_failed')
      }
      const after = await absenceRow(id)
      expect(after.creche_code).toBe(before.creche_code)
      expect(after.contract_id).toBe(before.contract_id)
      expect(after.status).toBe(before.status)
    })

    it('[rule-evp-declare-half-day-order] a period whose end precedes its start is refused (400 api.validation.incoming_failed) and nothing changes', async () => {
      const id = await seed('A_VALIDER', { startDate: d(-10), endDate: d(-10), startHalf: 'APRES_MIDI', endHalf: 'APRES_MIDI' })
      const res = await PATCH(`/absences/${id}`, w.dirA.token, { startDate: d(-9), endDate: d(-12) })
      expect(res.status).toBe(400)
      const same = await PATCH(`/absences/${id}`, w.dirA.token, { endHalf: 'MATIN' })
      expect([400, 409, 422]).toContain(same.status)
      const row = await absenceRow(id)
      expect(row.start_half).toBe('APRES_MIDI')
      expect(row.end_half).toBe('APRES_MIDI')
    })

    it('[rule-evp-declare-duplicate] a modification that would duplicate another active dossier is refused 409 absences.duplicate_active and leaves the dossier unchanged', async () => {
      await seed('A_VALIDER', { startDate: d(-6), endDate: d(-4) })
      const other = await seed('A_VALIDER', { startDate: d(-30), endDate: d(-28) })
      const res = await PATCH(`/absences/${other}`, w.dirA.token, { startDate: d(-6), endDate: d(-4) })
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('absences.duplicate_active')
      expect((await sql('select start_date::text as s from base.absences where id = $1', [other]))[0].s).toBe(d(-30))
    })

    it('[rule-evp-declare-roles] ADMINISTRATRICE gets 403; another crèche’s declarant 404 (as unknown); anonymous 401; RO, RH and SUPERADMIN can edit', async () => {
      const id = await seed('A_VALIDER')
      expect((await PATCH(`/absences/${id}`, w.adm.token, { comment: 'x' })).status).toBe(403)
      const foreign = await PATCH(`/absences/${id}`, w.dirB.token, { comment: 'x' })
      const unknown = await PATCH(`/absences/${UNKNOWN_UUID}`, w.dirB.token, { comment: 'x' })
      expect(foreign.status).toBe(404)
      expect(foreign.body).toEqual(unknown.body)
      expect((await PATCH(`/absences/${id}`, undefined, { comment: 'x' })).status).toBe(401)
      for (const who of [w.roA, w.rh, w.sup]) expect((await PATCH(`/absences/${id}`, who.token, { comment: 'ok' })).status).toBe(200)
      expect((await PATCH('/absences/nope', w.rh.token, { comment: 'x' })).status).toBe(400)
    })

    it('[rule-evp-declare-no-medical-detail] [rule-evp-audit-atomic] an edit leaves one audit entry and one timeline event, none of them carrying the comment or the new values', async () => {
      const id = await seed('A_VALIDER')
      const before = await timelineLength(id)
      const secret = 'ORDONNANCE-SECRETE-777'
      const res = await PATCH(`/absences/${id}`, w.dirA.token, { comment: secret, endDate: d(-2) })
      expect(res.status).toBe(200)
      const entries = await auditRows('absences:update')
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ actor_id: w.dirA.id, object_type: 'Absence', object_id: id })
      expect(entries[0].summary).not.toContain(secret)
      expect(entries[0].summary).not.toContain(d(-2))
      expect(await timelineLength(id)).toBe(before + 1)
      expect(JSON.stringify(res.body.timeline)).not.toContain(secret)
      expect(JSON.stringify(await sql('select e::text as t from base.absence_events e'))).not.toContain(secret)
    })

    it('[rule-evp-declare-checks] an edit that leaves the contract period is a blockage, not an error', async () => {
      const ended = await seedContract('co-a', 'ct-ended', 'Ina', 'Terminée', '2020-01-01', d(-20))
      const id = await seed('A_VALIDER', { contractId: ended.id, startDate: d(-40), endDate: d(-38) })
      const res = await PATCH(`/absences/${id}`, w.dirA.token, { startDate: d(-10), endDate: d(-9) })
      expect(res.status).toBe(200)
      expect(res.body.status).toBe('A_COMPLETER')
      expect(res.body.blockages.map((b: any) => b.code)).toContain('outside_contract_period')
    })
  })

  describe('write routes and transport', () => {
    it('[rule-evp-audit-atomic] no decision route accepts GET or DELETE: unknown route 404', async () => {
      const id = await seed('A_VALIDER')
      for (const path of ['validate', 'return', 'reject', 'cancel', 'submit', 'mark-entered']) {
        expect((await http('GET', `/absences/${id}/${path}`, { token: w.rh.token })).status).toBe(404)
      }
      expect((await http('DELETE', `/absences/${id}`, { token: w.rh.token })).status).toBe(404)
      expect(await countRows('absences')).toBe(1)
    })
  })
})
