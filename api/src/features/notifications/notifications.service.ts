import { Injectable } from '@nestjs/common'
import { and, desc, eq, sql } from 'drizzle-orm'
import { Database, InjectDb } from '../../platform/database/database.module'
import { notFound } from '../../platform/http/errors'
import { absences } from '../absences/absences.tables'
import { creches } from '../creches/creches.tables'
import type { EvpAccess } from '../evp-core/evp.types'
import { payfitContracts, payfitEmployees } from '../sources/sources.tables'
import type { NotificationsQuery } from './notifications.schemas'
import { notificationReads, notifications } from './notifications.tables'

const MAX_ITEMS = 100

@Injectable()
export class NotificationsService {
  constructor(@InjectDb() private readonly db: Database) {}

  private isRead(userId: string) {
    return sql<boolean>`exists (select 1 from ${notificationReads} r where r.notification_id = ${notifications.id} and r.user_id = ${userId})`
  }

  /** rule-evp-notif-unread-count: every notification of the perimeter the caller has not read. */
  async unreadCount(evp: EvpAccess): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(sql`not ${this.isRead(evp.userId)}`)
    return Number(row?.n ?? 0)
  }

  /** rule-evp-notif-list, rule-evp-notif-max-100: newest first, 100 at most; the perimeter is enforced by the database. */
  async list(evp: EvpAccess, query: NotificationsQuery) {
    const rows = await this.db
      .select({
        id: notifications.id,
        kind: notifications.kind,
        absenceId: notifications.absenceId,
        title: notifications.title,
        message: notifications.message,
        createdAt: notifications.createdAt,
        crecheName: creches.name,
        firstName: payfitEmployees.firstName,
        lastName: payfitEmployees.lastName,
        read: this.isRead(evp.userId),
      })
      .from(notifications)
      .innerJoin(absences, eq(absences.id, notifications.absenceId))
      .innerJoin(creches, eq(creches.code, absences.crecheCode))
      .innerJoin(payfitContracts, eq(payfitContracts.id, absences.contractId))
      .innerJoin(
        payfitEmployees,
        and(eq(payfitEmployees.companyId, payfitContracts.companyId), eq(payfitEmployees.employeeId, payfitContracts.employeeId)),
      )
      .where(query.unreadOnly ? sql`not ${this.isRead(evp.userId)}` : undefined)
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(MAX_ITEMS + 1)
    return {
      items: rows.slice(0, MAX_ITEMS).map((row) => ({
        id: row.id,
        kind: row.kind as 'CONFIRMATION',
        absenceId: row.absenceId,
        title: row.title,
        message: row.message,
        crecheName: row.crecheName,
        employeeName: `${row.firstName} ${row.lastName}`,
        createdAt: row.createdAt.toISOString(),
        read: Boolean(row.read),
      })),
      truncated: rows.length > MAX_ITEMS,
      unreadCount: await this.unreadCount(evp),
    }
  }

  /** rule-evp-notif-per-user-read, rule-evp-notif-read-decides-nothing: idempotent, writes only the read mark of the caller. */
  async markRead(evp: EvpAccess, id: string) {
    const [found] = await this.db.select({ id: notifications.id }).from(notifications).where(eq(notifications.id, id))
    if (!found) throw notFound()
    await this.db.insert(notificationReads).values({ notificationId: id, userId: evp.userId }).onConflictDoNothing()
    return { id, read: true as const }
  }
}
