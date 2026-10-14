import { randomBytes } from 'node:crypto'
import { resetData, closePool, sql } from './harness'
import { logSince, logSize } from './renfort-helpers'
import { API_URL } from './harness'
import {
  http, GET, POST, UNKNOWN_UUID, seedWorld, seedAbsence, createAbsence, authorizeUpload, putBytes, confirmPiece, uploadPiece, PDF_BYTES, JPEG_BYTES,
  PNG_BYTES, storageFilesContaining, World, auditRows, auditCount, countRows, sortedKeys, closeEvp, addDays, todayParis,
} from './evp-helpers'

const d = (n: number) => addDays(todayParis(), n)
const marker = () => randomBytes(8).toString('hex')

// Acceptance suite of version v1-evp: supporting documents (temporary upload, confirmation, read link).
describe('EVP justificatifs', () => {
  let w: World

  beforeEach(async () => {
    await resetData()
    w = await seedWorld()
  })
  afterAll(async () => {
    await closeEvp()
    await closePool()
  })

  // ───────────────────────────── authorize-upload ─────────────────────────────
  describe('POST /justificatifs/authorize-upload', () => {
    it('[rule-evp-attach-temp-upload] [rule-evp-piece-scope] a declarant gets a 5-minute PUT URL bound to the announced type and size; a row is written without bytes', async () => {
      const res = await authorizeUpload(w.dirA.token, { sizeBytes: 1234, fileName: 'avis.pdf' })
      expect(res.status).toBe(201)
      expect(sortedKeys(res.body)).toEqual(['expiresAt', 'headers', 'id', 'method', 'uploadUrl'])
      expect(res.body.method).toBe('PUT')
      expect(typeof res.body.uploadUrl).toBe('string')
      expect(typeof res.body.headers).toBe('object')
      const ttl = Date.parse(res.body.expiresAt) - Date.now()
      expect(ttl).toBeGreaterThan(4 * 60 * 1000)
      expect(ttl).toBeLessThanOrEqual(5 * 60 * 1000 + 15000)
      const row = (await sql('select * from base.absence_pieces where id = $1', [res.body.id]))[0]
      expect(row).toMatchObject({ status: 'AUTHORIZED', creche_code: 'alpha', uploaded_by: w.dirA.id, file_name: 'avis.pdf', content_type: 'application/pdf', announced_size: 1234 })
    })

    it('[rule-evp-attach-no-files-in-db] no column of the pieces table can hold file bytes: only metadata is stored', async () => {
      const cols = await sql("select column_name, data_type from information_schema.columns where table_schema = 'base' and table_name = 'absence_pieces'")
      expect(cols.length).toBeGreaterThan(5)
      for (const c of cols) {
        expect(['bytea', 'oid']).not.toContain(c.data_type)
        expect(c.column_name).not.toMatch(/^(content|bytes|data|blob|body|file)$/i)
      }
      const piece = await uploadPiece(w.dirA.token, { marker: 'MARQUEUR-OCTETS-DB' })
      const dump = JSON.stringify(await sql('select p::text as t from base.absence_pieces p where id = $1', [piece.id]))
      expect(dump).not.toContain('MARQUEUR-OCTETS-DB')
    })

    it('[rule-evp-attach-formats] 10 485 760 bytes and 1 byte are accepted; 10 485 761, 0, negative and non-integer sizes are refused 400', async () => {
      expect((await authorizeUpload(w.dirA.token, { sizeBytes: 10485760 })).status).toBe(201)
      expect((await authorizeUpload(w.dirA.token, { sizeBytes: 1 })).status).toBe(201)
      for (const sizeBytes of [10485761, 0, -1, 1.5, '100', null]) {
        const res = await authorizeUpload(w.dirA.token, { sizeBytes: sizeBytes as any })
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('api.validation.incoming_failed')
      }
    })

    it('[rule-evp-attach-formats] only PDF, JPEG and PNG are accepted', async () => {
      for (const contentType of ['application/pdf', 'image/jpeg', 'image/png']) expect((await authorizeUpload(w.dirA.token, { sizeBytes: 10, contentType })).status).toBe(201)
      for (const contentType of ['image/gif', 'application/zip', 'text/html', 'application/msword', 'image/svg+xml', 'application/PDF ', '']) {
        const res = await authorizeUpload(w.dirA.token, { sizeBytes: 10, contentType })
        expect(res.status).toBe(400)
      }
    })

    it('[rule-evp-attach-formats] the file name is 1..255 characters', async () => {
      expect((await authorizeUpload(w.dirA.token, { sizeBytes: 10, fileName: 'x'.repeat(255) })).status).toBe(201)
      for (const fileName of ['', 'x'.repeat(256), 'a\u0000b']) expect((await authorizeUpload(w.dirA.token, { sizeBytes: 10, fileName })).status).toBe(400)
      expect((await http('POST', '/justificatifs/authorize-upload', { token: w.dirA.token, body: { crecheCode: 'alpha', contentType: 'application/pdf', sizeBytes: 10 } })).status).toBe(400)
    })

    it('[rule-evp-piece-scope] the role and the crèche are checked: ADMINISTRATRICE 403, crèche outside the perimeter 403, anonymous 401, nothing written', async () => {
      expect((await authorizeUpload(w.adm.token, { sizeBytes: 10 })).status).toBe(403)
      expect((await authorizeUpload(w.dirA.token, { sizeBytes: 10, crecheCode: 'beta' })).status).toBe(403)
      expect((await authorizeUpload(w.roA.token, { sizeBytes: 10, crecheCode: 'beta' })).status).toBe(403)
      expect((await http('POST', '/justificatifs/authorize-upload', { body: { crecheCode: 'alpha', fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 10 } })).status).toBe(401)
      expect(await countRows('absence_pieces')).toBe(0)
      for (const who of [w.rh, w.sup, w.roA]) expect((await authorizeUpload(who.token, { sizeBytes: 10 })).status).toBe(201)
    })

    it('[rule-evp-piece-scope] a dossier outside the perimeter is 404 (as an unknown dossier)', async () => {
      const b1 = await seedAbsence({ contractId: w.ctB.id, crecheCode: 'beta', declaredBy: w.rh.id })
      const foreign = await authorizeUpload(w.dirB.token, { crecheCode: 'beta', absenceId: await seedAbsence({ contractId: w.ctA.id, declaredBy: w.rh.id }), sizeBytes: 10 })
      const unknown = await authorizeUpload(w.dirB.token, { crecheCode: 'beta', absenceId: UNKNOWN_UUID, sizeBytes: 10 })
      expect(foreign.status).toBe(404)
      expect(foreign.body).toEqual(unknown.body)
      expect((await authorizeUpload(w.dirB.token, { crecheCode: 'beta', absenceId: b1, sizeBytes: 10 })).status).toBe(201)
    })

    it('[rule-evp-piece-no-medical-in-logs] [rule-evp-audit-atomic] the authorization leaves one audit entry (Justificatif) without the file name; a refusal leaves none', async () => {
      const res = await authorizeUpload(w.dirA.token, { sizeBytes: 10, fileName: 'arret-maladie-dupont.pdf' })
      const entries = await auditRows('justificatifs:authorize')
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ actor_id: w.dirA.id, object_type: 'Justificatif' })
      expect(entries[0].summary).not.toContain('arret-maladie-dupont')
      expect(res.status).toBe(201)
      await authorizeUpload(w.dirA.token, { sizeBytes: 0 })
      await authorizeUpload(w.adm.token, { sizeBytes: 10 })
      expect(await auditCount('justificatifs:authorize')).toBe(1)
    })

    it('[rule-evp-attach-temp-upload] the signed URL refuses a deposit of another type or of a larger size than announced', async () => {
      const bytes = PDF_BYTES(marker())
      const auth = await authorizeUpload(w.dirA.token, { sizeBytes: bytes.length })
      expect(await putBytes(auth.body, bytes, 'text/plain')).toBeGreaterThanOrEqual(400)
      expect(await putBytes(auth.body, Buffer.concat([bytes, Buffer.from('plus long que prévu')]), 'application/pdf')).toBeGreaterThanOrEqual(400)
      const conf = await confirmPiece(w.dirA.token, auth.body.id)
      expect(conf.status).toBe(409)
      expect(conf.body.code).toBe('justificatifs.not_uploaded')
    })

    it('[rule-evp-attach-temp-upload] the deposit URL carries no EVP credential: the deposit works without the session', async () => {
      const bytes = PDF_BYTES(marker())
      const auth = await authorizeUpload(w.dirA.token, { sizeBytes: bytes.length })
      expect(JSON.stringify(auth.body)).not.toContain(w.dirA.token)
      expect(await putBytes(auth.body, bytes, 'application/pdf')).toBeLessThan(300)
    })
  })

  // ───────────────────────────── confirm ─────────────────────────────
  describe('POST /justificatifs/:id/confirm', () => {
    it('[rule-evp-attach-copy-out] [rule-evp-attach-single-confirm] confirmation checks the real size and signature, copies the bytes out of the deposit zone, then marks the piece confirmed; a second confirmation is idempotent', async () => {
      const m = marker()
      const bytes = PDF_BYTES(m)
      const auth = await authorizeUpload(w.dirA.token, { sizeBytes: bytes.length, fileName: 'certificat.pdf' })
      expect(await putBytes(auth.body, bytes, 'application/pdf')).toBeLessThan(300)
      expect(storageFilesContaining(m).length).toBeGreaterThanOrEqual(1)
      const res = await confirmPiece(w.dirA.token, auth.body.id)
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ id: auth.body.id, name: 'certificat.pdf', sizeBytes: bytes.length, confirmed: true })
      const row = (await sql('select * from base.absence_pieces where id = $1', [auth.body.id]))[0]
      expect(row.status).toBe('CONFIRMED')
      expect(row.size_bytes).toBe(bytes.length)
      expect(row.final_key).toBeTruthy()
      expect(row.final_key).not.toBe(row.storage_key)
      expect(row.confirmed_at).not.toBeNull()
      expect(storageFilesContaining(m)).toHaveLength(1)
      const again = await confirmPiece(w.dirA.token, auth.body.id)
      expect(again.status).toBe(200)
      expect(again.body).toEqual(res.body)
      expect(storageFilesContaining(m)).toHaveLength(1)
    })

    it.each([
      ['application/pdf', 'pdf', (m: string) => PDF_BYTES(m)],
      ['image/jpeg', 'jpg', (m: string) => JPEG_BYTES(m)],
      ['image/png', 'png', (m: string) => PNG_BYTES(m)],
    ] as Array<[string, string, (m: string) => Buffer]>)('[rule-evp-attach-formats] a genuine %s file is confirmed', async (contentType, ext, make) => {
      const bytes = make(marker())
      const auth = await authorizeUpload(w.dirA.token, { sizeBytes: bytes.length, contentType, fileName: `piece.${ext}` })
      expect(await putBytes(auth.body, bytes, contentType)).toBeLessThan(300)
      expect((await confirmPiece(w.dirA.token, auth.body.id)).status).toBe(200)
    })

    it('[rule-evp-attach-temp-upload] nothing deposited: 409 justificatifs.not_uploaded', async () => {
      const auth = await authorizeUpload(w.dirA.token, { sizeBytes: 100 })
      const res = await confirmPiece(w.dirA.token, auth.body.id)
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('justificatifs.not_uploaded')
      expect((await sql('select status from base.absence_pieces where id = $1', [auth.body.id]))[0].status).toBe('AUTHORIZED')
    })

    it('[rule-evp-attach-formats] a real size different from the announced one: 409 justificatifs.size_mismatch, the deposited object is deleted', async () => {
      const m = marker()
      const bytes = PDF_BYTES(m)
      const auth = await authorizeUpload(w.dirA.token, { sizeBytes: bytes.length })
      await putBytes(auth.body, bytes, 'application/pdf')
      await sql('update base.absence_pieces set announced_size = announced_size + 10 where id = $1', [auth.body.id])
      const res = await confirmPiece(w.dirA.token, auth.body.id)
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('justificatifs.size_mismatch')
      expect(storageFilesContaining(m)).toHaveLength(0)
      expect((await sql('select status from base.absence_pieces where id = $1', [auth.body.id]))[0].status).not.toBe('CONFIRMED')
    })

    it.each([
      ['application/pdf', 'a text file renamed to PDF', () => Buffer.from('Ceci n’est pas un PDF ')],
      ['application/pdf', 'a JPEG declared as PDF', () => JPEG_BYTES()],
      ['image/jpeg', 'a PDF declared as JPEG', () => PDF_BYTES()],
      ['image/png', 'a JPEG declared as PNG', () => JPEG_BYTES()],
      ['image/jpeg', 'an empty-signature file declared as JPEG', () => Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07])],
    ] as Array<[string, string, () => Buffer]>)('[rule-evp-attach-formats] %s: %s gives 409 justificatifs.signature_mismatch and the deposit is deleted', async (contentType, _label, make) => {
      const m = marker()
      const bytes = Buffer.concat([make(), Buffer.from(` ${m}`)])
      const auth = await authorizeUpload(w.dirA.token, { sizeBytes: bytes.length, contentType })
      expect(await putBytes(auth.body, bytes, contentType)).toBeLessThan(300)
      const res = await confirmPiece(w.dirA.token, auth.body.id)
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('justificatifs.signature_mismatch')
      expect(storageFilesContaining(m)).toHaveLength(0)
      expect((await sql('select status from base.absence_pieces where id = $1', [auth.body.id]))[0].status).not.toBe('CONFIRMED')
    })

    it('[rule-evp-attach-temp-upload] after 5 minutes the confirmation is refused: 409 justificatifs.upload_expired', async () => {
      const bytes = PDF_BYTES(marker())
      const auth = await authorizeUpload(w.dirA.token, { sizeBytes: bytes.length })
      await putBytes(auth.body, bytes, 'application/pdf')
      await sql("update base.absence_pieces set upload_expires_at = now() - interval '1 minute', created_at = now() - interval '6 minutes' where id = $1", [auth.body.id])
      const res = await confirmPiece(w.dirA.token, auth.body.id)
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('justificatifs.upload_expired')
      expect((await sql('select status from base.absence_pieces where id = $1', [auth.body.id]))[0].status).not.toBe('CONFIRMED')
    })

    it('[rule-evp-piece-scope] the depositor and any declarant of the crèche can confirm; another crèche is refused and ADMINISTRATRICE gets 403; anonymous 401', async () => {
      const bytes = PDF_BYTES(marker())
      const auth = await authorizeUpload(w.dirA.token, { sizeBytes: bytes.length })
      await putBytes(auth.body, bytes, 'application/pdf')
      const unknown = await confirmPiece(w.dirB.token, UNKNOWN_UUID)
      const foreign = await confirmPiece(w.dirB.token, auth.body.id)
      expect([403, 404]).toContain(foreign.status)
      expect(foreign.status).toBe(unknown.status)
      expect((await confirmPiece(w.adm.token, auth.body.id)).status).toBe(403)
      expect((await confirmPiece(undefined as any, auth.body.id)).status).toBe(401)
      expect((await sql('select status from base.absence_pieces where id = $1', [auth.body.id]))[0].status).toBe('AUTHORIZED')
      expect((await confirmPiece(w.roA.token, auth.body.id)).status).toBe(200)
    })

    it('[rule-evp-piece-scope] a piece of another crèche cannot be confirmed by a declarant of this crèche: cross-crèche confirmation is refused', async () => {
      const bytes = PDF_BYTES(marker())
      const auth = await authorizeUpload(w.dirB.token, { crecheCode: 'beta', sizeBytes: bytes.length })
      await putBytes(auth.body, bytes, 'application/pdf')
      const res = await confirmPiece(w.dirA.token, auth.body.id)
      expect([403, 404]).toContain(res.status)
      expect((await sql('select status from base.absence_pieces where id = $1', [auth.body.id]))[0].status).toBe('AUTHORIZED')
    })

    it('[rule-evp-attach-attached-on-confirm] confirming with a dossier attaches the piece and replays the controls: « pièce manquante » falls and the dossier becomes « À valider »', async () => {
      const created = await createAbsence(w.dirA.token, { contractId: w.ctA.id, typeCode: 'ENFANT_MALADE' })
      expect(created.body.status).toBe('A_COMPLETER')
      expect(created.body.blockages.map((b: any) => b.code)).toContain('piece_missing')
      const piece = await uploadPiece(w.dirA.token, { absenceId: created.body.id, fileName: 'certificat.pdf' })
      const detail = (await GET(`/absences/${created.body.id}`, w.dirA.token)).body
      expect(detail.status).toBe('A_VALIDER')
      expect(detail.blockages).toEqual([])
      expect(detail.pieces.map((p: any) => p.id)).toEqual([piece.id])
      expect((await sql('select absence_id, attached_at from base.absence_pieces where id = $1', [piece.id]))[0].absence_id).toBe(created.body.id)
    })

    it('[rule-evp-declare-max-pieces] a 6th confirmed piece on a dossier answers 409 justificatifs.too_many and is not attached', async () => {
      const created = await createAbsence(w.dirA.token, { contractId: w.ctA.id })
      for (let i = 0; i < 5; i++) await uploadPiece(w.dirA.token, { absenceId: created.body.id })
      const bytes = PDF_BYTES(marker())
      const auth = await authorizeUpload(w.dirA.token, { absenceId: created.body.id, sizeBytes: bytes.length })
      await putBytes(auth.body, bytes, 'application/pdf')
      const res = await confirmPiece(w.dirA.token, auth.body.id)
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('justificatifs.too_many')
      expect((await GET(`/absences/${created.body.id}`, w.dirA.token)).body.pieces).toHaveLength(5)
      expect(await countRows('absence_pieces', "absence_id = $1 and status = 'CONFIRMED'", [created.body.id])).toBe(5)
    })

    it('[rule-evp-declare-max-pieces] six simultaneous confirmations on an empty dossier attach at most 5 (the count is checked under lock)', async () => {
      const created = await createAbsence(w.dirA.token, { contractId: w.ctA.id })
      const ids: string[] = []
      for (let i = 0; i < 6; i++) {
        const bytes = PDF_BYTES(marker())
        const auth = await authorizeUpload(w.dirA.token, { absenceId: created.body.id, sizeBytes: bytes.length })
        await putBytes(auth.body, bytes, 'application/pdf')
        ids.push(auth.body.id)
      }
      const results = await Promise.all(ids.map((id) => confirmPiece(w.dirA.token, id)))
      expect(results.filter((r) => r.status === 200)).toHaveLength(5)
      expect(results.filter((r) => r.status === 409).every((r) => r.body.code === 'justificatifs.too_many')).toBe(true)
      expect((await GET(`/absences/${created.body.id}`, w.dirA.token)).body.pieces).toHaveLength(5)
    })

    it('[rule-evp-attach-single-confirm] unknown piece is 404, malformed identifier 400', async () => {
      expect((await confirmPiece(w.dirA.token, UNKNOWN_UUID)).status).toBe(404)
      expect((await confirmPiece(w.dirA.token, 'not-a-uuid')).status).toBe(400)
    })
  })

  // ───────────────────────────── read-link ─────────────────────────────
  describe('POST /justificatifs/:id/read-link', () => {
    async function attached(typeCode: string, uploader = w.roA, kind: 'pdf' | 'jpeg' = 'pdf', fileName = 'piece.pdf') {
      const piece = await uploadPiece(uploader.token, { kind, fileName })
      const absence = await createAbsence(w.dirA.token, { contractId: w.ctA.id, typeCode, justificatifIds: [piece.id] })
      expect(absence.status).toBe(201)
      return { piece, absence: absence.body }
    }

    it('[rule-evp-piece-read-link] [rule-evp-piece-open-audited] the link is valid 60 seconds, serves the stored bytes, and the opening is traced with the dossier and the author', async () => {
      const { piece, absence } = await attached('ENFANT_MALADE')
      const res = await POST(`/justificatifs/${piece.id}/read-link`, w.dirA.token)
      expect(res.status).toBe(200)
      expect(sortedKeys(res.body)).toEqual(['expiresAt', 'url'])
      const ttl = Date.parse(res.body.expiresAt) - Date.now()
      expect(ttl).toBeGreaterThan(40 * 1000)
      expect(ttl).toBeLessThanOrEqual(60 * 1000 + 5000)
      const file = await fetch(new URL(res.body.url, API_URL))
      expect(file.status).toBe(200)
      expect(Buffer.from(await file.arrayBuffer()).equals(piece.bytes)).toBe(true)
      const entries = await auditRows('justificatifs:read-link')
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ actor_id: w.dirA.id })
      const journal = (await GET('/journal-entries?operation=justificatifs:read-link', w.rh.token)).body
      expect(journal.items).toHaveLength(1)
      expect(journal.items[0]).toMatchObject({ operationLabel: 'Ouverture de justificatif', absenceId: absence.id, actorName: w.dirA.name })
    })

    it('[rule-evp-piece-read-link] each opening issues a new short-lived link and is traced once', async () => {
      const { piece } = await attached('ENFANT_MALADE')
      const first = await POST(`/justificatifs/${piece.id}/read-link`, w.dirA.token)
      const second = await POST(`/justificatifs/${piece.id}/read-link`, w.rh.token)
      expect(first.body.url).not.toBe(second.body.url)
      expect(await auditCount('justificatifs:read-link')).toBe(2)
    })

    it('[rule-evp-detail-private-piece] [rule-evp-piece-scope] a non-private piece can be opened by every account of the perimeter, global roles included', async () => {
      const { piece, absence } = await attached('ENFANT_MALADE')
      for (const who of [w.dirA, w.roA, w.rh, w.adm, w.sup]) {
        expect((await POST(`/justificatifs/${piece.id}/read-link`, who.token)).status).toBe(200)
        const detail = (await GET(`/absences/${absence.id}`, who.token)).body
        expect(detail.pieces[0]).toMatchObject({ id: piece.id, privatePiece: false, canOpen: true })
      }
    })

    it('[rule-evp-detail-private-piece] a private piece (sick leave notice) opens for RH, SUPERADMIN and its depositor only; others get 403 justificatifs.private_piece and canOpen false', async () => {
      const { piece, absence } = await attached('ARRET_MALADIE', w.roA, 'pdf', 'avis-arret-secret.pdf')
      for (const who of [w.rh, w.sup, w.roA]) {
        expect((await POST(`/justificatifs/${piece.id}/read-link`, who.token)).status).toBe(200)
        expect((await GET(`/absences/${absence.id}`, who.token)).body.pieces[0]).toMatchObject({ privatePiece: true, canOpen: true })
      }
      for (const who of [w.dirA, w.adm]) {
        const res = await POST(`/justificatifs/${piece.id}/read-link`, who.token)
        expect(res.status).toBe(403)
        expect(res.body.code).toBe('justificatifs.private_piece')
        expect((await GET(`/absences/${absence.id}`, who.token)).body.pieces[0]).toMatchObject({ privatePiece: true, canOpen: false })
      }
      expect(await auditCount('justificatifs:read-link')).toBe(3)
    })

    it('[rule-evp-piece-no-medical-in-logs] [rule-evp-journal-no-medical] the name of a private piece appears neither in the audit summary, nor in the journal, nor in the server log', async () => {
      const offset = logSize()
      const { piece } = await attached('ARRET_MALADIE', w.roA, 'pdf', 'avis-arret-confidentiel.pdf')
      await POST(`/justificatifs/${piece.id}/read-link`, w.rh.token)
      expect(JSON.stringify(await sql('select summary from base.audit_logs'))).not.toContain('avis-arret-confidentiel')
      expect((await GET('/journal-entries?size=50', w.rh.token)).text).not.toContain('avis-arret-confidentiel')
      expect(JSON.stringify(await sql('select e::text as t from base.absence_events e'))).not.toContain('avis-arret-confidentiel')
      expect(logSince(offset)).not.toContain('avis-arret-confidentiel')
    })

    it('[rule-evp-piece-read-link] a piece not yet confirmed is 409 justificatifs.not_confirmed and traces nothing', async () => {
      const auth = await authorizeUpload(w.dirA.token, { sizeBytes: 100 })
      const res = await POST(`/justificatifs/${auth.body.id}/read-link`, w.dirA.token)
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('justificatifs.not_confirmed')
      expect(await auditCount('justificatifs:read-link')).toBe(0)
    })

    it('[rule-evp-piece-scope] a piece of another crèche is 404, byte for byte the same as an unknown piece; anonymous 401; malformed id 400', async () => {
      const { piece } = await attached('ENFANT_MALADE')
      for (const who of [w.dirB, w.roB]) {
        const foreign = await POST(`/justificatifs/${piece.id}/read-link`, who.token)
        const unknown = await POST(`/justificatifs/${UNKNOWN_UUID}/read-link`, who.token)
        expect(foreign.status).toBe(404)
        expect(foreign.body).toEqual(unknown.body)
      }
      expect((await POST(`/justificatifs/${piece.id}/read-link`)).status).toBe(401)
      expect((await POST('/justificatifs/xyz/read-link', w.rh.token)).status).toBe(400)
      expect(await auditCount('justificatifs:read-link')).toBe(0)
    })
  })

  // ───────────────────────────── nettoyage ─────────────────────────────
  describe('opportunistic clean-up', () => {
    it('[rule-evp-piece-unattached-cleanup] confirmed unattached pieces older than 24 hours and expired deposits are purged from storage after the next authorization; fresh and attached ones are kept', async () => {
      const old = await uploadPiece(w.dirA.token, { marker: marker() })
      const recent = await uploadPiece(w.dirA.token, { marker: marker() })
      const attachedPiece = await uploadPiece(w.dirA.token, { marker: marker() })
      await createAbsence(w.dirA.token, { contractId: w.ctA.id, justificatifIds: [attachedPiece.id] })
      const expiredBytes = PDF_BYTES(marker())
      const expired = await authorizeUpload(w.dirA.token, { sizeBytes: expiredBytes.length })
      await putBytes(expired.body, expiredBytes, 'application/pdf')
      const oldMarker = old.bytes.toString().match(/% ([0-9a-f]+)/)![1]
      const recentMarker = recent.bytes.toString().match(/% ([0-9a-f]+)/)![1]
      const attachedMarker = attachedPiece.bytes.toString().match(/% ([0-9a-f]+)/)![1]
      const expiredMarker = expiredBytes.toString().match(/% ([0-9a-f]+)/)![1]
      await sql("update base.absence_pieces set created_at = now() - interval '25 hours', confirmed_at = now() - interval '25 hours' where id = $1", [old.id])
      await sql("update base.absence_pieces set created_at = now() - interval '2 hours', confirmed_at = now() - interval '2 hours' where id = $1", [recent.id])
      await sql("update base.absence_pieces set created_at = now() - interval '25 hours', confirmed_at = now() - interval '25 hours' where id = $1", [attachedPiece.id])
      await sql("update base.absence_pieces set upload_expires_at = now() - interval '2 hours', created_at = now() - interval '2 hours' where id = $1", [expired.body.id])
      expect(storageFilesContaining(oldMarker).length).toBeGreaterThan(0)

      await authorizeUpload(w.dirA.token, { sizeBytes: 10 })

      const status = async (id: string) => (await sql('select status from base.absence_pieces where id = $1', [id]))[0].status
      expect(await status(old.id)).toBe('PURGED')
      expect(storageFilesContaining(oldMarker)).toHaveLength(0)
      expect(await status(expired.body.id)).toBe('PURGED')
      expect(storageFilesContaining(expiredMarker)).toHaveLength(0)
      expect(await status(recent.id)).toBe('CONFIRMED')
      expect(storageFilesContaining(recentMarker)).toHaveLength(1)
      expect(await status(attachedPiece.id)).toBe('CONFIRMED')
      expect(storageFilesContaining(attachedMarker)).toHaveLength(1)
    })

    it('[rule-evp-piece-unattached-cleanup] a purged piece can no longer be opened (409 not_confirmed) and a refused authorization does not break the clean-up', async () => {
      const old = await uploadPiece(w.dirA.token)
      await sql("update base.absence_pieces set created_at = now() - interval '30 hours', confirmed_at = now() - interval '30 hours' where id = $1", [old.id])
      await authorizeUpload(w.dirA.token, { sizeBytes: 10 })
      const res = await POST(`/justificatifs/${old.id}/read-link`, w.rh.token)
      expect([404, 409]).toContain(res.status)
      expect(res.status).not.toBe(200)
    })
  })

  describe('write routes', () => {
    it('[rule-evp-piece-read-link] no permanent public link exists: there is no route to list, download or delete a piece', async () => {
      const piece = await uploadPiece(w.dirA.token)
      for (const [method, path] of [
        ['GET', `/justificatifs/${piece.id}`], ['GET', `/justificatifs/${piece.id}/download`], ['DELETE', `/justificatifs/${piece.id}`],
        ['GET', '/justificatifs'], ['PUT', `/justificatifs/${piece.id}`],
      ] as const) {
        expect((await http(method, path, { token: w.rh.token })).status).toBe(404)
      }
      expect(await countRows('absence_pieces')).toBe(1)
    })
  })
})
