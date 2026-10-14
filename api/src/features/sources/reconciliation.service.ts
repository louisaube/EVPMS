import { Injectable } from '@nestjs/common'
import { and, eq, gte, inArray, isNull } from 'drizzle-orm'
import { Database, InjectDb } from '../../platform/database/database.module'
import { absenceTypes, absences, payfitAlerts, payfitProofs } from '../absences/absences.tables'
import { auditLogs } from '../audit/audit.tables'
import { creches } from '../creches/creches.tables'
import { notifyCreche, NotificationKind, recordEvent } from '../evp-core/absence-log'
import { SYSTEM_ACTOR_EMAIL, SYSTEM_ACTOR_ID } from '../evp-core/system-actor'
import { normalisePayfitStatus } from './payfit-status'
import type { TypeMapping } from './payfit-types'
import { payfitAbsences, payfitCompanies, payfitContracts, payfitCoverage } from './sources.tables'

export { SYSTEM_ACTOR_EMAIL, SYSTEM_ACTOR_ID }

/** Coverage of the last reading of one company (rule-evp-sources-partial-failure). */
export interface Coverage {
  exhaustive: boolean
  windowStart: string
  windowEnd: string
}

/** Statuses of the observation that confirm a dossier: only `approved` (and `VALIDATED`, its v1 equivalent). */
const ADMISSIBLE = ['approved', 'VALIDATED']

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

const frDate = (day: string): string => day.split('-').reverse().join('/')

const TEXTS: Record<NotificationKind, { title: string; message: (from: string, to: string) => string }> = {
  CONFIRMATION: {
    title: 'Absence confirmée dans PayFit',
    message: (from, to) => `L’absence du ${from} au ${to} est confirmée dans PayFit.`,
  },
  MODIFICATION: {
    title: 'Absence modifiée dans PayFit',
    message: (from, to) => `L’absence du ${from} au ${to}, déjà confirmée, a été modifiée dans PayFit. Les ressources humaines vont l’examiner.`,
  },
  ANNULATION: {
    title: 'Absence annulée dans PayFit',
    message: (from, to) => `L’absence du ${from} au ${to}, déjà confirmée, a été annulée dans PayFit. Les ressources humaines vont l’examiner.`,
  },
  DISPARITION: {
    title: 'Absence introuvable dans PayFit',
    message: (from, to) => `L’absence du ${from} au ${to}, déjà confirmée, n’apparaît plus dans PayFit. Les ressources humaines vont l’examiner.`,
  },
  RESTAURATION: {
    title: 'Absence de nouveau conforme dans PayFit',
    message: (from, to) => `L’absence du ${from} au ${to} est de nouveau présente et conforme dans PayFit.`,
  },
}

/**
 * rule-evp-payfit-proof, rule-evp-payfit-alerts, rule-evp-payfit-atomic-confirmation: after each PayFit reading, the
 * dossiers « validée à saisir » are confirmed by an exact, unique and fresh observation, and the confirmed dossiers are
 * compared again with PayFit. Runs as the connection role, outside any request; one transaction and one row lock per
 * dossier, so that a failure on one dossier never affects another. Nothing is ever written to PayFit.
 */
@Injectable()
export class ReconciliationService {
  constructor(@InjectDb() private readonly db: Database) {}

  /** `mapping` is null with the fixtures: the codes of a type are then the columns set on it (v1). */
  async run(readAt: Date, mapping: TypeMapping | null): Promise<void> {
    const pending = await this.db.select({ id: absences.id }).from(absences).where(eq(absences.status, 'A_SAISIR'))
    for (const { id } of pending) {
      try {
        await this.db.transaction((tx) => this.confirm(tx, id, readAt, mapping))
      } catch {
        // this dossier is retried at the next reading
      }
    }
    const confirmed = await this.db.select({ id: absences.id }).from(absences).where(eq(absences.status, 'DANS_PAYFIT'))
    for (const { id } of confirmed) {
      try {
        await this.db.transaction((tx) => this.compare(tx, id, readAt))
      } catch {
        // idem
      }
    }
  }

  private async trace(tx: Tx, absenceId: string, crecheCode: string, summary: string): Promise<void> {
    await tx.insert(auditLogs).values({
      actorId: SYSTEM_ACTOR_ID,
      actorEmail: SYSTEM_ACTOR_EMAIL,
      action: 'sources:reconcile',
      objectType: 'Absence',
      objectId: absenceId,
      scopeCode: crecheCode,
      summary,
    })
  }

