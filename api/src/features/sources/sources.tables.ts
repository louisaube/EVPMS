import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  index,
  jsonb,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { base } from '../../platform/database/base-schema'

export const sourceKey = base.enum('source_key', ['sheets', 'payfit', 'aqoona', 'all'])
export const sourceRunState = base.enum('source_run_state', ['RUNNING', 'SUCCEEDED', 'FAILED'])

/** One row per read of a source (rule-evp-sources-run). A partial unique index forbids two RUNNING rows per source. */
export const sourceRuns = base.table(
  'source_runs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    source: sourceKey('source_key').notNull(),
    parentId: uuid('parent_id'),
    state: sourceRunState('state').notNull().default('RUNNING'),
    step: text('step'),
    volumes: jsonb('volumes').notNull().default(sql`'[]'::jsonb`),
    errorMessage: text('error_message'),
    /** One of the five `sources.*` codes of a failed reading (rule-evp-sources-error-codes). */
    errorCode: text('error_code'),
    /** A SUCCEEDED reading of which at least one company or address failed (rule-evp-sources-partial-failure). */
    partial: boolean('partial').notNull().default(false),
    startedBy: uuid('started_by'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('source_runs_one_running').on(table.source).where(sql`${table.state} = 'RUNNING'`),
    index('source_runs_source_started_idx').on(table.source, table.startedAt),
  ],
)

/** Anomalies of the last successful read of a source: replaced as a whole at each success. */
export const sourceAnomalies = base.table(
  'source_anomalies',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    source: sourceKey('source').notNull(),
    type: text('type').notNull(),
    label: text('label').notNull(),
    subject: text('subject').notNull(),
    detail: text('detail').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('source_anomalies_source_idx').on(table.source)],
)

/** PayFit company. The SIRET is NOT unique: a duplicate is an anomaly, not a constraint. */
export const payfitCompanies = base.table(
  'payfit_companies',
  {
    id: text('id').primaryKey(),
    siret: text('siret').notNull(),
    name: text('name').notNull(),
    /** SHA-256 of the API key of the entry: the company id is not asked again while the key is unchanged. Never the key. */
    keyFingerprint: text('key_fingerprint'),
    companyIdResolvedAt: timestamp('company_id_resolved_at', { withTimezone: true }),
  },
  (table) => [index('payfit_companies_siret_idx').on(table.siret)],
)

export const payfitEmployees = base.table(
  'payfit_employees',
  {
    companyId: text('company_id')
      .notNull()
      .references(() => payfitCompanies.id, { onDelete: 'cascade' }),
    employeeId: text('employee_id').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
  },
  (table) => [primaryKey({ columns: [table.companyId, table.employeeId] })],
)

export const payfitContracts = base.table(
  'payfit_contracts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    companyId: text('company_id')
      .notNull()
      .references(() => payfitCompanies.id, { onDelete: 'cascade' }),
    payfitContractId: text('payfit_contract_id').notNull(),
    employeeId: text('employee_id').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }),
    /** rule-evp-payfit-contracts-all-statuses: ACTIVE, ARCHIVED or PENDING, kept and never used as a filter. */
    status: text('status').notNull().default('ACTIVE'),
  },
  (table) => [
    uniqueIndex('payfit_contracts_company_contract_unique').on(table.companyId, table.payfitContractId),
    check('payfit_contracts_status_check', sql`${table.status} in ('ACTIVE', 'ARCHIVED', 'PENDING')`),
  ],
)

/** Absence as last read from PayFit. `canceled` rows are kept: they feed the alerts of the proofs. */
export const payfitAbsences = base.table(
  'payfit_absences',
  {
    companyId: text('company_id')
      .notNull()
      .references(() => payfitCompanies.id, { onDelete: 'cascade' }),
    payfitAbsenceId: text('payfit_absence_id').notNull(),
    contractId: text('contract_id').notNull(),
    typeCode: text('type_code').notNull(),
    status: text('status').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    /** null: the `moment` of PayFit cannot be interpreted (rule-evp-payfit-half-day-mapping). */
    startHalf: text('start_half'),
    startMoment: text('start_moment'),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    endHalf: text('end_half'),
    endMoment: text('end_moment'),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.companyId, table.payfitAbsenceId] })],
)

