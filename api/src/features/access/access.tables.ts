import { sql } from 'drizzle-orm'
import { boolean, check, integer, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { base } from '../../platform/database/base-schema'
import { creches } from '../creches/creches.tables'
import { users } from '../users/users.tables'

export const evpRole = base.enum('evp_role', ['DIRECTRICE', 'RO', 'RH', 'ADMINISTRATRICE', 'SUPERADMIN'])

/** EVP account: the EVP role of a platform user (rule-evp-declare-roles). Removal keeps the row (`removed_at`). */
export const evpAccounts = base.table(
  'evp_accounts',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    email: text('email').notNull(),
    role: evpRole('role').notNull(),
    active: boolean('active').notNull().default(true),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * rule-evp-google-sub-identity, rule-evp-google-sub-binding: the stable identifier of the Google account (never the
     * address, which can change), bound at the first valid sign-in. 1 to 255 characters, never shared by two accounts
     * (rule-evp-google-sub-unique).
     */
    googleSub: text('google_sub'),
    /**
     * rule-evp-access-session-version (inferred, backend, decision D-0011): raised by a successful Google unlink only,
     * carried by the session token (`sv`); a token with another version is refused. Never leaves the API.
     */
    sessionVersion: integer('session_version').notNull().default(0),
  },
  (table) => [
    uniqueIndex('evp_accounts_google_sub_unique').on(table.googleSub).where(sql`${table.googleSub} is not null`),
    check('evp_accounts_google_sub_length', sql`${table.googleSub} is null or char_length(${table.googleSub}) between 1 and 255`),
  ],
)

/** Crèches a DIRECTRICE or RO is assigned to (rule-evp-creche-scope). */
export const crecheAssignments = base.table(
  'creche_assignments',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    crecheCode: text('creche_code')
      .notNull()
      .references(() => creches.code, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.crecheCode] })],
)
