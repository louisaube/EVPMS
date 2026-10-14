import { and, eq, inArray, ne, notInArray, sql } from 'drizzle-orm'
import type { Database } from '../../platform/database/database.module'
import { NON_BLOCKING_STATUSES } from '../sources/payfit-status'
import { payfitAbsences, payfitCompanies, payfitContracts } from '../sources/sources.tables'
import { creches } from '../creches/creches.tables'
import { absenceTypes, absences } from './absences.tables'
import { absencePieces } from '../justificatifs/justificatifs.tables'
import { todayParis } from '../evp-core/payroll-month'
import type { AbsenceStatusName } from './absences.schemas'

export interface Blockage {
  code: string
  message: string
}

export interface Period {
  startDate: string
  startHalf: string
  endDate: string
  endHalf: string
}

export const INACTIVE_STATUSES = ['REJETEE', 'ANNULEE'] as const

const MESSAGES: Record<string, string> = {
  creche_contract_mismatch: 'Le contrat n’appartient pas à la société de cette crèche.',
  outside_contract_period: 'La période déborde de la durée du contrat.',
  overlap_evp: 'Un autre dossier couvre déjà une partie de cette période.',
  overlap_payfit: 'Une absence existe déjà dans PayFit sur cette période.',
  piece_missing: 'Le justificatif attendu pour ce type d’absence est manquant.',
  piece_not_confirmed: 'Le justificatif attendu n’est pas encore confirmé.',
  absence_not_found: 'Dossier introuvable.',
}
export const blockage = (code: string): Blockage => ({ code, message: MESSAGES[code] ?? code })

/** Half-day slot number: two slots per day. */
export function slotOf(day: string, half: string): number {
  const days = Math.floor(new Date(`${day}T00:00:00Z`).getTime() / 86_400_000)
  return days * 2 + (half === 'APRES_MIDI' ? 1 : 0)
}

export function periodsOverlap(a: Period, b: Period): boolean {
  return slotOf(a.startDate, a.startHalf) <= slotOf(b.endDate, b.endHalf) && slotOf(b.startDate, b.startHalf) <= slotOf(a.endDate, a.endHalf)
}

export interface CheckInput extends Period {
  /** The dossier being recomputed; excluded from the overlap with the other dossiers. */
  absenceId?: string
  crecheCode: string
  contractId: string
  typeCode: string
  /** Confirmed pieces attached (or about to be attached) to the dossier. */
  confirmedPieces: number
  unconfirmedPieces?: number
}

/**
 * rule-evp-declare-checks, rule-evp-declare-overlap-blocks (an EVP or PayFit overlap blocks the completeness, it never
 * refuses the declaration), rule-evp-declare-no-auto-anticipation (nothing here runs on a schedule: only a submission or
 * an edit replays the controls). rule-evp-controls-blockages: the controls, in a stable order. A dossier with a blockage is to complete; the
 * controls are replayed at each submission and at each validation.
 */
export async function computeBlockages(db: Database, input: CheckInput): Promise<Blockage[]> {
  const found: Blockage[] = []
  const [contract] = await db
    .select({
      companyId: payfitContracts.companyId,
      payfitContractId: payfitContracts.payfitContractId,
      startDate: payfitContracts.startDate,
      endDate: payfitContracts.endDate,
    })
    .from(payfitContracts)
    .where(eq(payfitContracts.id, input.contractId))
  const [creche] = await db.select({ siret: creches.siret }).from(creches).where(eq(creches.code, input.crecheCode))
  if (!contract || !creche) return [blockage('creche_contract_mismatch')]

  const companies = await db.select({ id: payfitCompanies.id }).from(payfitCompanies).where(eq(payfitCompanies.siret, creche.siret))
  if (companies.length !== 1 || companies[0].id !== contract.companyId) found.push(blockage('creche_contract_mismatch'))

  if (input.startDate < contract.startDate || (contract.endDate && input.endDate > contract.endDate)) {
    found.push(blockage('outside_contract_period'))
  }

  const others = await db
    .select({ startDate: absences.startDate, startHalf: absences.startHalf, endDate: absences.endDate, endHalf: absences.endHalf })
    .from(absences)
    .where(
      and(
        eq(absences.contractId, input.contractId),
        notInArray(absences.status, [...INACTIVE_STATUSES]),
        input.absenceId ? ne(absences.id, input.absenceId) : undefined,
        sql`${absences.startDate} <= ${input.endDate}::date and ${absences.endDate} >= ${input.startDate}::date`,
      ),
    )
  if (others.some((other) => periodsOverlap(input, other))) found.push(blockage('overlap_evp'))

  const observed = await db
    .select({ startDate: payfitAbsences.startDate, startHalf: payfitAbsences.startHalf, endDate: payfitAbsences.endDate, endHalf: payfitAbsences.endHalf })
    .from(payfitAbsences)
    .where(
      and(
        eq(payfitAbsences.companyId, contract.companyId),
        eq(payfitAbsences.contractId, contract.payfitContractId),
        // rule-evp-payfit-status-admissible: a cancelled or declined absence blocks nothing (both vocabularies)
        notInArray(payfitAbsences.status, [...NON_BLOCKING_STATUSES]),
        sql`${payfitAbsences.startDate} <= ${input.endDate}::date and ${payfitAbsences.endDate} >= ${input.startDate}::date`,
      ),
    )
  // a half-day PayFit could not interpret (null) is taken at its widest: the whole first and last day
  if (observed.some((other) => periodsOverlap(input, { ...other, startHalf: other.startHalf ?? 'MATIN', endHalf: other.endHalf ?? 'APRES_MIDI' }))) {
    found.push(blockage('overlap_payfit'))
  }

  const [type] = await db.select({ expectedPiece: absenceTypes.expectedPiece }).from(absenceTypes).where(eq(absenceTypes.code, input.typeCode))
  if (type?.expectedPiece) {
    if (input.confirmedPieces === 0) found.push(blockage((input.unconfirmedPieces ?? 0) > 0 ? 'piece_not_confirmed' : 'piece_missing'))
  }
  return found
}

/** rule-evp-states: blockages → to complete; start in the future → anticipated; otherwise to validate. */
export function statusFor(blockages: Blockage[], startDate: string): AbsenceStatusName {
  if (blockages.length > 0) return 'A_COMPLETER'
  return startDate > todayParis() ? 'ANTICIPEE' : 'A_VALIDER'
}

/** Confirmed and unconfirmed pieces attached to a dossier. */
export async function pieceCounts(db: Database, absenceId: string): Promise<{ confirmed: number; unconfirmed: number }> {
  const rows = await db
    .select({ status: absencePieces.status })
    .from(absencePieces)
    .where(and(eq(absencePieces.absenceId, absenceId), inArray(absencePieces.status, ['AUTHORIZED', 'CONFIRMED'])))
  const confirmed = rows.filter((row) => row.status === 'CONFIRMED').length
  return { confirmed, unconfirmed: rows.length - confirmed }
}