/**
 * Coverage of the last PayFit read, one row per company: DISPARUE is only raised when the read of that company was
 * exhaustive and covered the dates. A company that failed keeps its row with `reachable = false` and `exhaustive = false`.
 */
export const payfitCoverage = base.table('payfit_coverage', {
  companyId: text('company_id').primaryKey(),
  reachable: boolean('reachable').notNull().default(true),
  windowStart: date('window_start', { mode: 'string' }).notNull(),
  windowEnd: date('window_end', { mode: 'string' }).notNull(),
  exhaustive: boolean('exhaustive').notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Plannings read from Aqoona. The NIR is never stored: `person_ref` is "Prénom Nom". */
export const aqoonaPlannings = base.table(
  'aqoona_plannings',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    personRef: text('person_ref').notNull(),
    crecheCode: text('creche_code'),
    companyId: text('company_id'),
    employeeId: text('employee_id'),
    day: date('day', { mode: 'string' }).notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    /** Label (not secret) of the address it was read from: the slots of an address that fails are kept. */
    addressLabel: text('address_label'),
    /** rule-evp-aqoona-slot-type-normalised: GARDE, PAUSE, MENAGE, AUTRE or NON_PRECISE. No column ever holds a NIR. */
    slotType: text('slot_type').notNull().default('NON_PRECISE'),
    /** rule-evp-aqoona-nir-never-stored: how the slot was attached (never the NIR, a fingerprint or a fragment). INCONNU: written before v4. */
    matchMethod: text('match_method').notNull().default('INCONNU'),
    /**
     * rule-evp-link-one-establishment: PayFit company of reference of the linked collaborator (it may differ from `company_id`,
     * the company of the crèche, for a floating employee). Null if and only if `employee_id` is null.
     */
    employeeCompanyId: text('employee_company_id'),
    /** rule-evp-link-causes: why a row with a name or a NIR is not linked. Null for a linked row and for a row without identity. */
    unlinkedCause: text('unlinked_cause'),
    /** rule-evp-unlinked-list: the establishment as read in Aqoona, kept for an unlinked slot whose crèche is unknown. Never a NIR. */
    crecheLabel: text('creche_label'),
  },
  (table) => [
    index('aqoona_plannings_day_idx').on(table.day),
    check('aqoona_plannings_match_method_check', sql`${table.matchMethod} in ('NIR', 'NOM', 'AUCUN', 'INCONNU')`),
    check(
      'aqoona_plannings_unlinked_cause_check',
      sql`${table.unlinkedCause} is null or ${table.unlinkedCause} in ('NIR_ABSENT', 'NIR_KEY_INVALID', 'NIR_UNKNOWN', 'NIR_AMBIGUOUS', 'PAYFIT_INCOMPLETE')`,
    ),
    check('aqoona_plannings_employee_company_check', sql`(${table.employeeId} is null) = (${table.employeeCompanyId} is null)`),
    check('aqoona_plannings_slot_type_check', sql`${table.slotType} in ('GARDE', 'PAUSE', 'MENAGE', 'AUTRE', 'NON_PRECISE')`),
    // rule-evp-aqoona-dedupe: the belt; the same key is applied in memory before the insertion
    unique('aqoona_plannings_slot_unique')
      .on(table.personRef, table.crecheCode, table.companyId, table.day, table.startTime, table.endTime, table.slotType)
      .nullsNotDistinct(),
  ],
)

export const aqoonaMismatches = base.table('aqoona_mismatches', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  personRef: text('person_ref').notNull(),
  crecheName: text('creche_name').notNull(),
  reason: text('reason').notNull(),
  day: date('day', { mode: 'string' }),
  addressLabel: text('address_label'),
})
