import { and, asc, eq, inArray, isNull, SQL } from 'drizzle-orm'
import type { Database } from '../../platform/database/database.module'
import { evpAccounts } from '../access/access.tables'
import { creches } from '../creches/creches.tables'
import type { EvpAccess } from '../evp-core/evp.types'
import { absencePieces } from '../justificatifs/justificatifs.tables'
import { payfitCompanies, payfitContracts, payfitEmployees } from '../sources/sources.tables'
import type { AbsenceAction, AbsenceDetail, AbsenceStatusName, AbsenceSummary } from './absences.schemas'
import type { Blockage } from './absence-checks'
import { absenceEvents, absenceTypes, absences, payfitAlerts, payfitProofs } from './absences.tables'

export const OPEN_STATUSES: AbsenceStatusName[] = ['A_COMPLETER', 'ANTICIPEE', 'A_VALIDER', 'A_SAISIR']

const ORDER: AbsenceAction[] = ['ATTACH', 'CANCEL', 'MARK_ENTERED', 'REJECT', 'RETURN', 'SUBMIT', 'VALIDATE']

/**
 * rule-evp-cancel-scope: CANCEL is offered to the declarants on the not-yet-validated states and to RH also on A_SAISIR.
 * rule-evp-detail-actions-from-api: the actions offered to the caller, computed on the server from the state and from
 * the capabilities (declaring: absences:create; deciding: absences:decide). Final states offer nothing.
 */
export function allowedActionsFor(status: AbsenceStatusName, evp: Pick<EvpAccess, 'capabilities'>): AbsenceAction[] {
  const declares = evp.capabilities.includes('absences:create')
  const decides = evp.capabilities.includes('absences:decide')
  const out = new Set<AbsenceAction>()
  const declarantSet: AbsenceAction[] = status === 'A_SAISIR' ? ['ATTACH'] : ['ATTACH', 'CANCEL', 'SUBMIT']
  const hrSet: Record<string, AbsenceAction[]> = {
    A_COMPLETER: ['REJECT'],
    ANTICIPEE: ['RETURN', 'REJECT'],
    A_VALIDER: ['REJECT', 'RETURN', 'VALIDATE'],
    A_SAISIR: ['ATTACH', 'CANCEL', 'MARK_ENTERED', 'REJECT', 'RETURN'],
  }
  if (!OPEN_STATUSES.includes(status)) return []
  if (declares) declarantSet.forEach((a) => out.add(a))
  if (decides) hrSet[status].forEach((a) => out.add(a))
  return ORDER.filter((a) => out.has(a))
}

export interface AbsenceRow {
  a: typeof absences.$inferSelect
  crecheName: string
  contract: typeof payfitContracts.$inferSelect
  firstName: string
  lastName: string
  companyName: string
  typeLabel: string
  expectedPiece: string | null
  typePayfitCode: string | null
  privateType: boolean
  declaredByName: string | null
}

/** One dossier with its crèche, contract, employee, company, type and declarant. RLS narrows the rows to the perimeter. */
export async function selectRows(
  db: Database,
  where: SQL | undefined,
  options: { limit?: number; order?: SQL[] } = {},
): Promise<AbsenceRow[]> {
  const query = db
    .select({
      a: absences,
      crecheName: creches.name,
      contract: payfitContracts,
      firstName: payfitEmployees.firstName,
      lastName: payfitEmployees.lastName,
      companyName: payfitCompanies.name,
      typeLabel: absenceTypes.label,
      expectedPiece: absenceTypes.expectedPiece,
      typePayfitCode: absenceTypes.payfitCode,
      privateType: absenceTypes.privatePiece,
      declaredByName: evpAccounts.name,
    })
    .from(absences)
    .innerJoin(creches, eq(creches.code, absences.crecheCode))
    .innerJoin(payfitContracts, eq(payfitContracts.id, absences.contractId))
    .innerJoin(
      payfitEmployees,
      and(eq(payfitEmployees.companyId, payfitContracts.companyId), eq(payfitEmployees.employeeId, payfitContracts.employeeId)),
    )
    .innerJoin(payfitCompanies, eq(payfitCompanies.id, payfitContracts.companyId))
    .innerJoin(absenceTypes, eq(absenceTypes.code, absences.typeCode))
    .leftJoin(evpAccounts, eq(evpAccounts.userId, absences.declaredBy))
    .where(where)
    .$dynamic()
  const ordered = options.order ? query.orderBy(...options.order) : query
  return (options.limit ? ordered.limit(options.limit) : ordered) as unknown as Promise<AbsenceRow[]>
}

