import { z } from 'zod'
import { uuidFormat, uuidList, uuidRefinement } from '../../platform/validation/common'
import { crecheCodeSchema, isoDate, monthString, queryBoolean } from '../evp-core/evp-query'

export const ABSENCE_TYPE_CODES = [
  'CONGES_PAYES',
  'ARRET_MALADIE',
  'SANS_SOLDE',
  'ENFANT_MALADE',
  'ACCIDENT_TRAVAIL',
  'RECUPERATION',
  'SANS_JUSTIFICATIF',
  'EVENEMENT_FAMILIAL',
  'AUTRE',
] as const

export const ABSENCE_STATUSES = [
  'A_COMPLETER',
  'ANTICIPEE',
  'A_VALIDER',
  'A_SAISIR',
  'DANS_PAYFIT',
  'REJETEE',
  'ANNULEE',
] as const
export type AbsenceStatusName = (typeof ABSENCE_STATUSES)[number]

export const ABSENCE_ACTIONS = ['ATTACH', 'CANCEL', 'MARK_ENTERED', 'REJECT', 'RETURN', 'SUBMIT', 'VALIDATE'] as const
export type AbsenceAction = (typeof ABSENCE_ACTIONS)[number]

const halfSchema = z.enum(['MATIN', 'APRES_MIDI'])
const noNul = (value: string) => !value.includes('\u0000')

/** rule-evp-declare-comment-bound: at most 500 characters, no null character. */
const commentSchema = z
  .string()
  .max(500)
  .refine(noNul, 'Must not contain a null character')
  .meta({ description: 'Administrative comment, at most 500 characters. Never copied to the journal, the timeline or the logs' })

/** rule-evp-decision-reason-required: administrative reason, 1 to 500 characters. */
export const reasonBodySchema = z
  .object({
    reason: z
      .string()
      .min(1)
      .max(500)
      .refine(noNul, 'Must not contain a null character')
      .meta({ description: 'Administrative reason, 1 to 500 characters' }),
  })
  .meta({ id: 'AbsenceReasonParamsDto' })
export type ReasonBody = z.infer<typeof reasonBodySchema>

/** rule-evp-declare-half-day-order: the end cannot precede the start, half-day included. */
export const periodIsOrdered = (period: { startDate: string; startHalf: string; endDate: string; endHalf: string }): boolean => {
  if (period.endDate !== period.startDate) return period.endDate > period.startDate
  return !(period.startHalf === 'APRES_MIDI' && period.endHalf === 'MATIN')
}

export const createAbsenceBodySchema = z
  .object({
    crecheCode: crecheCodeSchema(),
    contractId: uuidFormat().meta({ description: 'Local identifier of the contract (company + PayFit contract)' }),
    typeCode: z.enum(ABSENCE_TYPE_CODES),
    startDate: isoDate(),
    startHalf: halfSchema,
    endDate: isoDate(),
    endHalf: halfSchema,
    comment: commentSchema.nullable().optional(),
    justificatifIds: uuidList(0, 5)
      .optional()
      .meta({ description: 'Confirmed, unattached pieces of the crèche: at most 5, distinct', uniqueItems: true }),
  })
  .refine(periodIsOrdered, { message: 'The end cannot precede the start', path: ['endDate'] })
  .meta({ id: 'AbsenceCreateParamsDto' })
export type CreateAbsenceBody = z.infer<typeof createAbsenceBodySchema>

/** rule-evp-declare-edit-server: the crèche, the contract and the state never change; at least one field. */
export const updateAbsenceBodySchema = z
  .strictObject({
    typeCode: z.enum(ABSENCE_TYPE_CODES).optional(),
    startDate: isoDate().optional(),
    startHalf: halfSchema.optional(),
    endDate: isoDate().optional(),
    endHalf: halfSchema.optional(),
    comment: commentSchema.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'At least one field is required' })
  .meta({ id: 'AbsenceUpdateParamsDto', additionalProperties: undefined })
export type UpdateAbsenceBody = z.infer<typeof updateAbsenceBodySchema>

/** rule-evp-batch-max-50: 1 to 50 distinct dossiers. */
export const validateBatchBodySchema = z
  .object({ absenceIds: uuidList(1, 50).meta({ description: '1 to 50 distinct dossiers', uniqueItems: true }) })
  .meta({ id: 'AbsenceValidateBatchParamsDto' })
export type ValidateBatchBody = z.infer<typeof validateBatchBodySchema>

export const absenceIdParamsSchema = z.object({ id: uuidRefinement() })

const statusParam = z.enum(ABSENCE_STATUSES)

/** rule-evp-list-scope: filters narrow the perimeter of the caller, never widen it. */
export const absencesListQuerySchema = z.object({
  status: z
    .union([statusParam, z.array(statusParam).min(1).max(7)])
    .optional()
    .meta({ description: 'One or several states (repeat the parameter)' }),
  from: isoDate().optional().meta({ description: 'Keep the dossiers whose period ends on or after this day' }),
  to: isoDate().optional().meta({ description: 'Keep the dossiers whose period starts on or before this day' }),
  crecheCode: crecheCodeSchema().optional(),
  payrollMonth: monthString().optional(),
  open: queryBoolean('Only the open dossiers (to complete, anticipated, to validate, to enter) when true'),
})
export type AbsencesListQuery = z.infer<typeof absencesListQuerySchema>

const blockageSchema = z
  .object({ code: z.string(), message: z.string() })
  .meta({ id: 'AbsenceBlockageDto' })

