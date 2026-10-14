import { Injectable } from '@nestjs/common'
import { and, asc, desc, eq, gte, inArray, lte, ne, notInArray, sql, SQL } from 'drizzle-orm'
import { fieldNames } from '../../platform/audit/audit-text'
import { Database, InjectDb } from '../../platform/database/database.module'
import { ApiError, isUniqueViolation, notFound, scopeAccessDenied, validationFailed } from '../../platform/http/errors'
import { auditLogs } from '../audit/audit.tables'
import { creches } from '../creches/creches.tables'
import { DetailedApiError } from '../evp-core/evp-errors'
import type { EvpAccess } from '../evp-core/evp.types'
import { recordEvent } from '../evp-core/absence-log'
import { payrollMonth, todayParis } from '../evp-core/payroll-month'
import { absencePieces } from '../justificatifs/justificatifs.tables'
import { payfitCompanies, payfitContracts } from '../sources/sources.tables'
import { blockage, Blockage, computeBlockages, INACTIVE_STATUSES, pieceCounts, statusFor } from './absence-checks'
import {
  AbsenceRow,
  allowedActionsFor,
  openAlertIds,
  OPEN_STATUSES,
  selectRows,
  toDetail,
  toSummary,
} from './absence-shapes'
import {
  ABSENCE_TYPE_CODES,
  AbsenceAction,
  AbsenceDetail,
  AbsencesListQuery,
  CreateAbsenceBody,
  periodIsOrdered,
  TodoQuery,
  UpdateAbsenceBody,
} from './absences.schemas'
import { absenceEvents, absenceTypes, absences } from './absences.tables'
import { slotOf } from './absence-checks'

export type Decision = 'submit' | 'validate' | 'return' | 'reject' | 'cancel' | 'mark-entered'

const ACTION_OF: Record<Decision, AbsenceAction> = {
  submit: 'SUBMIT',
  validate: 'VALIDATE',
  return: 'RETURN',
  reject: 'REJECT',
  cancel: 'CANCEL',
  'mark-entered': 'MARK_ENTERED',
}

/** French names of the fields of an edit, in display order (the journal lists names, never values). */
export const UPDATE_FIELD_LABELS: Record<string, string> = {
  typeCode: 'type',
  startDate: 'date de début',
  startHalf: 'demi-journée de début',
  endDate: 'date de fin',
  endHalf: 'demi-journée de fin',
  comment: 'motif administratif',
}

const decisionNotAllowed = (): ApiError =>
  new ApiError(409, 'absences.decision_not_allowed', 'This action is not allowed in the current state of the dossier')

const EDITABLE = ['A_COMPLETER', 'ANTICIPEE', 'A_VALIDER', 'A_SAISIR']

@Injectable()
export class AbsencesService {
  constructor(@InjectDb() private readonly db: Database) {}

  async types() {
    const rows = await this.db
      .select({
        code: absenceTypes.code,
        label: absenceTypes.label,
        expectedPiece: absenceTypes.expectedPiece,
        privatePiece: absenceTypes.privatePiece,
        hrReview: absenceTypes.hrReview,
      })
      .from(absenceTypes)
    const rank = (code: string) => ABSENCE_TYPE_CODES.indexOf(code as (typeof ABSENCE_TYPE_CODES)[number])
    return { items: rows.sort((a, b) => rank(a.code) - rank(b.code)) }
  }