export async function openAlertIds(db: Database, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const rows = await db
    .select({ absenceId: payfitAlerts.absenceId })
    .from(payfitAlerts)
    .where(and(inArray(payfitAlerts.absenceId, ids), isNull(payfitAlerts.resolvedAt)))
  return new Set(rows.map((row) => row.absenceId))
}

function nextAction(status: AbsenceStatusName, alert: boolean): AbsenceSummary['nextAction'] {
  if (alert) return { actor: 'RH', actorLabel: 'Ressources humaines', label: 'Examiner le changement constaté dans PayFit' }
  switch (status) {
    case 'A_COMPLETER':
      return { actor: 'DECLARANT', actorLabel: 'Crèche', label: 'Compléter le dossier' }
    case 'ANTICIPEE':
      return { actor: 'DECLARANT', actorLabel: 'Crèche', label: 'Attendre le début de l’absence puis soumettre le dossier' }
    case 'A_VALIDER':
      return { actor: 'RH', actorLabel: 'Ressources humaines', label: 'Valider le dossier' }
    case 'A_SAISIR':
      return { actor: 'LECTURE_PAYFIT', actorLabel: 'Lecture PayFit', label: 'Saisir l’absence dans PayFit' }
    default:
      return { actor: 'AUCUN', actorLabel: 'Aucun', label: 'Aucune action attendue' }
  }
}

export function toSummary(row: AbsenceRow, evp: EvpAccess, alert: boolean): AbsenceSummary {
  const a = row.a
  return {
    id: a.id,
    crecheCode: a.crecheCode,
    crecheName: row.crecheName,
    employeeName: `${row.firstName} ${row.lastName}`,
    contractLabel: `Contrat ${row.contract.payfitContractId}`,
    typeCode: a.typeCode,
    typeLabel: row.typeLabel,
    startDate: a.startDate,
    startHalf: a.startHalf,
    endDate: a.endDate,
    endHalf: a.endHalf,
    status: a.status,
    saisieDeclaree: a.saisieDeclaree,
    payrollMonth: a.payrollMonth,
    blockages: (a.blockages as Blockage[]) ?? [],
    nextAction: nextAction(a.status, alert),
    selectable: evp.capabilities.includes('absences:decide') && a.status === 'A_VALIDER',
    createdAt: a.createdAt.toISOString(),
  }
}

const PROGRESS: Record<AbsenceStatusName, { step: number; label: string }> = {
  A_COMPLETER: { step: 1, label: 'À compléter' },
  ANTICIPEE: { step: 2, label: 'Anticipée' },
  A_VALIDER: { step: 3, label: 'À valider' },
  A_SAISIR: { step: 4, label: 'À saisir dans PayFit' },
  DANS_PAYFIT: { step: 5, label: 'Dans PayFit' },
  REJETEE: { step: 1, label: 'Rejetée' },
  ANNULEE: { step: 1, label: 'Annulée' },
}

async function nameOf(db: Database, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null
  const [row] = await db.select({ name: evpAccounts.name }).from(evpAccounts).where(eq(evpAccounts.userId, userId))
  return row?.name ?? null
}

