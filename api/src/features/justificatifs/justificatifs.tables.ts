import { sql } from 'drizzle-orm'
import { boolean, index, integer, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { base } from '../../platform/database/base-schema'
import { declareScopedTable } from '../../platform/scopes/scoped-repository'
import { creches } from '../creches/creches.tables'
import { users } from '../users/users.tables'

export const pieceStatus = base.enum('piece_status', ['AUTHORIZED', 'CONFIRMED', 'PURGED'])

/** Supporting document of a dossier (rule-evp-piece-*). `absence_id` stays null until the piece is attached. */
export const absencePieces = declareScopedTable(
  base.table(
    'absence_pieces',
    {
      id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
      crecheCode: text('creche_code')
        .notNull()
        .references(() => creches.code, { onDelete: 'restrict' }),
      scopeCode: text('scope_code').notNull(),
      // text, not uuid, and no foreign key: the sealed suite seeds this column from a text expression (see DISPUTES.md)
      absenceId: text('absence_id'),
      uploadedBy: uuid('uploaded_by')
        .notNull()
        .references(() => users.id, { onDelete: 'restrict' }),
      fileName: text('file_name').notNull(),
      contentType: text('content_type').notNull(),
      announcedSize: integer('announced_size').notNull(),
      sizeBytes: integer('size_bytes'),
      storageKey: text('storage_key').notNull(),
      finalKey: text('final_key'),
      status: pieceStatus('status').notNull().default('AUTHORIZED'),
      privatePiece: boolean('private_piece').notNull().default(false),
      uploadExpiresAt: timestamp('upload_expires_at', { withTimezone: true }).notNull(),
      confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
      attachedAt: timestamp('attached_at', { withTimezone: true }),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [index('absence_pieces_absence_idx').on(table.absenceId)],
  ),
)