  /** rule-evp-list-scope: the perimeter is enforced by the database; a foreign or unknown crèche filter is a 404. */
  async list(evp: EvpAccess, query: AbsencesListQuery) {
    const filters: (SQL | undefined)[] = []
    // rule-evp-list-scope: the filter narrows the perimeter, never widens it (a foreign crèche gives an empty list)
    if (query.crecheCode) filters.push(eq(absences.crecheCode, query.crecheCode))
    if (query.status) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status]
      filters.push(inArray(absences.status, statuses))
    }
    if (query.open === true) filters.push(inArray(absences.status, OPEN_STATUSES))
    if (query.open === false) filters.push(notInArray(absences.status, OPEN_STATUSES))
    if (query.from) filters.push(gte(absences.endDate, query.from))
    if (query.to) filters.push(lte(absences.startDate, query.to))
    if (query.payrollMonth) filters.push(eq(absences.payrollMonth, query.payrollMonth))
    const rows = await selectRows(this.db, and(...filters), {
      limit: 201,
      order: [desc(absences.createdAt), desc(absences.id)],
    })
    const kept = rows.slice(0, 200)
    const alerts = await openAlertIds(this.db, kept.map((row) => row.a.id))
    return { items: kept.map((row) => toSummary(row, evp, alerts.has(row.a.id))), truncated: rows.length > 200 }
  }

  async get(evp: EvpAccess, id: string): Promise<AbsenceDetail> {
    const [row] = await selectRows(this.db, eq(absences.id, id))
    if (!row) throw notFound()
    return toDetail(this.db, row, evp)
  }

  private async lock(id: string): Promise<AbsenceRow> {
    const [locked] = await this.db.select({ id: absences.id }).from(absences).where(eq(absences.id, id)).for('update')
    if (!locked) throw notFound()
    const [row] = await selectRows(this.db, eq(absences.id, id))
    if (!row) throw notFound()
    return row
  }

  private async findActiveExact(input: {
    contractId: string
    typeCode: string
    startDate: string
    startHalf: string
    endDate: string
    endHalf: string
    exceptId?: string
  }): Promise<string | null> {
    const [found] = await this.db
      .select({ id: absences.id })
      .from(absences)
      .where(
        and(
          eq(absences.contractId, input.contractId),
          eq(absences.typeCode, input.typeCode),
          eq(absences.startDate, input.startDate),
          eq(absences.startHalf, input.startHalf as 'MATIN'),
          eq(absences.endDate, input.endDate),
          eq(absences.endHalf, input.endHalf as 'MATIN'),
          notInArray(absences.status, [...INACTIVE_STATUSES]),
          input.exceptId ? ne(absences.id, input.exceptId) : undefined,
        ),
      )
    return found?.id ?? null
  }

  /**
   * rule-evp-declare-create: the declaration of an absence. A crèche outside the perimeter is 403, an unknown contract 404,
   * a contract of another company 409; an exact active duplicate answers 200 with the existing dossier.
   */
  async create(evp: EvpAccess, body: CreateAbsenceBody): Promise<{ duplicate: boolean; absence: AbsenceDetail }> {
    if (evp.scope === 'ASSIGNED' && !evp.creches.some((creche) => creche.code === body.crecheCode)) throw scopeAccessDenied()
    const [creche] = await this.db
      .select({ code: creches.code, siret: creches.siret })
      .from(creches)
      .where(eq(creches.code, body.crecheCode))
    if (!creche) throw scopeAccessDenied()

    const [contract] = await this.db
      .select({ id: payfitContracts.id, companyId: payfitContracts.companyId })
      .from(payfitContracts)
      .where(eq(payfitContracts.id, body.contractId))
    if (!contract) throw new ApiError(404, 'absences.contract_not_found', 'Unknown contract')
    const companies = await this.db.select({ id: payfitCompanies.id }).from(payfitCompanies).where(eq(payfitCompanies.siret, creche.siret))
    if (companies.length !== 1 || companies[0].id !== contract.companyId) {
      throw new ApiError(409, 'absences.creche_contract_mismatch', 'This contract does not belong to the company of the crèche')
    }

    const existing = await this.findActiveExact(body)
    if (existing) return { duplicate: true, absence: await this.get(evp, existing) }

    const pieceIds = body.justificatifIds ?? []
    if (pieceIds.length > 0) {
      const attachable = await this.db
        .select({ id: absencePieces.id })
        .from(absencePieces)
        .where(
          and(
            inArray(absencePieces.id, pieceIds),
            eq(absencePieces.crecheCode, body.crecheCode),
            eq(absencePieces.status, 'CONFIRMED'),
            sql`${absencePieces.absenceId} is null`,
          ),
        )
        .for('update')
      if (attachable.length !== pieceIds.length) {
        throw new ApiError(409, 'absences.piece_not_attachable', 'A piece is unknown, unconfirmed or already attached')
      }
    }

    const blockages = await computeBlockages(this.db, { ...body, confirmedPieces: pieceIds.length })
    const status = statusFor(blockages, body.startDate)
    const now = new Date()
    let inserted: { id: string }
    try {
      inserted = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(absences)
          .values({
            crecheCode: body.crecheCode,
            scopeCode: body.crecheCode,
            contractId: body.contractId,
            typeCode: body.typeCode,
            startDate: body.startDate,
            startHalf: body.startHalf,
            endDate: body.endDate,
            endHalf: body.endHalf,
            status,
            comment: body.comment ?? null,
            payrollMonth: payrollMonth(body.startDate, now),
            blockages,
            declaredBy: evp.userId,
            declaredAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: absences.id })
        return row
      })
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      const raced = await this.findActiveExact(body)
      if (!raced) throw error
      return { duplicate: true, absence: await this.get(evp, raced) }
    }

    if (pieceIds.length > 0) await this.attachPieces(inserted.id, pieceIds, body.typeCode, now)
    await recordEvent(this.db, { absenceId: inserted.id, kind: 'DECLARATION', text: 'Absence déclarée', byUserId: evp.userId })
    return { duplicate: false, absence: await this.get(evp, inserted.id) }
  }

  /** rule-evp-piece-private: the piece takes the privacy flag of the type of the dossier when it is attached. */
  private async attachPieces(absenceId: string, pieceIds: string[], typeCode: string, at: Date): Promise<void> {
    const [type] = await this.db.select({ privatePiece: absenceTypes.privatePiece }).from(absenceTypes).where(eq(absenceTypes.code, typeCode))
    await this.db
      .update(absencePieces)
      .set({ absenceId, attachedAt: at, privatePiece: type?.privatePiece ?? false })
      .where(inArray(absencePieces.id, pieceIds))
  }

  /** rule-evp-declare-edit-server: the state is recomputed on the server from the new values. */
  async update(evp: EvpAccess, id: string, body: UpdateAbsenceBody): Promise<AbsenceDetail> {
    const row = await this.lock(id)
    const a = row.a
    if (!EDITABLE.includes(a.status)) throw decisionNotAllowed()
    const merged = {
      typeCode: body.typeCode ?? a.typeCode,
      startDate: body.startDate ?? a.startDate,
      startHalf: body.startHalf ?? a.startHalf,
      endDate: body.endDate ?? a.endDate,
      endHalf: body.endHalf ?? a.endHalf,
    }
    if (!periodIsOrdered(merged)) {
      throw validationFailed([{ path: 'body.endDate', message: 'The end cannot precede the start' }])
    }
    if (await this.findActiveExact({ contractId: a.contractId, ...merged, exceptId: id })) {
      throw new ApiError(409, 'absences.duplicate_active', 'Another active dossier already covers this exact period')
    }
    const counts = await pieceCounts(this.db, id)
    const blockages = await computeBlockages(this.db, {
      ...merged,
      absenceId: id,
      crecheCode: a.crecheCode,
      contractId: a.contractId,
      confirmedPieces: counts.confirmed,
      unconfirmedPieces: counts.unconfirmed,
    })
    const now = new Date()
    try {
      await this.db.transaction(async (tx) => {
        await tx
          .update(absences)
          .set({
            ...merged,
            comment: body.comment !== undefined ? body.comment : a.comment,
            status: statusFor(blockages, merged.startDate),
            blockages,
            saisieDeclaree: false,
            payrollMonth: payrollMonth(merged.startDate, a.createdAt),
            updatedAt: now,
          })
          .where(eq(absences.id, id))
      })
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError(409, 'absences.duplicate_active', 'Another active dossier already covers this exact period')
      }
      throw error
    }
    if (merged.typeCode !== a.typeCode) {
      const [type] = await this.db.select({ privatePiece: absenceTypes.privatePiece }).from(absenceTypes).where(eq(absenceTypes.code, merged.typeCode))
      await this.db.update(absencePieces).set({ privatePiece: type?.privatePiece ?? false }).where(eq(absencePieces.absenceId, id))
    }
    await recordEvent(this.db, {
      absenceId: id,
      kind: 'MODIFICATION',
      text: `Dossier modifié (${fieldNames(Object.keys(body), UPDATE_FIELD_LABELS)})`,
      byUserId: evp.userId,
    })
    return this.get(evp, id)
  }

  /**
   * rule-evp-decision-states: the transitions. The row is locked, so that two concurrent decisions give one success and
   * one `decision_not_allowed`. Each decision writes one event of the timeline (the audit entry is written by the route).
   */
  async decide(evp: EvpAccess, id: string, kind: Decision, reason?: string): Promise<AbsenceDetail> {
    const row = await this.lock(id)
    const a = row.a
    if (!allowedActionsFor(a.status, evp).includes(ACTION_OF[kind])) throw decisionNotAllowed()

    const now = new Date()
    const decision = (name: string) => ({ kind: name, by: evp.userId, at: now.toISOString(), reason: reason ?? null })
    const set: Partial<typeof absences.$inferInsert> = { updatedAt: now }
    let event: { kind: string; text: string }

    const replay = async (): Promise<Blockage[]> => {
      const counts = await pieceCounts(this.db, id)
      return computeBlockages(this.db, {
        absenceId: id,
        crecheCode: a.crecheCode,
        contractId: a.contractId,
        typeCode: a.typeCode,
        startDate: a.startDate,
        startHalf: a.startHalf,
        endDate: a.endDate,
        endHalf: a.endHalf,
        confirmedPieces: counts.confirmed,
        unconfirmedPieces: counts.unconfirmed,
      })
    }

    switch (kind) {
      case 'submit': {
        const blockages = await replay()
        set.blockages = blockages
        set.status = statusFor(blockages, a.startDate)
        event = {
          kind: 'SOUMISSION',
          text: blockages.length > 0 ? 'Dossier soumis, des compléments restent nécessaires' : 'Dossier soumis',
        }
        break
      }
      case 'validate': {
        const blockages = await replay()
        if (blockages.length > 0) {
          throw new DetailedApiError(409, 'absences.validation_blocked', 'The controls block the validation', { blockages })
        }
        set.blockages = []
        set.status = 'A_SAISIR'
        set.lastDecision = decision('validate')
        event = { kind: 'VALIDATION', text: 'Dossier validé par les ressources humaines' }
        break
      }
      case 'return':
        set.status = 'A_COMPLETER'
        set.saisieDeclaree = false
        set.lastDecision = decision('return')
        event = { kind: 'RETOUR', text: 'Dossier renvoyé pour complément' }
        break
      case 'reject':
        set.status = 'REJETEE'
        set.saisieDeclaree = false
        set.lastDecision = decision('reject')
        event = { kind: 'REJET', text: 'Dossier rejeté' }
        break
      case 'cancel':
        set.status = 'ANNULEE'
        set.saisieDeclaree = false
        set.lastDecision = decision('cancel')
        event = { kind: 'ANNULATION', text: 'Dossier annulé' }
        break
      case 'mark-entered':
        set.saisieDeclaree = true
        event = { kind: 'SAISIE', text: 'Saisie déclarée dans PayFit' }
        break
    }
    // mark-entered is idempotent: the second call changes nothing and writes nothing
    if (kind === 'mark-entered' && a.saisieDeclaree) return toDetail(this.db, row, evp)

    await this.db.update(absences).set(set).where(eq(absences.id, id))
    await recordEvent(this.db, { absenceId: id, kind: event.kind, text: event.text, byUserId: evp.userId })
    return this.get(evp, id)
  }

  /**
   * rule-evp-batch-partial: each dossier is validated in its own savepoint; a blocked one is reported and does not
   * stop the others. One journal entry records the batch.
   */
  async validateBatch(evp: EvpAccess, ids: string[]) {
    const validated: { id: string; status: 'A_SAISIR' }[] = []
    const blocked: { id: string; employeeName: string | null; blockages: Blockage[] }[] = []
    for (const id of ids) {
      try {
        await this.db.transaction(async () => {
          await this.decide(evp, id, 'validate')
        })
        validated.push({ id, status: 'A_SAISIR' })
      } catch (error) {
        if (error instanceof DetailedApiError && error.code === 'absences.validation_blocked') {
          blocked.push({ id, employeeName: await this.employeeName(id), blockages: (error.info.blockages as Blockage[]) ?? [] })
        } else if (error instanceof ApiError && error.status === 404) {
          blocked.push({ id, employeeName: null, blockages: [blockage('absence_not_found')] })
        } else if (error instanceof ApiError && error.code === 'absences.decision_not_allowed') {
          blocked.push({
            id,
            employeeName: await this.employeeName(id),
            blockages: [{ code: 'decision_not_allowed', message: 'Le dossier n’est pas à valider.' }],
          })
        } else {
          throw error
        }
      }
    }
    if (validated.length > 0) {
      await this.db.insert(auditLogs).values({
        actorId: evp.userId,
        actorEmail: evp.email,
        action: 'absences:validate',
        objectType: 'Absence',
        objectId: 'lot',
        scopeCode: null,
        summary: `Validation par lot : ${validated.length} dossier(s) validé(s), ${blocked.length} bloqué(s)`,
      })
    }
    return { validated, blocked }
  }

  private async employeeName(id: string): Promise<string | null> {
    const [row] = await selectRows(this.db, eq(absences.id, id))
    return row ? `${row.firstName} ${row.lastName}` : null
  }

  /** rule-evp-todo-*: counters, priority dossiers (actionable first, then closest to today), recent activity. */
  async todo(evp: EvpAccess, query: TodoQuery) {
    const filters: (SQL | undefined)[] = []
    if (query.crecheCode) filters.push(eq(absences.crecheCode, query.crecheCode))
    if (query.from) filters.push(gte(absences.endDate, query.from))
    if (query.to) filters.push(lte(absences.startDate, query.to))

    const grouped = await this.db
      .select({ status: absences.status, n: sql<number>`count(*)::int` })
      .from(absences)
      .where(and(...filters))
      .groupBy(absences.status)
    const total = (...statuses: string[]) => grouped.filter((g) => statuses.includes(g.status)).reduce((sum, g) => sum + Number(g.n), 0)
    const counters = {
      aCompleter: { count: total('A_COMPLETER'), hint: 'Dossiers à compléter par la crèche' },
      enAttente: { count: total('A_VALIDER', 'ANTICIPEE', 'A_SAISIR'), hint: 'Dossiers en attente de validation, de début ou de saisie' },
      refusees: { count: total('REJETEE'), hint: 'Dossiers rejetés' },
    }

    const open = await selectRows(this.db, and(...filters, inArray(absences.status, OPEN_STATUSES)), {
      limit: 1000,
      order: [asc(absences.startDate), asc(absences.id)],
    })
    const alerts = await openAlertIds(this.db, open.map((row) => row.a.id))
    const summaries = open.map((row) => toSummary(row, evp, alerts.has(row.a.id)))
    const actionable = (s: (typeof summaries)[number]) =>
      (s.nextAction.actor === 'DECLARANT' && evp.capabilities.includes('absences:create')) ||
      ((s.nextAction.actor === 'RH' || s.nextAction.actor === 'LECTURE_PAYFIT') && evp.capabilities.includes('absences:decide'))
    const today = slotOf(todayParis(), 'MATIN')
    const distance = (s: (typeof summaries)[number]) => Math.abs(slotOf(s.startDate, 'MATIN') - today)
    const priority = summaries
      .sort((x, y) => Number(actionable(y)) - Number(actionable(x)) || distance(x) - distance(y) || x.id.localeCompare(y.id))
      .slice(0, 50)

    const events = await this.db
      .select({ absenceId: absenceEvents.absenceId, at: absenceEvents.at, text: absenceEvents.text })
      .from(absenceEvents)
      .innerJoin(absences, eq(absences.id, absenceEvents.absenceId))
      .where(and(...filters))
      .orderBy(desc(absenceEvents.at), desc(absenceEvents.id))
      .limit(10)
    return {
      counters,
      priority,
      recentActivity: events.map((e) => ({ absenceId: e.absenceId, at: e.at.toISOString(), text: e.text })),
    }
  }
}
