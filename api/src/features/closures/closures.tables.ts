import { primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { base } from '../../platform/database/base-schema'
import { declareScopedTable } from '../../platform/scopes/scoped-repository'
import { creches } from '../creches/creches.tables'
import { users } from '../users/users.tables'

/** Monthly closure of a crèche (rule-evp-closure-*): final, UPDATE and DELETE are revoked from the application role. */
export const closures = declareScopedTable(
  base.table(
    'closures',
    {
      crecheCode: text('creche_code')
        .notNull()
        .references(() => creches.code, { onDelete: 'restrict' }),
      month: text('month').notNull(),
      scopeCode: text('scope_code').notNull(),
      closedAt: timestamp('closed_at', { withTimezone: true }).notNull().defaultNow(),
      closedBy: uuid('closed_by')
        .notNull()
        .references(() => users.id, { onDelete: 'restrict' }),
    },
    (table) => [primaryKey({ columns: [table.crecheCode, table.month] })],
  ),
)