const nextActionSchema = z
  .object({
    actor: z.enum(['DECLARANT', 'RH', 'LECTURE_PAYFIT', 'AUCUN']),
    actorLabel: z.string(),
    label: z.string(),
  })
  .meta({ id: 'AbsenceNextActionDto' })

export const absenceSummarySchema = z
  .object({
    id: uuidFormat(),
    crecheCode: z.string(),
    crecheName: z.string(),
    employeeName: z.string(),
    contractLabel: z.string(),
    typeCode: z.string(),
    typeLabel: z.string(),
    startDate: isoDate(),
    startHalf: halfSchema,
    endDate: isoDate(),
    endHalf: halfSchema,
    status: z.enum(ABSENCE_STATUSES),
    saisieDeclaree: z.boolean(),
    payrollMonth: monthString(),
    blockages: z.array(blockageSchema),
    nextAction: nextActionSchema,
    selectable: z.boolean().meta({ description: 'True when the caller may select the dossier for the batch validation' }),
    createdAt: z.string().meta({ format: 'date-time' }),
  })
  .meta({ id: 'AbsenceSummaryDto' })
export type AbsenceSummary = z.infer<typeof absenceSummarySchema>

export const absencesListResponseSchema = z
  .object({ items: z.array(absenceSummarySchema).max(200), truncated: z.boolean() })
  .meta({ id: 'AbsencesListResponseDto' })

const proofSchema = z
  .object({
    company: z.string(),
    code: z.string(),
    sourceStatus: z.string(),
    observedAt: z.string().meta({ format: 'date-time' }),
  })
  .meta({ id: 'AbsencePayfitProofDto' })

export const absenceDetailSchema = absenceSummarySchema
  .extend({
    allowedActions: z.array(z.enum(ABSENCE_ACTIONS)),
    comment: z.string().nullable(),
    declaredAt: z.string().meta({ format: 'date-time' }),
    declaredBy: z.string(),
    employee: z.object({
      contractId: uuidFormat(),
      payfitContractId: z.string(),
      companyName: z.string(),
      employeeName: z.string(),
      startDate: isoDate(),
      endDate: isoDate().nullable(),
    }),
    expectedPiece: z.string().nullable(),
    lastDecision: z
      .object({
        kind: z.string(),
        byName: z.string(),
        at: z.string().meta({ format: 'date-time' }),
        reason: z.string().nullable(),
      })
      .nullable(),
    payfitAlert: z
      .object({
        kind: z.enum(['ANNULEE', 'MODIFIEE', 'DISPARUE']),
        change: z.string(),
        observedAt: z.string().meta({ format: 'date-time' }),
        priorProof: proofSchema.extend({ startDate: isoDate(), endDate: isoDate() }),
      })
      .nullable(),
    payfitCode: z.string().nullable(),
    payfitProof: proofSchema.nullable(),
    pieces: z.array(
      z.object({
        id: uuidFormat(),
        name: z.string(),
        sizeBytes: z.number().int(),
        confirmed: z.boolean(),
        addedByName: z.string(),
        canOpen: z.boolean(),
        privatePiece: z.boolean(),
      }),
    ),
    progress: z.object({ step: z.number().int().min(1).max(5), total: z.literal(5), label: z.string() }),
    timeline: z.array(
      z.object({
        at: z.string().meta({ format: 'date-time' }),
        kind: z.string(),
        text: z.string(),
        byName: z.string().nullable(),
      }),
    ),
  })
  .meta({ id: 'AbsenceDetailDto' })
export type AbsenceDetail = z.infer<typeof absenceDetailSchema>

/** `POST /absences`: 201 the new dossier, 200 the existing one when the declaration is an exact active duplicate. */
export const createAbsenceResponseSchema = z
  .union([absenceDetailSchema, z.object({ duplicate: z.literal(true), absence: absenceDetailSchema })])
  .meta({ id: 'AbsenceCreateResponseDto' })

export const validateBatchResponseSchema = z
  .object({
    validated: z.array(z.object({ id: uuidFormat(), status: z.literal('A_SAISIR') })),
    blocked: z.array(
      z.object({
        id: z.string(),
        employeeName: z.string().nullable(),
        blockages: z.array(blockageSchema).min(1),
      }),
    ),
  })
  .meta({ id: 'AbsenceValidateBatchResponseDto' })

/** rule-evp-todo-*: the period narrows the counters and the priority list; `to` cannot precede `from`. */
export const todoQuerySchema = z
  .object({
    from: isoDate().optional(),
    to: isoDate().optional(),
    crecheCode: crecheCodeSchema().optional(),
  })
  .refine((q) => !q.from || !q.to || q.to >= q.from, { message: '`to` cannot precede `from`', path: ['to'] })
export type TodoQuery = z.infer<typeof todoQuerySchema>

const counterSchema = z.object({ count: z.number().int().min(0), hint: z.string() })

export const todoResponseSchema = z
  .object({
    counters: z.object({ aCompleter: counterSchema, enAttente: counterSchema, refusees: counterSchema }),
    priority: z.array(absenceSummarySchema).max(50),
    recentActivity: z
      .array(z.object({ absenceId: uuidFormat(), at: z.string().meta({ format: 'date-time' }), text: z.string() }))
      .max(10),
  })
  .meta({ id: 'TodoResponseDto' })

export const absenceTypesResponseSchema = z
  .object({
    items: z.array(
      z.object({
        code: z.string(),
        label: z.string(),
        expectedPiece: z.string().nullable(),
        privatePiece: z.boolean(),
        hrReview: z.boolean(),
      }),
    ),
  })
  .meta({ id: 'AbsenceTypesResponseDto' })
