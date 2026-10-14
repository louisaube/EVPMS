import { sql } from 'drizzle-orm'
import { index, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { base } from '../../platform/database/base-schema'
import { declareScopedTable } from '../../platform/scopes/scoped-repository'
import { absences } from '../absences/absences.tables'
import { users } from '../users/users.tables'

/** Notification of a crèche (rule-evp-notif-*): a French title and message, never any medical detail. */
export const notifications = declareScopedTable(
  base.table(
    'notifications',
    {
      id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
      kind: text('kind').notNull(),
      absenceId: uuid('absence_id')
        .notNull()
        .references(() => absences.id, { onDelete: 'restrict' }),
      scopeCode: text('scope_code').notNull(),
      title: text('title').notNull(),
      message: text('message').notNull(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [index('notifications_scope_created_idx').on(table.scopeCode, table.createdAt)],
  ),
)

/** Read mark of a notification, per user (rule-evp-notif-per-user-read). */
export const notificationReads = base.table(
  'notification_reads',
  {
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.notificationId, table.userId] })],
)
