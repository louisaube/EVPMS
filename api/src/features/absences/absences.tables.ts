import { sql } from 'drizzle-orm'
import { boolean, date, index, jsonb, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { base } from '../../platform/database/base-schema'
import { declareScopedTable } from '../../platform/scopes/scoped-repository'
import { creches } from '../creches/creches.tables'
import { payfitContracts } from '../sources/sources.tables'
import { users } from '../users/users.tables'

export const absenceStatus = base.enum('absence_status', [
  'A_COMPLETER',
  'ANTICIPEE',
  'A_VALIDER',
  'A_SAISIR',
  'DANS_PAYFIT',
  'REJETEE',
  'ANNULEE',
])
export const halfDay = base.enum('half_day', ['MATIN', 'APRES_MIDI'])

/** Reference list of absence types; the PayFit codes are configured by the HR administrator (null until then). */
export const absenceTypes = base.table('absence_types', {
  code: text('code').primaryKey(),
  label: text('label').notNull(),
  expectedPiece: text('expected_piece'),
  privatePiece: boolean('private_piece').notNull().default(false),
  hrReview: boolean('hr_review').notNull().default(false),
  payfitCode: text('payfit_code'),
  payfitCompatibleCodes: text('payfit_compatible_codes').array().notNull().default([]),
})

/** The dossier (rule-evp-states). Never deleted. `blockages` and `last_decision` are computed/recorded by the services. */
export const absences = declareScopedTable(
  base.table(
    'absences',
    {
      id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
      crecheCode: text('creche_code')
        .notNull()
        .references(() => creches.code, { onDelete: 'restrict' }),
      scopeCode: text('scope_code').notNull(),
      contractId: uuid('contract_id')
        .notNull()
        .references(() => payfitContracts.id, { onDelete: 'restrict' }),
      typeCode: text('type_code')
        .notNull()
        .references(() => absenceTypes.code, { onDelete: 'restrict' }),
      startDate: date('start_date', { mode: 'string' }).notNull(),
      startHalf: halfDay('start_half').notNull(),
      endDate: date('end_date', { mode: 'string' }).notNull(),
      endHalf: halfDay('end_half').notNull(),
      status: absenceStatus('status').notNull(),
      saisieDeclaree: boolean('saisie_declaree').notNull().default(false),
      comment: text('comment'),
      payrollMonth: text('payroll_month').notNull(),
      blockages: jsonb('blockages').notNull().default(sql`'[]'::jsonb`),
      lastDecision: jsonb('last_decision'),
      declaredBy: uuid('declared_by')
        .notNull()
        .references(() => users.id, { onDelete: 'restrict' }),
      declaredAt: timestamp('declared_at', { withTimezone: true }).notNull().defaultNow(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index('absences_creche_status_idx').on(table.crecheCode, table.status),
      index('absences_contract_idx').on(table.contractId),
      // rule-evp-declare-no-duplicate: one active dossier per exact period, type and contract
      uniqueIndex('absences_active_exact_unique')
        .on(table.contractId, table.typeCode, table.startDate, table.startHalf, table.endDate, table.endHalf)
        .where(sql`${table.status} not in ('REJETEE', 'ANNULEE')`),
    ],
  ),
)

/** Append-only timeline of a dossier (rule-evp-audit-atomic). A trigger refuses UPDATE and DELETE. */
export const absenceEvents = base.table(
  'absence_events',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    absenceId: uuid('absence_id')
      .notNull()
      .references(() => absences.id, { onDelete: 'restrict' }),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    kind: text('kind').notNull(),
    text: text('text').notNull(),
    byUserId: uuid('by_user_id'),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
  },
  (table) => [index('absence_events_absence_idx').on(table.absenceId, table.at)],
)

/** The PayFit proof of a confirmed dossier: written once, never updated (rule-evp-payfit-proof). */
export const payfitProofs = base.table(
  'payfit_proofs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    absenceId: uuid('absence_id')
      .notNull()
      .references(() => absences.id, { onDelete: 'restrict' }),
    companyId: text('company_id').notNull(),
    companyName: text('company_name').notNull(),
    siret: text('siret').notNull(),
    payfitContractId: text('payfit_contract_id').notNull(),
    payfitAbsenceId: text('payfit_absence_id').notNull(),
    code: text('code').notNull(),
    sourceStatus: text('source_status').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    startHalf: halfDay('start_half').notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    endHalf: halfDay('end_half').notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex('payfit_proofs_absence_unique').on(table.absenceId)],
)

/** Alert on a confirmed dossier whose PayFit absence changed afterwards (rule-evp-payfit-alerts). */
export const payfitAlerts = base.table(
  'payfit_alerts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    absenceId: uuid('absence_id')
      .notNull()
      .references(() => absences.id, { onDelete: 'restrict' }),
    kind: text('kind').notNull(),
    change: text('change').notNull(),
    fingerprint: text('fingerprint').notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('payfit_alerts_absence_idx').on(table.absenceId),
    uniqueIndex('payfit_alerts_one_open').on(table.absenceId).where(sql`${table.resolvedAt} is null`),
  ],
)