  /** Exactly one fresh, admissible observation matching company (SIRET), contract, code, dates and half-days. */
  private async confirm(tx: Tx, id: string, readAt: Date, mapping: TypeMapping | null): Promise<void> {
    const [locked] = await tx
      .select({ id: absences.id })
      .from(absences)
      .where(and(eq(absences.id, id), eq(absences.status, 'A_SAISIR')))
      .for('update')
    if (!locked) return
    const [row] = await tx
      .select({
        a: absences,
        siret: creches.siret,
        companyId: payfitContracts.companyId,
        payfitContractId: payfitContracts.payfitContractId,
        payfitCode: absenceTypes.payfitCode,
        compatible: absenceTypes.payfitCompatibleCodes,
      })
      .from(absences)
      .innerJoin(creches, eq(creches.code, absences.crecheCode))
      .innerJoin(payfitContracts, eq(payfitContracts.id, absences.contractId))
      .innerJoin(absenceTypes, eq(absenceTypes.code, absences.typeCode))
      .where(eq(absences.id, id))
    if (!row) return
    // rule-evp-payfit-type-mapping: the codes of the type are the union of the file and of the columns of the type
    const codes = (mapping ? mapping.codesOf(row.a.typeCode) : [row.payfitCode, ...(row.compatible ?? [])]).filter((code): code is string => Boolean(code))
    if (codes.length === 0) return
    const a = row.a
    const matches = await tx
      .select({ observation: payfitAbsences, companyName: payfitCompanies.name, siret: payfitCompanies.siret })
      .from(payfitAbsences)
      .innerJoin(payfitCompanies, eq(payfitCompanies.id, payfitAbsences.companyId))
      .where(
        and(
          eq(payfitAbsences.companyId, row.companyId),
          eq(payfitAbsences.contractId, row.payfitContractId),
          eq(payfitCompanies.siret, row.siret),
          inArray(payfitAbsences.typeCode, codes),
          eq(payfitAbsences.startDate, a.startDate),
          eq(payfitAbsences.startHalf, a.startHalf),
          eq(payfitAbsences.endDate, a.endDate),
          eq(payfitAbsences.endHalf, a.endHalf),
          // rule-evp-payfit-status-admissible: only an approved absence confirms
          inArray(payfitAbsences.status, ADMISSIBLE),
          gte(payfitAbsences.observedAt, readAt),
        ),
      )
    if (matches.length !== 1) return
    const { observation, companyName, siret } = matches[0]
    await tx.insert(payfitProofs).values({
      absenceId: id,
      companyId: observation.companyId,
      companyName,
      siret,
      payfitContractId: row.payfitContractId,
      payfitAbsenceId: observation.payfitAbsenceId,
      code: observation.typeCode,
      sourceStatus: observation.status,
      startDate: a.startDate,
      startHalf: a.startHalf,
      endDate: a.endDate,
      endHalf: a.endHalf,
      observedAt: observation.observedAt,
    })
    await tx.update(absences).set({ status: 'DANS_PAYFIT', updatedAt: new Date() }).where(eq(absences.id, id))
    await recordEvent(tx, { absenceId: id, kind: 'CONFIRMATION', text: 'Absence confirmée dans PayFit', byUserId: null })
    await this.notify(tx, 'CONFIRMATION', id, a.crecheCode, a.startDate, a.endDate)
    await this.trace(tx, id, a.crecheCode, `Confirmation automatique dans PayFit d’un dossier de la crèche ${a.crecheCode}`)
  }

  private async notify(tx: Tx, kind: NotificationKind, id: string, crecheCode: string, start: string, end: string): Promise<void> {
    const text = TEXTS[kind]
    await notifyCreche(tx, { kind, absenceId: id, crecheCode, title: text.title, message: text.message(frDate(start), frDate(end)) })
  }

