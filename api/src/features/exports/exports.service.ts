import { Injectable } from '@nestjs/common'
import { and, asc, gte, lte } from 'drizzle-orm'
import { Database, InjectDb } from '../../platform/database/database.module'
import { selectRows } from '../absences/absence-shapes'
import { absenceTypes, absences, payfitProofs } from '../absences/absences.tables'
import type { EvpAccess } from '../evp-core/evp.types'
import type { ExportBody } from './exports.schemas'

export const CSV_HEADER = [
  'Crèche',
  'Salariée',
  'Contrat',
  'Type',
  'Code PayFit',
  'Début',
  'Demi-journée de début',
  'Fin',
  'Demi-journée de fin',
  'Statut',
  'Motif administratif',
]

const STATUS_LABELS: Record<string, string> = {
  A_COMPLETER: 'À compléter',
  ANTICIPEE: 'Anticipée',
  A_VALIDER: 'À valider',
  A_SAISIR: 'À saisir dans PayFit',
  DANS_PAYFIT: 'Dans PayFit',
  REJETEE: 'Rejetée',
  ANNULEE: 'Annulée',
}

/** rule-evp-export-csv-format: quoted cell, no line break inside, a leading = + - @ (or tab) is neutralised by an apostrophe. */
export function csvCell(value: string): string {
  const flat = value.replace(/[\r\n]+/g, ' ')
  const safe = /^[=+\-@\t]/.test(flat) ? `'${flat}` : flat
  return `"${safe.replace(/"/g, '""')}"`
}

@Injectable()
export class ExportsService {
  constructor(@InjectDb() private readonly db: Database) {}

  /**
   * rule-evp-export-period, rule-evp-export-all-statuses, rule-evp-export-columns: every dossier overlapping the period,
   * whatever its state and crèche. The comment of the declarant is never exported. Reads only: no connector is called.
   */
  async absences(_evp: EvpAccess, body: ExportBody): Promise<string> {
    const rows = await selectRows(this.db, and(lte(absences.startDate, body.to), gte(absences.endDate, body.from)), {
      order: [asc(absences.startDate), asc(absences.id)],
    })
    const proofs = await this.db.select({ absenceId: payfitProofs.absenceId, code: payfitProofs.code }).from(payfitProofs)
    const proofCode = new Map(proofs.map((proof) => [proof.absenceId, proof.code]))
    const typeCodes = await this.db.select({ code: absenceTypes.code, payfitCode: absenceTypes.payfitCode }).from(absenceTypes)
    const typeCode = new Map(typeCodes.map((type) => [type.code, type.payfitCode]))
    const lines = [CSV_HEADER.map(csvCell).join(';')]
    for (const row of rows) {
      const a = row.a
      const decision = a.lastDecision as { reason?: string | null } | null
      lines.push(
        [
          row.crecheName,
          `${row.firstName} ${row.lastName}`,
          row.contract.payfitContractId,
          row.typeLabel,
          proofCode.get(a.id) ?? typeCode.get(a.typeCode) ?? '',
          a.startDate,
          a.startHalf,
          a.endDate,
          a.endHalf,
          STATUS_LABELS[a.status] ?? a.status,
          decision?.reason ?? '',
        ]
          .map(csvCell)
          .join(';'),
      )
    }
    return `﻿${lines.join('\r\n')}\r\n`
  }
}