/** The full dossier: pieces, timeline, last decision, PayFit proof and open alert. */
export async function toDetail(db: Database, row: AbsenceRow, evp: EvpAccess): Promise<AbsenceDetail> {
  const a = row.a
  const [alertRow] = await db
    .select()
    .from(payfitAlerts)
    .where(and(eq(payfitAlerts.absenceId, a.id), isNull(payfitAlerts.resolvedAt)))
  const [proof] = await db.select().from(payfitProofs).where(eq(payfitProofs.absenceId, a.id))
  const pieceRows = await db
    .select({ p: absencePieces, uploader: evpAccounts.name })
    .from(absencePieces)
    .leftJoin(evpAccounts, eq(evpAccounts.userId, absencePieces.uploadedBy))
    .where(and(eq(absencePieces.absenceId, a.id), eq(absencePieces.status, 'CONFIRMED')))
    .orderBy(asc(absencePieces.createdAt), asc(absencePieces.id))
  const events = await db
    .select({ e: absenceEvents, byName: evpAccounts.name })
    .from(absenceEvents)
    .leftJoin(evpAccounts, eq(evpAccounts.userId, absenceEvents.byUserId))
    .where(eq(absenceEvents.absenceId, a.id))
    .orderBy(asc(absenceEvents.at), asc(absenceEvents.id))

  const decision = a.lastDecision as { kind: string; by: string | null; at: string; reason: string | null } | null
  const proofShape = (p: typeof proof) => ({
    company: p.companyName,
    code: p.code,
    sourceStatus: p.sourceStatus,
    observedAt: p.observedAt.toISOString(),
  })
  const privileged = evp.role === 'RH' || evp.role === 'SUPERADMIN'
  const summary = toSummary(row, evp, Boolean(alertRow))
  const progress = PROGRESS[a.status]
  return {
    ...summary,
    allowedActions: allowedActionsFor(a.status, evp),
    comment: a.comment,
    declaredAt: a.declaredAt.toISOString(),
    declaredBy: row.declaredByName ?? '',
    employee: {
      contractId: row.contract.id,
      payfitContractId: row.contract.payfitContractId,
      companyName: row.companyName,
      employeeName: summary.employeeName,
      startDate: row.contract.startDate,
      endDate: row.contract.endDate,
    },
    expectedPiece: row.expectedPiece,
    lastDecision: decision
      ? { kind: decision.kind, byName: (await nameOf(db, decision.by)) ?? '', at: decision.at, reason: decision.reason ?? null }
      : null,
    payfitAlert:
      alertRow && proof
        ? {
            kind: alertRow.kind as 'ANNULEE' | 'MODIFIEE' | 'DISPARUE',
            change: alertRow.change,
            observedAt: alertRow.observedAt.toISOString(),
            priorProof: { ...proofShape(proof), startDate: proof.startDate, endDate: proof.endDate },
          }
        : null,
    payfitCode: proof?.code ?? row.typePayfitCode,
    payfitProof: proof ? proofShape(proof) : null,
    pieces: pieceRows.map(({ p, uploader }) => ({
      id: p.id,
      name: p.fileName,
      sizeBytes: p.sizeBytes ?? p.announcedSize,
      confirmed: p.status === 'CONFIRMED',
      addedByName: uploader ?? '',
      canOpen: p.status === 'CONFIRMED' && (!p.privatePiece || privileged || p.uploadedBy === evp.userId),
      privatePiece: p.privatePiece,
    })),
    progress: { step: progress.step, total: 5, label: progress.label },
    timeline: [
      // a dossier that carries no stored declaration event (created outside the API) still starts with its declaration
      ...(events.some(({ e }) => e.kind === 'DECLARATION')
        ? []
        : [{ at: a.declaredAt.toISOString(), kind: 'DECLARATION', text: 'Absence déclarée', byName: row.declaredByName ?? null }]),
      ...events.map(({ e, byName }) => ({
        at: e.at.toISOString(),
        kind: e.kind,
        text: e.text,
        byName: byName ?? null,
      })),
    ],
  }
}
