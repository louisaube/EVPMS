import { Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { and, eq, isNull, lt, or } from 'drizzle-orm'
import { Database, InjectDb } from '../../platform/database/database.module'
import { ApiError, notFound, scopeAccessDenied, validationFailed } from '../../platform/http/errors'
import { auditLogs } from '../audit/audit.tables'
import { computeBlockages, pieceCounts, statusFor } from '../absences/absence-checks'
import { absenceTypes, absences } from '../absences/absences.tables'
import { creches } from '../creches/creches.tables'
import { recordEvent } from '../evp-core/absence-log'
import type { EvpAccess } from '../evp-core/evp.types'
import { PieceStorage } from './piece-storage'
import {
  AuthorizeUploadBody,
  READ_TTL_SECONDS,
  UPLOAD_TTL_SECONDS,
} from './justificatifs.schemas'
import { absencePieces } from './justificatifs.tables'

const MAX_PER_DOSSIER = 5
const HOUR = 3_600_000

/** First bytes of a genuine file of each accepted type (rule-evp-attach-formats). */
const SIGNATURES: Record<string, number[]> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
}

const conflict = (code: string, message: string): ApiError => new ApiError(409, code, message)

@Injectable()
export class JustificatifsService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly storage: PieceStorage,
  ) {}

  /** rule-evp-attach-temp-upload, rule-evp-piece-scope: a 5-minute signed deposit URL; only metadata is stored. */
  async authorize(evp: EvpAccess, body: AuthorizeUploadBody) {
    let crecheCode = body.crecheCode
    if (!crecheCode && body.absenceId) {
      const [dossier] = await this.db.select({ crecheCode: absences.crecheCode }).from(absences).where(eq(absences.id, body.absenceId))
      if (!dossier) throw notFound()
      crecheCode = dossier.crecheCode
    }
    if (!crecheCode && evp.scope === 'ASSIGNED' && evp.creches.length === 1) crecheCode = evp.creches[0].code
    if (!crecheCode) throw validationFailed([{ path: 'body.crecheCode', message: 'The crèche is required' }])
    // the resolved crèche is written back to the validated body, so that the audit entry carries its scope
    body.crecheCode = crecheCode

    if (evp.scope === 'ASSIGNED' && !evp.creches.some((creche) => creche.code === crecheCode)) throw scopeAccessDenied()
    const [creche] = await this.db.select({ code: creches.code }).from(creches).where(eq(creches.code, crecheCode))
    if (!creche) throw scopeAccessDenied()
    if (body.absenceId) {
      const [dossier] = await this.db
        .select({ id: absences.id })
        .from(absences)
        .where(and(eq(absences.id, body.absenceId), eq(absences.crecheCode, crecheCode)))
      if (!dossier) throw notFound()
    }
    const id = randomUUID()
    const key = `deposit/${crecheCode}/${id}`
    const expiresAt = new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000)
    await this.db.insert(absencePieces).values({
      id,
      crecheCode,
      scopeCode: crecheCode,
      absenceId: body.absenceId ?? null,
      uploadedBy: evp.userId,
      fileName: body.fileName,
      contentType: body.contentType,
      announcedSize: body.sizeBytes,
      storageKey: key,
      uploadExpiresAt: expiresAt,
    })
    const ticket = this.storage.presignPut(key, body.contentType, body.sizeBytes, UPLOAD_TTL_SECONDS)
    return { id, method: ticket.method, uploadUrl: ticket.url, headers: ticket.headers, expiresAt: expiresAt.toISOString() }
  }

  /**
   * rule-evp-attach-copy-out, rule-evp-attach-single-confirm: the checks run in a fixed order (expiry, presence, size,
   * signature, count under the lock of the dossier), then the bytes leave the deposit zone and the piece is confirmed.
   */
  async confirm(evp: EvpAccess, id: string) {
    const [piece] = await this.db.select().from(absencePieces).where(eq(absencePieces.id, id)).for('update')
    if (!piece) throw notFound()
    const shape = (size: number) => ({ id: piece.id, name: piece.fileName, sizeBytes: size, confirmed: true as const })
    if (piece.status === 'CONFIRMED') return shape(piece.sizeBytes ?? piece.announcedSize)
    if (piece.status === 'PURGED' || piece.uploadExpiresAt.getTime() < Date.now()) {
      throw conflict('justificatifs.upload_expired', 'The deposit window of this piece has expired')
    }
    const head = await this.storage.head(piece.storageKey)
    if (!head) throw conflict('justificatifs.not_uploaded', 'No file was deposited for this piece')
    if (head.size !== piece.announcedSize) {
      await this.storage.remove(piece.storageKey)
      throw conflict('justificatifs.size_mismatch', 'The deposited file does not have the announced size')
    }
    const signature = SIGNATURES[piece.contentType] ?? []
    const start = await this.storage.readStart(piece.storageKey, signature.length)
    if (signature.length === 0 || !signature.every((byte, index) => start[index] === byte)) {
      await this.storage.remove(piece.storageKey)
      throw conflict('justificatifs.signature_mismatch', 'The deposited file is not of the announced type')
    }

    if (piece.absenceId) {
      await this.db.select({ id: absences.id }).from(absences).where(eq(absences.id, piece.absenceId)).for('update')
      const counts = await pieceCounts(this.db, piece.absenceId)
      if (counts.confirmed >= MAX_PER_DOSSIER) {
        throw conflict('justificatifs.too_many', 'A dossier holds at most 5 supporting documents')
      }
    }

    const finalKey = `final/${piece.crecheCode}/${piece.id}`
    await this.storage.copy(piece.storageKey, finalKey)
    await this.storage.remove(piece.storageKey)
    const now = new Date()
    await this.db
      .update(absencePieces)
      .set({ status: 'CONFIRMED', sizeBytes: head.size, finalKey, confirmedAt: now })
      .where(eq(absencePieces.id, id))
    if (piece.absenceId) await this.attach(evp, piece.absenceId, piece.id, now)
    return shape(head.size)
  }

  /** rule-evp-attach-attached-on-confirm: attach, trace without the file name, replay the controls of a dossier to complete. */
  private async attach(evp: EvpAccess, absenceId: string, pieceId: string, at: Date): Promise<void> {
    const [dossier] = await this.db.select().from(absences).where(eq(absences.id, absenceId))
    if (!dossier) return
    const [type] = await this.db
      .select({ privatePiece: absenceTypes.privatePiece })
      .from(absenceTypes)
      .where(eq(absenceTypes.code, dossier.typeCode))
    await this.db
      .update(absencePieces)
      .set({ attachedAt: at, privatePiece: type?.privatePiece ?? false })
      .where(eq(absencePieces.id, pieceId))
    await recordEvent(this.db, { absenceId, kind: 'PIECE', text: 'Justificatif ajouté', byUserId: evp.userId })
    if (dossier.status !== 'A_COMPLETER') return
    const counts = await pieceCounts(this.db, absenceId)
    const blockages = await computeBlockages(this.db, {
      absenceId,
      crecheCode: dossier.crecheCode,
      contractId: dossier.contractId,
      typeCode: dossier.typeCode,
      startDate: dossier.startDate,
      startHalf: dossier.startHalf,
      endDate: dossier.endDate,
      endHalf: dossier.endHalf,
      confirmedPieces: counts.confirmed,
      unconfirmedPieces: counts.unconfirmed,
    })
    await this.db
      .update(absences)
      .set({ blockages, status: statusFor(blockages, dossier.startDate), updatedAt: at })
      .where(eq(absences.id, absenceId))
  }

  /**
   * rule-evp-piece-read-link, rule-evp-detail-private-piece, rule-evp-piece-open-audited: a link valid 60 seconds. The
   * opening is traced here (one entry, the dossier as object when the piece is attached), never with the file name.
   */
  async readLink(evp: EvpAccess, id: string) {
    const [piece] = await this.db.select().from(absencePieces).where(eq(absencePieces.id, id))
    if (!piece) throw notFound()
    if (piece.status !== 'CONFIRMED' || !piece.finalKey) {
      throw conflict('justificatifs.not_confirmed', 'This piece is not confirmed')
    }
    const privileged = evp.role === 'RH' || evp.role === 'SUPERADMIN'
    if (piece.privatePiece && !privileged && piece.uploadedBy !== evp.userId) {
      throw new ApiError(403, 'justificatifs.private_piece', 'This piece is private')
    }
    const expiresAt = new Date(Date.now() + READ_TTL_SECONDS * 1000)
    const url = this.storage.presignGet(piece.finalKey, piece.contentType, READ_TTL_SECONDS)
    await this.db.insert(auditLogs).values({
      actorId: evp.userId,
      actorEmail: evp.email,
      action: 'justificatifs:read-link',
      objectType: 'Justificatif',
      objectId: piece.absenceId ?? piece.id,
      scopeCode: piece.crecheCode,
      summary: piece.absenceId ? 'Ouverture d’un justificatif d’un dossier d’absence' : 'Ouverture d’un justificatif',
    })
    return { url, expiresAt: expiresAt.toISOString() }
  }

  /**
   * rule-evp-piece-unattached-cleanup: confirmed pieces left unattached for 24 hours and deposits expired for an hour
   * are purged from the storage. Runs as the connection role, outside the request, and never fails the request.
   */
  async cleanup(): Promise<void> {
    try {
      const now = Date.now()
      const stale = await this.db
        .select()
        .from(absencePieces)
        .where(
          or(
            and(eq(absencePieces.status, 'CONFIRMED'), isNull(absencePieces.absenceId), lt(absencePieces.confirmedAt, new Date(now - 24 * HOUR))),
            and(eq(absencePieces.status, 'AUTHORIZED'), lt(absencePieces.uploadExpiresAt, new Date(now - HOUR))),
          ),
        )
      for (const piece of stale) {
        await this.storage.remove(piece.storageKey)
        if (piece.finalKey) await this.storage.remove(piece.finalKey)
        await this.db.update(absencePieces).set({ status: 'PURGED' }).where(eq(absencePieces.id, piece.id))
      }
    } catch {
      // the clean-up is opportunistic: the next authorization tries again
    }
  }
}