  /** A confirmed dossier is compared again with PayFit: cancelled, changed, missing (exhaustive reading) or restored. */
  private async compare(tx: Tx, id: string, readAt: Date): Promise<void> {
    const [row] = await tx
      .select({ a: absences })
      .from(absences)
      .where(and(eq(absences.id, id), eq(absences.status, 'DANS_PAYFIT')))
      .for('update')
    if (!row) return
    const a = row.a
    const [proof] = await tx.select().from(payfitProofs).where(eq(payfitProofs.absenceId, id))
    if (!proof) return
    // rule-evp-sources-partial-failure: the coverage is the one of the company of the proof; none known = not exhaustive
    const [stored] = await tx.select().from(payfitCoverage).where(eq(payfitCoverage.companyId, proof.companyId))
    const coverage: Coverage = stored ?? { exhaustive: false, windowStart: '9999-12-31', windowEnd: '0000-01-01' }
    const [observation] = await tx
      .select()
      .from(payfitAbsences)
      .where(and(eq(payfitAbsences.companyId, proof.companyId), eq(payfitAbsences.payfitAbsenceId, proof.payfitAbsenceId)))
    const [open] = await tx.select().from(payfitAlerts).where(and(eq(payfitAlerts.absenceId, id), isNull(payfitAlerts.resolvedAt)))

    let alert: { kind: 'ANNULEE' | 'MODIFIEE' | 'DISPARUE'; change: string; fingerprint: string } | null = null
    if (!observation) {
      const covered = coverage.exhaustive && proof.startDate >= coverage.windowStart && proof.endDate <= coverage.windowEnd
      if (!covered) return
      alert = { kind: 'DISPARUE', change: 'Absence introuvable dans PayFit lors d’une lecture exhaustive', fingerprint: 'DISPARUE' }
    } else {
      if (observation.observedAt < readAt) return // not observed by this reading: nothing to conclude
      const status = normalisePayfitStatus(observation.status)
      // rule-evp-payfit-pending-cancellation (decision D-0002): neither an alert, nor the resolution of an open one;
      // checked before the generic comparison, which would read the change of status as a modification
      if (status === 'pending_cancellation') return
      if (status === 'cancelled' || status === 'declined') {
        // rule-evp-payfit-status-alerts
        alert = { kind: 'ANNULEE', change: 'Absence annulée dans PayFit', fingerprint: 'ANNULEE' }
      } else {
        const changed: string[] = []
        if (observation.startDate !== proof.startDate || observation.endDate !== proof.endDate) changed.push('dates')
        if (observation.startHalf !== proof.startHalf || observation.endHalf !== proof.endHalf) changed.push('demi-journées')
        if (observation.typeCode !== proof.code) changed.push('code')
        // a proof of v1 (`VALIDATED`) read again as `approved` is not a change
        if (status !== normalisePayfitStatus(proof.sourceStatus)) changed.push('statut')
        if (changed.length > 0) {
          alert = {
            kind: 'MODIFIEE',
            change: `Modifié dans PayFit : ${changed.join(', ')}`,
            fingerprint: [
              'MODIFIEE',
              observation.startDate,
              observation.startHalf,
              observation.endDate,
              observation.endHalf,
              observation.typeCode,
              status,
            ].join('|'),
          }
        }
      }
    }

    const now = new Date()
    if (!alert) {
      if (!open) return
      await tx.update(payfitAlerts).set({ resolvedAt: now }).where(eq(payfitAlerts.id, open.id))
      await recordEvent(tx, { absenceId: id, kind: 'RESTAURATION', text: 'Absence de nouveau conforme dans PayFit', byUserId: null })
      await this.notify(tx, 'RESTAURATION', id, a.crecheCode, a.startDate, a.endDate)
      await this.trace(tx, id, a.crecheCode, `Retour à la conformité dans PayFit d’un dossier de la crèche ${a.crecheCode}`)
      return
    }
    if (open && open.fingerprint === alert.fingerprint) return
    if (open) await tx.update(payfitAlerts).set({ resolvedAt: now }).where(eq(payfitAlerts.id, open.id))
    await tx.insert(payfitAlerts).values({
      absenceId: id,
      kind: alert.kind,
      change: alert.change,
      fingerprint: alert.fingerprint,
      observedAt: observation?.observedAt ?? readAt,
    })
    const notification: NotificationKind = alert.kind === 'ANNULEE' ? 'ANNULATION' : alert.kind === 'DISPARUE' ? 'DISPARITION' : 'MODIFICATION'
    await recordEvent(tx, { absenceId: id, kind: 'ALERTE_PAYFIT', text: alert.change, byUserId: null })
    await this.notify(tx, notification, id, a.crecheCode, a.startDate, a.endDate)
    await this.trace(tx, id, a.crecheCode, `Alerte PayFit sur un dossier confirmé de la crèche ${a.crecheCode}`)
  }
}
