import { z } from 'zod'
import { crecheCodeSchema, monthString } from '../evp-core/evp-query'

export const closureListParamsSchema = z.object({ code: crecheCodeSchema() })
export type ClosureListParams = z.infer<typeof closureListParamsSchema>

export const closureParamsSchema = z.object({ code: crecheCodeSchema(), month: monthString() })
export type ClosureParams = z.infer<typeof closureParamsSchema>

export const closureItemSchema = z
  .object({
    month: monthString(),
    status: z.enum(['OUVERT', 'CLOTURE']),
    openCount: z.number().int().min(0).meta({ description: 'Open dossiers (to complete, anticipated, to validate, to enter) of the month' }),
    closedAt: z.string().nullable().meta({ format: 'date-time' }),
    closedByName: z.string().nullable(),
  })
  .meta({ id: 'ClosureItemDto' })
export type ClosureItem = z.infer<typeof closureItemSchema>

export const closuresListResponseSchema = z.object({ items: z.array(closureItemSchema) }).meta({ id: 'ClosuresListResponseDto' })

/** rule-evp-closure-attest: the attestation is the literal `true`. */
export const attestBodySchema = z
  .object({ attested: z.literal(true).meta({ description: 'Must be true: the directrice attests the check of the absences' }) })
  .meta({ id: 'ClosureAttestParamsDto' })

export const attestResponseSchema = z
  .object({
    month: monthString(),
    status: z.literal('CLOTURE'),
    closedAt: z.string().meta({ format: 'date-time' }),
    closedByName: z.string(),
  })
  .meta({ id: 'ClosureAttestResponseDto' })
export type AttestResponse = z.infer<typeof attestResponseSchema>
