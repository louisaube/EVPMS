import { resetData, closePool, sql } from './harness'
import { logSince, logSize } from './renfort-helpers'
import {
  http, GET, POST, qs, UNKNOWN_UUID, seedWorld, seedAbsence, seedContract, createAbsence, absenceBody, uploadPiece, authorizeUpload, World,
  auditRows, auditCount, countRows, addDays, todayParis, sortedKeys, closeEvp, ALL_STATUSES, Status, TYPES,
} from './evp-helpers'

const t = () => todayParis()
const d = (n: number) => addDays(todayParis(), n)

const SUMMARY_KEYS = [
  'blockages', 'contractLabel', 'createdAt', 'crecheCode', 'crecheName', 'employeeName', 'endDate', 'endHalf', 'id', 'nextAction',
  'payrollMonth', 'saisieDeclaree', 'selectable', 'startDate', 'startHalf', 'status', 'typeCode', 'typeLabel',
]
const DETAIL_KEYS = [
  ...SUMMARY_KEYS, 'allowedActions', 'comment', 'declaredAt', 'declaredBy', 'employee', 'expectedPiece', 'lastDecision', 'payfitAlert',
  'payfitCode', 'payfitProof', 'pieces', 'progress', 'timeline',
].sort()

// Acceptance suite of version v1-evp: absence types, declaration, controls, list, detail, "À faire".
describe('EVP absences: types, declaration, list, detail, todo', () => {
  let w: World

  beforeEach(async () => {
    await resetData()
    w = await seedWorld()
  })
  afterAll(async () => {
    await closeEvp()
    await closePool()
  })

  // ───────────────────────────── GET /absence-types ─────────────────────────────
  describe('GET /absence-types', () => {
    it('[rule-evp-declare-types-defaults] every EVP account reads the 9 types with expected piece, private flag and HR review', async () => {
      for (const a of [w.dirA, w.roA, w.rh, w.adm, w.sup]) {
        const res = await GET('/absence-types', a.token)
        expect(res.status).toBe(200)
        expect(res.body.items).toHaveLength(9)
        for (const i of res.body.items) expect(sortedKeys(i)).toEqual(['code', 'expectedPiece', 'hrReview', 'label', 'privatePiece'])
      }
      const items = (await GET('/absence-types', w.rh.token)).body.items
      const by = (code: string) => items.find((i: any) => i.code === code)
      expect(by('CONGES_PAYES')).toMatchObject({ label: 'Congés payés', expectedPiece: null, privatePiece: false, hrReview: false })
      expect(by('ARRET_MALADIE')).toMatchObject({ expectedPiece: "Avis d'arrêt", privatePiece: true })
      expect(by('SANS_SOLDE')).toMatchObject({ expectedPiece: 'Accord écrit', hrReview: true })
      expect(by('ENFANT_MALADE')).toMatchObject({ expectedPiece: 'Certificat', hrReview: false })
      expect(by('ACCIDENT_TRAVAIL')).toMatchObject({ expectedPiece: 'Certificat et déclaration', hrReview: true })
      expect(by('RECUPERATION')).toMatchObject({ expectedPiece: 'Heures validées', hrReview: true })
      expect(by('SANS_JUSTIFICATIF')).toMatchObject({ expectedPiece: null, hrReview: true })
      expect(by('EVENEMENT_FAMILIAL')).toMatchObject({ expectedPiece: 'Acte' })
      expect(by('AUTRE')).toMatchObject({ expectedPiece: null, hrReview: true })
    })

    it('[rule-evp-declare-types-defaults] the contract declares exactly 9 absence type codes for a declaration', async () => {
      const doc = (await http('GET', '/api-json')).body
      const resolve = (n: any): any => (n && n.$ref ? resolve(n.$ref.replace('#/', '').split('/').reduce((o: any, k: string) => o[k], doc)) : n)
      const schema = resolve(doc.paths['/absences'].post.requestBody.content['application/json'].schema)
      const typeCode = resolve(schema.properties.typeCode)
      expect(typeCode.enum).toHaveLength(9)
      for (const t of TYPES) expect(typeCode.enum).toContain(t.code)
    })

    it('[rule-evp-declare-types-defaults] there is no route to edit the types: 404 for POST, PUT, PATCH, DELETE', async () => {
      for (const m of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
        expect((await http(m, '/absence-types', { token: w.sup.token, body: { code: 'X', label: 'x' } })).status).toBe(404)
        expect((await http(m, '/absence-types/AUTRE', { token: w.sup.token, body: { label: 'x' } })).status).toBe(404)
      }
      expect(await countRows('absence_types')).toBe(9)
    })

    it('[rule-evp-declare-types-defaults] anonymous gets 401', async () => {
      expect((await GET('/absence-types')).status).toBe(401)
    })
  })

  // ───────────────────────────── POST /absences ─────────────────────────────
  describe('POST /absences', () => {
    it.each(['dirA', 'roA', 'rh', 'sup'] as const)('[rule-evp-declare-steps] [rule-evp-declare-roles] %s declares an absence: 201 with the full dossier, « À valider »', async (who) => {
      const res = await createAbsence(w[who].token, { contractId: w.ctA.id })
      expect(res.status).toBe(201)
      expect(sortedKeys(res.body)).toEqual(DETAIL_KEYS)
      expect(res.body).toMatchObject({
        crecheCode: 'alpha', crecheName: 'Crèche Alpha', employeeName: 'Léa Martin', typeCode: 'CONGES_PAYES', typeLabel: 'Congés payés',
        startDate: d(-6), startHalf: 'MATIN', endDate: d(-4), endHalf: 'APRES_MIDI', status: 'A_VALIDER', saisieDeclaree: false,
        blockages: [], payfitCode: 'CP', declaredBy: w[who].name, payfitAlert: null, payfitProof: null, lastDecision: null, pieces: [],
      })
      expect(res.body.employee).toMatchObject({ contractId: w.ctA.id, payfitContractId: 'ct-a1', companyName: 'Société A' })
      expect(res.body.nextAction).toMatchObject({ actor: 'RH' })
      expect(res.body.progress.total).toBe(5)
      expect(res.body.progress.step).toBeGreaterThanOrEqual(1)
      expect(res.body.progress.step).toBeLessThanOrEqual(5)
      expect(res.body.timeline.length).toBeGreaterThanOrEqual(1)
      expect(res.body.timeline[0]).toMatchObject({ byName: w[who].name })
      expect((await sql('select declared_by, status from base.absences where id = $1', [res.body.id]))[0]).toEqual({ declared_by: w[who].id, status: 'A_VALIDER' })
    })

    it('[rule-evp-declare-roles] ADMINISTRATRICE gets 403 and nothing is written, anonymous gets 401', async () => {
      const res = await createAbsence(w.adm.token, { contractId: w.ctA.id })
      expect(res.status).toBe(403)
      expect(await countRows('absences')).toBe(0)
      expect((await POST('/absences', undefined, absenceBody({ contractId: w.ctA.id }))).status).toBe(401)
    })

    it('[rule-evp-creche-scope] [rule-evp-declare-steps] a declarant cannot declare in a crèche outside her perimeter: 403, nothing written', async () => {
      expect((await createAbsence(w.dirA.token, { crecheCode: 'beta', contractId: w.ctB.id })).status).toBe(403)
      expect((await createAbsence(w.roA.token, { crecheCode: 'beta', contractId: w.ctB.id })).status).toBe(403)
      expect(await countRows('absences')).toBe(0)
      expect((await createAbsence(w.rh.token, { crecheCode: 'beta', contractId: w.ctB.id })).status).toBe(201)
      expect((await createAbsence(w.sup.token, { crecheCode: 'beta', contractId: w.ctB.id, startDate: d(-30), endDate: d(-29) })).status).toBe(201)
    })

    it('[rule-evp-declare-checks] [rule-evp-declare-employee-key] a contract of another company than the crèche’s is refused 409 absences.creche_contract_mismatch, in both directions', async () => {
      const a = await createAbsence(w.dirA.token, { crecheCode: 'alpha', contractId: w.ctB.id })
      expect(a.status).toBe(409)
      expect(a.body.code).toBe('absences.creche_contract_mismatch')
      const b = await createAbsence(w.rh.token, { crecheCode: 'beta', contractId: w.ctA.id })
      expect(b.status).toBe(409)
      expect(b.body.code).toBe('absences.creche_contract_mismatch')
      expect(await countRows('absences')).toBe(0)
    })

    it('[rule-evp-declare-steps] an unknown contract is 404 absences.contract_not_found', async () => {
      const res = await createAbsence(w.dirA.token, { contractId: UNKNOWN_UUID })
      expect(res.status).toBe(404)
      expect(res.body.code).toBe('absences.contract_not_found')
    })

    it('[rule-evp-declare-result-status] a start date after today (Europe/Paris) gives « Anticipée »; today and the past give « À valider »', async () => {
      const future = await createAbsence(w.dirA.token, { contractId: w.ctA.id, startDate: d(5), endDate: d(6) })
      expect(future.status).toBe(201)
      expect(future.body.status).toBe('ANTICIPEE')
      expect(future.body.nextAction.actor).toBe('DECLARANT')
      const tomorrow = await createAbsence(w.dirA.token, { contractId: w.ctA2.id, startDate: d(1), endDate: d(1) })
      expect(tomorrow.body.status).toBe('ANTICIPEE')
      const today = await createAbsence(w.dirA.token, { contractId: w.ctA.id, startDate: t(), endDate: t(), startHalf: 'MATIN', endHalf: 'APRES_MIDI' })
      expect(today.body.status).toBe('A_VALIDER')
      const past = await createAbsence(w.dirA.token, { contractId: w.ctA.id, startDate: d(-60), endDate: d(-58) })
      expect(past.body.status).toBe('A_VALIDER')
    })

    it('[rule-evp-declare-result-status] a blocking control gives « À compléter » even when the start date is in the future', async () => {
      await createAbsence(w.dirA.token, { contractId: w.ctA.id, startDate: d(5), endDate: d(8) })
      const res = await createAbsence(w.dirA.token, { contractId: w.ctA.id, startDate: d(6), endDate: d(9) })
      expect(res.status).toBe(201)
      expect(res.body.status).toBe('A_COMPLETER')
    })

    it('[rule-evp-declare-checks] [rule-evp-declare-overlap-blocks] an overlap with another active EVP dossier of the same contract is a blockage, not an HTTP error', async () => {
      const first = await createAbsence(w.dirA.token, { contractId: w.ctA.id, startDate: d(-6), endDate: d(-4) })
      const second = await createAbsence(w.dirA.token, { contractId: w.ctA.id, startDate: d(-5), endDate: d(-3) })
      expect(second.status).toBe(201)
      expect(second.body.status).toBe('A_COMPLETER')
      expect(second.body.blockages.map((b: any) => b.code)).toContain('overlap_evp')
      expect(second.body.nextAction.actor).toBe('DECLARANT')
      for (const b of second.body.blockages) expect(typeof b.message).toBe('string')
      expect((await GET(`/absences/${first.body.id}`, w.dirA.token)).body.status).toBe('A_VALIDER')
    })

    it('[rule-evp-declare-overlap-blocks] other contracts, rejected or cancelled dossiers never overlap', async () => {
      await createAbsence(w.dirA.token, { contractId: w.ctA2.id })
      await seedAbsence({ contractId: w.ctA.id, declaredBy: w.rh.id, status: 'REJETEE', startDate: d(-6), endDate: d(-4) })
      await seedAbsence({ contractId: w.ctA.id, declaredBy: w.rh.id, status: 'ANNULEE', startDate: d(-6), endDate: d(-4), typeCode: 'AUTRE' })
      const res = await createAbsence(w.dirA.token, { contractId: w.ctA.id })
      expect(res.status).toBe(201)
      expect(res.body.status).toBe('A_VALIDER')
      expect(res.body.blockages).toEqual([])
    })

    it('[rule-evp-declare-overlap-blocks] [rule-evp-declare-half-day-order] adjacent half-days do not overlap: a morning and an afternoon of the same day, or an end in the afternoon and a start next morning', async () => {
      const morning = await createAbsence(w.dirA.token, { contractId: w.ctA.id, startDate: d(-10), endDate: d(-10), startHalf: 'MATIN', endHalf: 'MATIN' })
      expect(morning.body.status).toBe('A_VALIDER')
      const afternoon = await createAbsence(w.dirA.token, { contractId: w.ctA.id, startDate: d(-10), endDate: d(-10), startHalf: 'APRES_MIDI', endHalf: 'APRES_MIDI' })
      expect(afternoon.status).toBe(201)
      expect(afternoon.body.status).toBe('A_VALIDER')
      const nextDay = await createAbsence(w.dirA.token, { contractId: w.ctA.id, startDate: d(-9), endDate: d(-8), startHalf: 'MATIN', endHalf: 'APRES_MIDI' })
      expect(nextDay.body.status).toBe('A_VALIDER')
      const clash = await createAbsence(w.dirA.token, { contractId: w.ctA.id, startDate: d(-10), endDate: d(-9), startHalf: 'MATIN', endHalf: 'MATIN' })
      expect(clash.body.status).toBe('A_COMPLETER')
    })

    it('[rule-evp-declare-checks] a period outside the contract period is a blockage outside_contract_period (before the start, after the end, or straddling)', async () => {
      const ended = await seedContract('co-a', 'ct-ended', 'Ina', 'Terminée', '2020-01-01', d(-20))
      const later = await seedContract('co-a', 'ct-later', 'Lou', 'Tardive', d(-3), null)
      for (const [contractId, start, end] of [
        [ended.id, d(-10), d(-8)], [ended.id, d(-22), d(-18)], [later.id, d(-6), d(-4)], [later.id, d(-5), d(-2)],
      ] as const) {
        const res = await createAbsence(w.rh.token, { contractId, startDate: start, endDate: end })
        expect(res.status).toBe(201)
        expect(res.body.status).toBe('A_COMPLETER')
        expect(res.body.blockages.map((b: any) => b.code)).toContain('outside_contract_period')
      }
      const inside = await createAbsence(w.rh.token, { contractId: ended.id, startDate: d(-40), endDate: d(-38) })
      expect(inside.body.status).toBe('A_VALIDER')
    })

    it.each(['ARRET_MALADIE', 'SANS_SOLDE', 'ENFANT_MALADE', 'ACCIDENT_TRAVAIL', 'RECUPERATION', 'EVENEMENT_FAMILIAL'])(
      '[rule-evp-declare-checks] type %s requires a confirmed piece: without it the dossier is « À compléter » with piece_missing',
      async (typeCode) => {
        const res = await createAbsence(w.dirA.token, { contractId: w.ctA.id, typeCode })
        expect(res.status).toBe(201)
        expect(res.body.status).toBe('A_COMPLETER')
        expect(res.body.blockages.map((b: any) => b.code)).toContain('piece_missing')
        expect(res.body.expectedPiece).toBeTruthy()
        expect(res.body.nextAction.actor).toBe('DECLARANT')
      },
    )

    it.each(['CONGES_PAYES', 'SANS_JUSTIFICATIF', 'AUTRE'])('[rule-evp-declare-checks] type %s requires no piece: « À valider » without piece', async (typeCode) => {
      const res = await createAbsence(w.dirA.token, { contractId: w.ctA.id, typeCode })
      expect(res.body.status).toBe('A_VALIDER')
      expect(res.body.expectedPiece).toBeNull()
    })

    it('[rule-evp-declare-checks] [rule-evp-attach-attached-on-confirm] a confirmed piece attached at declaration removes piece_missing and appears in the dossier', async () => {
      const piece = await uploadPiece(w.dirA.token, { fileName: 'certificat-enfant.pdf' })
      const res = await createAbsence(w.dirA.token, { contractId: w.ctA.id, typeCode: 'ENFANT_MALADE', justificatifIds: [piece.id] })
      expect(res.status).toBe(201)
      expect(res.body.status).toBe('A_VALIDER')
      expect(res.body.pieces).toHaveLength(1)
      expect(res.body.pieces[0]).toMatchObject({ id: piece.id, name: 'certificat-enfant.pdf', sizeBytes: piece.bytes.length, confirmed: true, addedByName: w.dirA.name })
      expect(res.body.pieces[0].canOpen).toBe(true)
      expect((await sql('select absence_id, attached_at from base.absence_pieces where id = $1', [piece.id]))[0].absence_id).toBe(res.body.id)
    })

    it('[rule-evp-declare-steps] a piece uploaded by a colleague with capacity on the crèche can be attached', async () => {
      const piece = await uploadPiece(w.roA.token)
      const res = await createAbsence(w.dirA.token, { contractId: w.ctA.id, typeCode: 'ENFANT_MALADE', justificatifIds: [piece.id] })
      expect(res.status).toBe(201)
      expect(res.body.pieces).toHaveLength(1)
    })

    it('[rule-evp-declare-steps] a piece that is unknown, not confirmed, already attached or from another crèche is refused 409 absences.piece_not_attachable, with a single indistinguishable code', async () => {
      const authorizedOnly = await authorizeUpload(w.dirA.token, { sizeBytes: 100 })
      const attachedElsewhere = await uploadPiece(w.dirA.token)
      expect((await createAbsence(w.dirA.token, { contractId: w.ctA.id, typeCode: 'ENFANT_MALADE', startDate: d(-60), endDate: d(-59), justificatifIds: [attachedElsewhere.id] })).status).toBe(201)
      const otherCreche = await uploadPiece(w.dirB.token, { crecheCode: 'beta' })
      const codes = new Set<string>()
      for (const id of [UNKNOWN_UUID, authorizedOnly.body.id, attachedElsewhere.id, otherCreche.id]) {
        const res = await createAbsence(w.rh.token, { contractId: w.ctA.id, typeCode: 'ENFANT_MALADE', justificatifIds: [id] })
        expect(res.status).toBe(409)
        codes.add(res.body.code)
      }
      expect([...codes]).toEqual(['absences.piece_not_attachable'])
      expect(await countRows('absences')).toBe(1)
    })

    it('[rule-evp-declare-max-pieces] 5 pieces are accepted, 6 or repeated identifiers are refused 400', async () => {
      const ids: string[] = []
      for (let i = 0; i < 6; i++) ids.push((await uploadPiece(w.dirA.token)).id)
      const six = await createAbsence(w.dirA.token, { contractId: w.ctA.id, justificatifIds: ids })
      expect(six.status).toBe(400)
      expect(six.body.code).toBe('api.validation.incoming_failed')
      const dup = await createAbsence(w.dirA.token, { contractId: w.ctA.id, justificatifIds: [ids[0], ids[0]] })
      expect(dup.status).toBe(400)
      const five = await createAbsence(w.dirA.token, { contractId: w.ctA.id, justificatifIds: ids.slice(0, 5) })
      expect(five.status).toBe(201)
      expect(five.body.pieces).toHaveLength(5)
    })

    it('[rule-evp-declare-duplicate] an exact active duplicate is returned with 200 { duplicate: true, absence }, never recreated, even by another declarant', async () => {
      const first = await createAbsence(w.dirA.token, { contractId: w.ctA.id })
      expect(first.status).toBe(201)
      for (const who of [w.dirA, w.roA, w.rh]) {
        const again = await createAbsence(who.token, { contractId: w.ctA.id })
        expect(again.status).toBe(200)
        expect(again.body.duplicate).toBe(true)
        expect(again.body.absence.id).toBe(first.body.id)
        expect(sortedKeys(again.body.absence)).toEqual(DETAIL_KEYS)
      }
      expect(await countRows('absences')).toBe(1)
      expect((await GET(`/absences/${first.body.id}`, w.rh.token)).body.timeline).toHaveLength(first.body.timeline.length)
    })

    it('[rule-evp-declare-duplicate] two concurrent identical declarations give one 201 and one 200 duplicate, one row', async () => {
      const results = await Promise.all([1, 2].map(() => createAbsence(w.dirA.token, { contractId: w.ctA.id })))
      expect(results.map((r) => r.status).sort()).toEqual([200, 201])
      expect(await countRows('absences')).toBe(1)
    })

    it.each(['A_COMPLETER', 'ANTICIPEE', 'A_VALIDER', 'A_SAISIR', 'DANS_PAYFIT'] as const)('[rule-evp-declare-duplicate] an existing %s dossier is an active duplicate', async (status) => {
      const id = await seedAbsence({ contractId: w.ctA.id, declaredBy: w.rh.id, status, startDate: d(-6), endDate: d(-4) })
      const res = await createAbsence(w.dirA.token, { contractId: w.ctA.id })
      expect(res.status).toBe(200)
      expect(res.body.absence.id).toBe(id)
    })

    it.each(['REJETEE', 'ANNULEE'] as const)('[rule-evp-declare-duplicate] a %s dossier is not an active duplicate: the declaration is created', async (status) => {
      await seedAbsence({ contractId: w.ctA.id, declaredBy: w.rh.id, status, startDate: d(-6), endDate: d(-4) })
      const res = await createAbsence(w.dirA.token, { contractId: w.ctA.id })
      expect(res.status).toBe(201)
      expect(await countRows('absences')).toBe(2)
    })

    it('[rule-evp-declare-duplicate] a different type, half-day or date is not a duplicate', async () => {
      await createAbsence(w.dirA.token, { contractId: w.ctA.id })
      for (const over of [{ typeCode: 'AUTRE' }, { startHalf: 'APRES_MIDI' }, { endHalf: 'MATIN' }, { endDate: d(-3) }, { startDate: d(-7) }] as const) {
        const res = await createAbsence(w.dirA.token, { contractId: w.ctA.id, ...(over as any) })
        expect(res.status).toBe(201)
        await sql("update base.absences set status = 'ANNULEE' where id = $1", [res.body.id])
      }
    })

    it('[rule-evp-declare-half-day-order] the end cannot precede the start, half-day included', async () => {
      const bad = [
        { startDate: d(-4), endDate: d(-6) },
        { startDate: d(-4), endDate: d(-4), startHalf: 'APRES_MIDI', endHalf: 'MATIN' },
      ]
      for (const over of bad) {
        const res = await createAbsence(w.dirA.token, { contractId: w.ctA.id, ...(over as any) })
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('api.validation.incoming_failed')
      }
      for (const over of [
        { startDate: d(-4), endDate: d(-4), startHalf: 'MATIN', endHalf: 'MATIN' },
        { startDate: d(-4), endDate: d(-4), startHalf: 'APRES_MIDI', endHalf: 'APRES_MIDI' },
        { startDate: d(-4), endDate: d(-4), startHalf: 'MATIN', endHalf: 'APRES_MIDI' },
        { startDate: d(-4), endDate: d(-3), startHalf: 'APRES_MIDI', endHalf: 'MATIN' },
      ]) {
        const res = await createAbsence(w.rh.token, { contractId: w.ctA.id, ...(over as any) })
        expect(res.status).toBe(201)
        await sql("update base.absences set status = 'ANNULEE'")
      }
    })

    it('[rule-evp-declare-comment-bound] a comment of 500 characters is accepted, 501 is refused, a null character is refused', async () => {
      expect((await createAbsence(w.dirA.token, { contractId: w.ctA.id, comment: 'x'.repeat(500) })).status).toBe(201)
      for (const comment of ['x'.repeat(501), 'abc\u0000def']) {
        const res = await createAbsence(w.dirA.token, { contractId: w.ctA2.id, comment })
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('api.validation.incoming_failed')
      }
      expect(await countRows('absences')).toBe(1)
    })

    it('[rule-evp-declare-steps] bodies out of bounds answer 400 api.validation.incoming_failed and write nothing', async () => {
      const bad: Array<Record<string, unknown>> = [
        { crecheCode: '' }, { crecheCode: 'x'.repeat(21) }, { contractId: 'not-a-uuid' }, { typeCode: 'INCONNU' }, { typeCode: '' },
        { startDate: '2026-02-30' }, { startDate: '05/01/2026' }, { startDate: 'demain' }, { endDate: '2026-13-01' }, { startHalf: 'MIDI' },
        { endHalf: 'soir' }, { comment: 12 }, { justificatifIds: 'abc' }, { justificatifIds: ['not-a-uuid'] }, { startDate: null },
      ]
      for (const over of bad) {
        const res = await createAbsence(w.dirA.token, { contractId: w.ctA.id, ...(over as any) })
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('api.validation.incoming_failed')
        expect(Array.isArray(res.body.details)).toBe(true)
      }
      for (const missing of ['crecheCode', 'contractId', 'typeCode', 'startDate', 'startHalf', 'endDate', 'endHalf']) {
        const body: any = absenceBody({ contractId: w.ctA.id })
        delete body[missing]
        expect((await POST('/absences', w.dirA.token, body)).status).toBe(400)
      }
      expect((await http('POST', '/absences', { token: w.dirA.token, rawBody: '{"crecheCode":' })).status).toBe(400)
      expect(await countRows('absences')).toBe(0)
    })

    it('[rule-evp-payfit-no-manual-confirm] a declaration cannot set its own state: a status field is ignored or refused, never DANS_PAYFIT', async () => {
      const res = await POST('/absences', w.rh.token, { ...absenceBody({ contractId: w.ctA.id }), status: 'DANS_PAYFIT', saisieDeclaree: true })
      expect([201, 400]).toContain(res.status)
      if (res.status === 201) {
        expect(res.body.status).toBe('A_VALIDER')
        expect(res.body.saisieDeclaree).toBe(false)
      }
      expect(await countRows('absences', "status = 'DANS_PAYFIT'")).toBe(0)
    })

    it('[rule-evp-audit-atomic] a declaration leaves exactly one audit entry (Absence, id of the dossier); a refused one leaves none', async () => {
      const res = await createAbsence(w.dirA.token, { contractId: w.ctA.id })
      const entries = await auditRows('absences:create')
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ actor_id: w.dirA.id, object_type: 'Absence', object_id: res.body.id, scope_code: 'alpha' })
      await createAbsence(w.dirA.token, { contractId: w.ctB.id })
      await createAbsence(w.adm.token, { contractId: w.ctA.id })
      await createAbsence(w.dirA.token, { contractId: w.ctA.id, comment: 'x'.repeat(501) })
      expect(await auditCount('absences:create')).toBe(1)
    })

    it('[rule-evp-declare-no-medical-detail] the comment never reaches the audit summaries, the timeline, the journal, the notifications or the server log', async () => {
      const secret = 'DIAGNOSTIC-CONFIDENTIEL-4242'
      const offset = logSize()
      const res = await createAbsence(w.dirA.token, { contractId: w.ctA.id, comment: secret })
      expect(res.status).toBe(201)
      expect(res.body.comment).toBe(secret)
      expect(JSON.stringify((await sql('select summary from base.audit_logs')))).not.toContain(secret)
      expect(JSON.stringify(await sql('select e::text as t from base.absence_events e'))).not.toContain(secret)
      expect(JSON.stringify(res.body.timeline)).not.toContain(secret)
      expect((await GET('/journal-entries?size=50', w.rh.token)).text).not.toContain(secret)
      expect((await GET(`/absences/${res.body.id}/audit`, w.rh.token)).text).not.toContain(secret)
      expect((await GET('/notifications', w.rh.token)).text).not.toContain(secret)
      expect(logSince(offset)).not.toContain(secret)
    })
  })

  // ───────────────────────────── GET /absences ─────────────────────────────
  describe('GET /absences', () => {
    async function seedTwoCreches() {
      const a1 = await seedAbsence({ contractId: w.ctA.id, declaredBy: w.rh.id, startDate: d(-30), endDate: d(-28) })
      const b1 = await seedAbsence({ contractId: w.ctB.id, crecheCode: 'beta', declaredBy: w.rh.id, startDate: d(-30), endDate: d(-28) })
      return { a1, b1 }
    }

    it('[rule-evp-list-scope] a directrice and a RO see only their crèche; global roles see all', async () => {
      const { a1, b1 } = await seedTwoCreches()
      const ids = async (a: { token: string }) => (await GET('/absences', a.token)).body.items.map((i: any) => i.id).sort()
      expect(await ids(w.dirA)).toEqual([a1])
      expect(await ids(w.roA)).toEqual([a1])
      expect(await ids(w.dirB)).toEqual([b1])
      expect(await ids(w.roB)).toEqual([b1])
      for (const a of [w.rh, w.adm, w.sup]) expect(await ids(a)).toEqual([a1, b1].sort())
    })

    it('[rule-evp-list-scope] the crecheCode filter cannot widen the perimeter', async () => {
      await seedTwoCreches()
      const res = await GET('/absences?crecheCode=beta', w.dirA.token)
      expect(res.status).toBe(200)
      expect(res.body.items).toEqual([])
    })

    it('[rule-evp-list-scope] an item has exactly the summary fields', async () => {
      await seedTwoCreches()
      const res = await GET('/absences', w.rh.token)
      expect(sortedKeys(res.body)).toEqual(['items', 'truncated'])
      for (const i of res.body.items) expect(sortedKeys(i)).toEqual(SUMMARY_KEYS)
      expect(res.body.items[0].contractLabel).toEqual(expect.any(String))
    })

    it('[rule-evp-list-max-200] at most 200 dossiers, newest first, truncated flagged only above 200', async () => {
      const base = '2024-01-01'
      await sql(
        `insert into base.absences (creche_code, scope_code, contract_id, type_code, start_date, start_half, end_date, end_half, status,
           saisie_declaree, payroll_month, blockages, declared_by, declared_at, created_at, updated_at)
         select 'alpha', 'alpha', $1, 'CONGES_PAYES', ($2::date + g), 'MATIN', ($2::date + g), 'APRES_MIDI', 'A_VALIDER',
           false, to_char($2::date + g, 'YYYY-MM'), '[]'::jsonb, $3, now(), now() - (g || ' minutes')::interval, now()
         from generate_series(1, 200) g`,
        [w.ctA.id, base, w.rh.id],
      )
      const exact = await GET('/absences', w.rh.token)
      expect(exact.body.items).toHaveLength(200)
      expect(exact.body.truncated).toBe(false)
      await seedAbsence({ contractId: w.ctA.id, declaredBy: w.rh.id, startDate: '2020-06-01', endDate: '2020-06-01', createdAt: new Date(Date.now() - 3600 * 1000 * 24 * 30).toISOString() })
      const over = await GET('/absences', w.rh.token)
      expect(over.body.items).toHaveLength(200)
      expect(over.body.truncated).toBe(true)
      const created = over.body.items.map((i: any) => Date.parse(i.createdAt))
      expect([...created].sort((x, y) => y - x)).toEqual(created)
      expect(over.body.items.map((i: any) => i.startDate)).not.toContain('2020-06-01')
    })

    it('[rule-evp-list-max-200] the most recent 200 are kept, not the oldest', async () => {
      const oldest = await seedAbsence({ contractId: w.ctA.id, declaredBy: w.rh.id, startDate: '2019-01-01', endDate: '2019-01-01', createdAt: '2019-01-01T10:00:00Z' })
      const newest = await seedAbsence({ contractId: w.ctA.id, declaredBy: w.rh.id, startDate: '2030-01-01', endDate: '2030-01-01', createdAt: new Date().toISOString() })
      const res = await GET('/absences', w.rh.token)
      const ids = res.body.items.map((i: any) => i.id)
      expect(ids[0]).toBe(newest)
      expect(ids[ids.length - 1]).toBe(oldest)
    })

    it('[rule-evp-list-scope] status filter accepts repeated values, payrollMonth and open filter', async () => {
      const v = await seedAbsence({ contractId: w.ctA.id, declaredBy: w.rh.id, status: 'A_VALIDER', startDate: d(-30), endDate: d(-30), payrollMonth: '2026-01' })
      const s = await seedAbsence({ contractId: w.ctA.id, declaredBy: w.rh.id, status: 'A_SAISIR', startDate: d(-40), endDate: d(-40), payrollMonth: '2026-02' })
      const r = await seedAbsence({ contractId: w.ctA.id, declaredBy: w.rh.id, status: 'REJETEE', startDate: d(-50), endDate: d(-50), payrollMonth: '2026-02' })
      const p = await seedAbsence({ contractId: w.ctA.id, declaredBy: w.rh.id, status: 'DANS_PAYFIT', startDate: d(-60), endDate: d(-60), payrollMonth: '2026-02' })
      const ids = async (q: string) => (await GET(`/absences${q}`, w.rh.token)).body.items.map((i: any) => i.id).sort()
      expect(await ids(qs({ status: ['A_VALIDER', 'A_SAISIR'] }))).toEqual([v, s].sort())
      expect(await ids('?status=REJETEE')).toEqual([r])
      expect(await ids('?payrollMonth=2026-02')).toEqual([s, r, p].sort())
      expect(await ids('?open=true')).toEqual([v, s].sort())
    })

    it('[rule-evp-list-scope] from and to keep the dossiers of the period and drop those entirely outside', async () => {
      const inside = await seedAbsence({ contractId: w.ctA.id, declaredBy: w.rh.id, startDate: '2026-03-10', endDate: '2026-03-12', payrollMonth: '2026-03' })
      await seedAbsence({ contractId: w.ctA2.id, declaredBy: w.rh.id, startDate: '2026-07-10', endDate: '2026-07-12', payrollMonth: '2026-07' })
      await seedAbsence({ contractId: w.ctA2.id, declaredBy: w.rh.id, startDate: '2025-01-10', endDate: '2025-01-12', payrollMonth: '2025-01' })
      const res = await GET('/absences?from=2026-03-01&to=2026-03-31', w.rh.token)
      expect(res.body.items.map((i: any) => i.id)).toEqual([inside])
    })

    it.each(['status=INCONNU', 'status=', 'from=demain', 'to=2026-02-30', 'payrollMonth=2026-13', 'payrollMonth=202601', 'open=peut-etre', `crecheCode=${'x'.repeat(21)}`])(
      '[rule-evp-list-scope] query %s answers 400 api.validation.incoming_failed',
      async (q) => {
        const res = await GET(`/absences?${q}`, w.rh.token)
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('api.validation.incoming_failed')
      },
    )

    it('[rule-evp-list-scope] anonymous gets 401', async () => {
      expect((await GET('/absences')).status).toBe(401)
    })
  })

  // ───────────────────────────── GET /absences/:id ─────────────────────────────
  describe('GET /absences/:id', () => {
    it('[rule-evp-list-scope] a dossier outside the perimeter answers 404 repository.not_found, byte for byte the same as an unknown one', async () => {
      const b1 = await seedAbsence({ contractId: w.ctB.id, crecheCode: 'beta', declaredBy: w.rh.id })
      for (const who of [w.dirA, w.roA]) {
        const foreign = await GET(`/absences/${b1}`, who.token)
        const unknown = await GET(`/absences/${UNKNOWN_UUID}`, who.token)
        expect(foreign.status).toBe(404)
        expect(foreign.body.code).toBe('repository.not_found')
        expect(foreign.body).toEqual(unknown.body)
        expect(foreign.text).not.toContain('Zoé')
      }
      expect((await GET(`/absences/${b1}`, w.dirB.token)).status).toBe(200)
      expect((await GET(`/absences/${b1}`, w.rh.token)).status).toBe(200)
      expect((await GET(`/absences/${b1}`, w.adm.token)).status).toBe(200)
    })

    it('[rule-evp-list-scope] a malformed identifier is 400, anonymous 401', async () => {
      expect((await GET('/absences/not-a-uuid', w.rh.token)).status).toBe(400)
      expect((await GET(`/absences/${UNKNOWN_UUID}`)).status).toBe(401)
    })

    it.each([
      ['A_COMPLETER', 'DECLARANT'], ['ANTICIPEE', 'DECLARANT'], ['A_VALIDER', 'RH'], ['A_SAISIR', 'LECTURE_PAYFIT'],
      ['DANS_PAYFIT', 'AUCUN'], ['REJETEE', 'AUCUN'], ['ANNULEE', 'AUCUN'],
    ] as Array<[Status, string]>)('[rule-evp-arbitrage-rh] [rule-evp-decision-states] a %s dossier points to %s as next actor, never a RO for arbitration', async (status, actor) => {
      const id = await seedAbsence({ contractId: w.ctA.id, declaredBy: w.dirA.id, status })
      const res = await GET(`/absences/${id}`, w.dirA.token)
      expect(res.body.status).toBe(status)
      expect(res.body.nextAction.actor).toBe(actor)
      expect(res.body.nextAction.actorLabel).toEqual(expect.any(String))
      expect(res.body.nextAction.label).toEqual(expect.any(String))
      expect(res.body.nextAction.actorLabel.length).toBeGreaterThan(0)
      expect(res.body.progress.total).toBe(5)
    })

    it('[rule-evp-decision-states] the progress of a confirmed dossier is beyond that of a dossier waiting for validation', async () => {
      const waiting = await seedAbsence({ contractId: w.ctA.id, declaredBy: w.dirA.id, status: 'A_VALIDER' })
      const done = await seedAbsence({ contractId: w.ctA2.id, declaredBy: w.dirA.id, status: 'DANS_PAYFIT' })
      const a = (await GET(`/absences/${waiting}`, w.rh.token)).body.progress
      const b = (await GET(`/absences/${done}`, w.rh.token)).body.progress
      expect(b.step).toBeGreaterThan(a.step)
      expect(b.step).toBeLessThanOrEqual(5)
    })

    const ACTIONS: Record<string, Record<string, string[]>> = {
      A_COMPLETER: { dirA: ['ATTACH', 'CANCEL', 'SUBMIT'], roA: ['ATTACH', 'CANCEL', 'SUBMIT'], rh: ['ATTACH', 'CANCEL', 'REJECT', 'SUBMIT'], sup: ['ATTACH', 'CANCEL', 'SUBMIT'], adm: [] },
      ANTICIPEE: { dirA: ['ATTACH', 'CANCEL', 'SUBMIT'], roA: ['ATTACH', 'CANCEL', 'SUBMIT'], rh: ['ATTACH', 'CANCEL', 'REJECT', 'RETURN', 'SUBMIT'], sup: ['ATTACH', 'CANCEL', 'SUBMIT'], adm: [] },
      A_VALIDER: { dirA: ['ATTACH', 'CANCEL', 'SUBMIT'], roA: ['ATTACH', 'CANCEL', 'SUBMIT'], rh: ['ATTACH', 'CANCEL', 'REJECT', 'RETURN', 'SUBMIT', 'VALIDATE'], sup: ['ATTACH', 'CANCEL', 'SUBMIT'], adm: [] },
      A_SAISIR: { dirA: ['ATTACH'], roA: ['ATTACH'], rh: ['ATTACH', 'CANCEL', 'MARK_ENTERED', 'REJECT', 'RETURN'], sup: ['ATTACH'], adm: [] },
      DANS_PAYFIT: { dirA: [], roA: [], rh: [], sup: [], adm: [] },
      REJETEE: { dirA: [], roA: [], rh: [], sup: [], adm: [] },
      ANNULEE: { dirA: [], roA: [], rh: [], sup: [], adm: [] },
    }
    it.each(ALL_STATUSES)('[rule-evp-detail-actions-from-api] [rule-evp-decision-marine-only] allowedActions of a %s dossier follow the transition table and the capability of the caller', async (status) => {
      const id = await seedAbsence({ contractId: w.ctA.id, declaredBy: w.dirA.id, status })
      for (const who of ['dirA', 'roA', 'rh', 'sup', 'adm'] as const) {
        const res = await GET(`/absences/${id}`, w[who].token)
        expect([...res.body.allowedActions].sort()).toEqual(ACTIONS[status][who])
      }
    })

    it('[rule-evp-detail-actions-from-api] only RH can select a dossier for the batch validation', async () => {
      const id = await seedAbsence({ contractId: w.ctA.id, declaredBy: w.dirA.id, status: 'A_VALIDER' })
      const saisir = await seedAbsence({ contractId: w.ctA2.id, declaredBy: w.dirA.id, status: 'A_SAISIR' })
      const list = async (who: { token: string }) => (await GET('/absences', who.token)).body.items
      const rh = await list(w.rh)
      expect(rh.find((i: any) => i.id === id).selectable).toBe(true)
      expect(rh.find((i: any) => i.id === saisir).selectable).toBe(false)
      for (const who of [w.dirA, w.roA, w.sup, w.adm]) expect((await list(who)).every((i: any) => i.selectable === false)).toBe(true)
    })

    it('[rule-evp-decision-states] the last decision and its administrative reason are exposed', async () => {
      const id = await seedAbsence({ contractId: w.ctA.id, declaredBy: w.dirA.id })
      const res = await POST(`/absences/${id}/reject`, w.rh.token, { reason: 'Justificatif non conforme' })
      expect(res.status).toBe(200)
      expect(res.body.lastDecision).toMatchObject({ byName: w.rh.name, reason: 'Justificatif non conforme' })
      expect(Math.abs(Date.now() - Date.parse(res.body.lastDecision.at))).toBeLessThan(60000)
      expect((await GET(`/absences/${id}`, w.dirA.token)).body.lastDecision.reason).toBe('Justificatif non conforme')
    })
  })

  // ───────────────────────────── GET /absences/:id/audit ─────────────────────────────
  describe('GET /absences/:id/audit', () => {
    it('[rule-evp-audit-atomic] RH and SUPERADMIN read the audit entries of a dossier, in the journal shape', async () => {
      const created = await createAbsence(w.dirA.token, { contractId: w.ctA.id })
      await POST(`/absences/${created.body.id}/validate`, w.rh.token)
      for (const who of [w.rh, w.sup]) {
        const res = await GET(`/absences/${created.body.id}/audit`, who.token)
        expect(res.status).toBe(200)
        expect(sortedKeys(res.body)).toEqual(['items'])
        expect(res.body.items.length).toBeGreaterThanOrEqual(2)
        for (const e of res.body.items) {
          expect(sortedKeys(e)).toEqual(['absenceId', 'actorEmail', 'actorName', 'id', 'occurredAt', 'operation', 'operationLabel', 'summary'])
          expect(e.absenceId).toBe(created.body.id)
        }
        const ops = res.body.items.map((e: any) => e.operation)
        expect(ops).toEqual(expect.arrayContaining(['absences:create', 'absences:validate']))
      }
    })

    it('[rule-evp-audit-atomic] without the journal capability (directrice, RO, ADMINISTRATRICE) the answer is 403; unknown dossier 404; malformed id 400; anonymous 401', async () => {
      const created = await createAbsence(w.dirA.token, { contractId: w.ctA.id })
      for (const who of [w.dirA, w.roA, w.adm]) expect((await GET(`/absences/${created.body.id}/audit`, who.token)).status).toBe(403)
      expect((await GET(`/absences/${UNKNOWN_UUID}/audit`, w.rh.token)).status).toBe(404)
      expect((await GET('/absences/xyz/audit', w.rh.token)).status).toBe(400)
      expect((await GET(`/absences/${created.body.id}/audit`)).status).toBe(401)
    })
  })

  // ───────────────────────────── GET /todo ─────────────────────────────
  describe('GET /todo', () => {
    it('[rule-evp-todo-counter-definition] counters: À compléter = A_COMPLETER, En attente = A_VALIDER + ANTICIPEE + A_SAISIR, Refusées = REJETEE', async () => {
      const counts: Array<[Status, number]> = [['A_COMPLETER', 2], ['A_VALIDER', 1], ['ANTICIPEE', 1], ['A_SAISIR', 1], ['REJETEE', 3], ['DANS_PAYFIT', 4], ['ANNULEE', 2]]
      let day = 100
      for (const [status, n] of counts) {
        for (let i = 0; i < n; i++) {
          await seedAbsence({ contractId: w.ctA.id, declaredBy: w.rh.id, status, startDate: d(-day), endDate: d(-day) })
          day += 2
        }
      }
      const res = await GET('/todo', w.rh.token)
      expect(res.status).toBe(200)
      expect(sortedKeys(res.body)).toEqual(['counters', 'priority', 'recentActivity'])
      expect(sortedKeys(res.body.counters)).toEqual(['aCompleter', 'enAttente', 'refusees'])
      expect(res.body.counters.aCompleter.count).toBe(2)
      expect(res.body.counters.enAttente.count).toBe(3)
      expect(res.body.counters.refusees.count).toBe(3)
      for (const k of ['aCompleter', 'enAttente', 'refusees']) expect(res.body.counters[k].hint).toEqual(expect.any(String))
    })

    it('[rule-evp-todo-counter-definition] [rule-evp-list-scope] counters and priority dossiers follow the perimeter of the caller', async () => {
      await seedAbsence({ contractId: w.ctA.id, declaredBy: w.rh.id, status: 'A_COMPLETER' })
      await seedAbsence({ contractId: w.ctB.id, crecheCode: 'beta', declaredBy: w.rh.id, status: 'A_COMPLETER' })
      await seedAbsence({ contractId: w.ctB.id, crecheCode: 'beta', declaredBy: w.rh.id, status: 'REJETEE', startDate: d(-90), endDate: d(-90) })
      const a = (await GET('/todo', w.dirA.token)).body
      expect(a.counters.aCompleter.count).toBe(1)
      expect(a.counters.refusees.count).toBe(0)
      expect(a.priority.every((p: any) => p.crecheCode === 'alpha')).toBe(true)
      const all = (await GET('/todo', w.rh.token)).body
      expect(all.counters.aCompleter.count).toBe(2)
      const filtered = (await GET('/todo?crecheCode=beta', w.rh.token)).body
      expect(filtered.counters.aCompleter.count).toBe(1)
      expect((await GET('/todo?crecheCode=beta', w.dirA.token)).body.counters.aCompleter.count).toBe(0)
    })

    it('[rule-evp-todo-priority-order] the dossiers the caller can act on come first, then the nearest start date', async () => {
      const later = await seedAbsence({ contractId: w.ctA.id, declaredBy: w.rh.id, status: 'A_COMPLETER', startDate: d(20), endDate: d(21) })
      const sooner = await seedAbsence({ contractId: w.ctA2.id, declaredBy: w.rh.id, status: 'A_COMPLETER', startDate: d(3), endDate: d(4) })
      const toValidate = await seedAbsence({ contractId: w.ctA.id, declaredBy: w.rh.id, status: 'A_VALIDER', startDate: d(-60), endDate: d(-59) })
      const dir = (await GET('/todo', w.dirA.token)).body.priority.map((p: any) => p.id)
      const pos = (id: string) => (dir.indexOf(id) < 0 ? Infinity : dir.indexOf(id))
      expect(pos(sooner)).toBeLessThan(pos(later))
      expect(pos(later)).toBeLessThan(pos(toValidate))
      const rhPriority = (await GET('/todo', w.rh.token)).body.priority.map((p: any) => p.id)
      expect(rhPriority).toContain(toValidate)
    })

    it('[rule-evp-todo-priority-order] at most 50 priority dossiers and 10 recent activities', async () => {
      for (let i = 0; i < 60; i++) await seedAbsence({ contractId: w.ctA.id, declaredBy: w.rh.id, status: 'A_VALIDER', startDate: d(-200 - i * 3), endDate: d(-200 - i * 3) })
      for (let i = 0; i < 12; i++) {
        const r = await createAbsence(w.dirA.token, { contractId: w.ctA2.id, startDate: d(-30 - i * 3), endDate: d(-30 - i * 3) })
        expect(r.status).toBe(201)
      }
      const res = await GET('/todo', w.rh.token)
      expect(res.body.priority).toHaveLength(50)
      expect(res.body.recentActivity).toHaveLength(10)
      for (const a of res.body.recentActivity) expect(sortedKeys(a)).toEqual(['absenceId', 'at', 'text'])
      const times = res.body.recentActivity.map((a: any) => Date.parse(a.at))
      expect([...times].sort((x, y) => y - x)).toEqual(times)
    })

    it('[rule-evp-todo-counter-definition] to before from answers 400; a valid period is accepted; bad dates are 400', async () => {
      const bad = await GET('/todo?from=2026-02-10&to=2026-02-09', w.rh.token)
      expect(bad.status).toBe(400)
      expect(bad.body.code).toBe('api.validation.incoming_failed')
      expect((await GET('/todo?from=2026-02-10&to=2026-02-10', w.rh.token)).status).toBe(200)
      for (const q of ['from=2026-02-30', 'to=demain', `crecheCode=${'x'.repeat(21)}`]) expect((await GET(`/todo?${q}`, w.rh.token)).status).toBe(400)
    })

    it('[rule-evp-todo-counter-definition] from and to restrict the counters to the period', async () => {
      await seedAbsence({ contractId: w.ctA.id, declaredBy: w.rh.id, status: 'A_COMPLETER', startDate: '2026-03-10', endDate: '2026-03-11' })
      await seedAbsence({ contractId: w.ctA2.id, declaredBy: w.rh.id, status: 'A_COMPLETER', startDate: '2025-01-10', endDate: '2025-01-11' })
      const res = await GET('/todo?from=2026-03-01&to=2026-03-31', w.rh.token)
      expect(res.body.counters.aCompleter.count).toBe(1)
    })

    it('[rule-evp-todo-counter-definition] anonymous gets 401', async () => {
      expect((await GET('/todo')).status).toBe(401)
    })
  })
})
