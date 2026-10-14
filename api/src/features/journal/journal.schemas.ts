import { z } from 'zod'
import { uuidFormat, uuidRefinement } from '../../platform/validation/common'
import { evpPageShape, isoDate } from '../evp-core/evp-query'

/** rule-evp-journal-pagination: filters combine; `dateFrom` / `dateTo` are Paris days, `dateTo` cannot precede `dateFrom`. */
export const journalQuerySchema = z
  .object({
    operation: z.string().min(1).max(100).optional().meta({ description: 'Operation code, for instance absences:validate' }),
    actorId: uuidRefinement().optional(),
    absenceId: uuidRefinement().optional(),
    dateFrom: isoDate().optional(),
    dateTo: isoDate().optional(),
    ...evpPageShape(25),
  })
  .refine((q) => !q.dateFrom || !q.dateTo || q.dateTo >= q.dateFrom, { message: '`dateTo` cannot precede `dateFrom`', path: ['dateTo'] })
export type JournalQuery = z.infer<typeof journalQuerySchema>

export const journalEntrySchema = z
  .object({
    id: uuidFormat(),
    occurredAt: z.string().meta({ format: 'date-time' }),
    actorName: z.string(),
    actorEmail: z.string(),
    operation: z.string(),
    operationLabel: z.string(),
    summary: z.string(),
    absenceId: uuidFormat().nullable(),
  })
  .meta({ id: 'JournalEntryDto' })
export type JournalEntry = z.infer<typeof journalEntrySchema>

export const journalResponseSchema = z
  .object({ items: z.array(journalEntrySchema).max(50), total: z.number().int().min(0) })
  .meta({ id: 'JournalResponseDto' })

export const journalFiltersResponseSchema = z
  .object({
    actors: z.array(z.object({ id: uuidFormat(), name: z.string() })),
    operations: z.array(z.object({ code: z.string(), label: z.string() })),
  })
  .meta({ id: 'JournalFiltersResponseDto' })

export const absenceAuditResponseSchema = z
  .object({ items: z.array(journalEntrySchema) })
  .meta({ id: 'AbsenceAuditResponseDto' })

export const absenceAuditParamsSchema = z.object({ id: uuidRefinement() })
