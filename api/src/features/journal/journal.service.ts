import { Injectable } from '@nestjs/common'
import { and, desc, eq, sql, SQL } from 'drizzle-orm'
import { Database, InjectDb } from '../../platform/database/database.module'
import { notFound } from '../../platform/http/errors'
import { evpAccounts } from '../access/access.tables'
import { absences } from '../absences/absences.tables'
import { auditLogs } from '../audit/audit.tables'
import { evpPageOf } from '../evp-core/evp-query'
import type { JournalEntry, JournalQuery } from './journal.schemas'

export const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000'

/** French label of every operation of the EVP (rule-evp-journal-covers); the code never reaches the screen. */
export const OPERATION_LABELS: Record<string, string> = {
  'absences:create': 'Déclaration d’absence',
  'absences:update': 'Modification de dossier',
  'absences:submit': 'Soumission de dossier',
  'absences:cancel': 'Annulation de dossier',
  'absences:validate': 'Validation de dossier',
  'absences:return': 'Renvoi de dossier',
  'absences:reject': 'Rejet de dossier',
  'absences:mark-entered': 'Saisie déclarée dans PayFit',
  'access:create': 'Création d’un accès',
  'access:update': 'Modification d’un accès',
  'access:remove': 'Retrait d’un accès',
  'closures:attest': 'Clôture de mois',
  'justificatifs:authorize': 'Dépôt de justificatif',
  'justificatifs:confirm': 'Confirmation de justificatif',
  'justificatifs:read-link': 'Ouverture de justificatif',
  'exports:absences': 'Export des absences',
  'sources:refresh': 'Lecture de source',
  'sources:refresh-all': 'Lecture de toutes les sources',
  'sources:reconcile': 'Rapprochement PayFit',
}

/** rule-evp-journal-source: only the EVP actions of the audit trail, never those of the foundation. */
const EVP_ACTIONS = sql`${auditLogs.action} ~ '^(absences|access|closures|justificatifs|exports|sources):'`
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Row = {
  id: string
  occurredAt: Date
  actorId: string
  actorEmail: string
  action: string
  objectType: string
  objectId: string
  summary: string
  accountName: string | null
}

export function toEntry(row: Row): JournalEntry {
  const concerned = row.objectType === 'Absence' || row.action === 'justificatifs:read-link'
  return {
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    actorName: row.actorId === SYSTEM_ACTOR_ID ? 'Système' : (row.accountName ?? row.actorEmail),
    actorEmail: row.actorEmail,
    operation: row.action,
    operationLabel: OPERATION_LABELS[row.action] ?? 'Autre opération',
    summary: row.summary,
    absenceId: concerned && UUID.test(row.objectId) ? row.objectId.toLowerCase() : null,
  }
}

@Injectable()
export class JournalService {
  constructor(@InjectDb() private readonly db: Database) {}

  private select(where: SQL | undefined) {
    return this.db
      .select({
        id: auditLogs.id,
        occurredAt: auditLogs.occurredAt,
        actorId: auditLogs.actorId,
        actorEmail: auditLogs.actorEmail,
        action: auditLogs.action,
        objectType: auditLogs.objectType,
        objectId: auditLogs.objectId,
        summary: auditLogs.summary,
        accountName: evpAccounts.name,
      })
      .from(auditLogs)
      .leftJoin(evpAccounts, eq(evpAccounts.userId, auditLogs.actorId))
      .where(where)
      .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
  }

  async list(query: JournalQuery) {
    const { from, size } = evpPageOf(query, 25)
    const parisDay = sql`(${auditLogs.occurredAt} at time zone 'Europe/Paris')::date`
    const where = and(
      EVP_ACTIONS,
      query.operation ? eq(auditLogs.action, query.operation) : undefined,
      query.actorId ? eq(auditLogs.actorId, query.actorId) : undefined,
      query.absenceId
        ? and(
            eq(auditLogs.objectId, query.absenceId),
            sql`(${auditLogs.objectType} = 'Absence' or ${auditLogs.action} = 'justificatifs:read-link')`,
          )
        : undefined,
      query.dateFrom ? sql`${parisDay} >= ${query.dateFrom}::date` : undefined,
      query.dateTo ? sql`${parisDay} <= ${query.dateTo}::date` : undefined,
    )
    const rows = await this.select(where).limit(size).offset(from)
    const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(auditLogs).where(where)
    return { items: rows.map(toEntry), total: Number(n) }
  }

  async filters() {
    const rows = await this.db
      .selectDistinct({ id: auditLogs.actorId, email: auditLogs.actorEmail, name: evpAccounts.name })
      .from(auditLogs)
      .leftJoin(evpAccounts, eq(evpAccounts.userId, auditLogs.actorId))
      .where(EVP_ACTIONS)
    const byId = new Map<string, string>()
    for (const row of rows) byId.set(row.id, row.id === SYSTEM_ACTOR_ID ? 'Système' : (row.name ?? row.email))
    return {
      actors: [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'fr') || a.id.localeCompare(b.id)),
      operations: Object.entries(OPERATION_LABELS).map(([code, label]) => ({ code, label })),
    }
  }

  /** The audit entries of one dossier (and of the openings of its pieces), oldest first. */
  async ofAbsence(id: string) {
    const [dossier] = await this.db.select({ id: absences.id }).from(absences).where(eq(absences.id, id))
    if (!dossier) throw notFound()
    const rows = await this.select(
      and(
        EVP_ACTIONS,
        eq(auditLogs.objectId, id),
        sql`(${auditLogs.objectType} = 'Absence' or ${auditLogs.action} = 'justificatifs:read-link')`,
      ),
    )
    return { items: rows.map(toEntry).reverse() }
  }
}
