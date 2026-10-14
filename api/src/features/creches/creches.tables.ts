import { boolean, index, text, timestamp } from 'drizzle-orm/pg-core'
import { base } from '../../platform/database/base-schema'
import { declareScopedTable } from '../../platform/scopes/scoped-repository'

/** data-contract (EVP extension): base.creches, filled by the Sheets read. `scope_code` is the code itself. */
export const creches = declareScopedTable(
  base.table(
    'creches',
    {
      code: text('code').primaryKey(),
      name: text('name').notNull(),
      siret: text('siret').notNull(),
      directriceName: text('directrice_name'),
      roNames: text('ro_names').array().notNull().default([]),
      verified: boolean('verified').notNull().default(false),
      scopeCode: text('scope_code').notNull(),
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [index('creches_siret_idx').on(table.siret)],
  ),
)
