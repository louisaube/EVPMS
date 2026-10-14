import { z } from 'zod'
import { uuidFormat } from '../../platform/validation/common'
import { crecheCodeSchema, isoDate } from '../evp-core/evp-query'

export const crecheParamsSchema = z.object({ code: crecheCodeSchema() })
export type CrecheParams = z.infer<typeof crecheParamsSchema>

export const crecheSchema = z
  .object({
    code: z.string().min(1).max(20),
    name: z.string(),
    siret: z.string(),
    directriceName: z.string().nullable(),
    roNames: z.array(z.string()),
    verified: z.boolean().meta({ description: 'True for a crèche present in the last successful Sheets read' }),
  })
  .meta({ id: 'CrecheDto' })

export const crechesListResponseSchema = z.object({ items: z.array(crecheSchema) }).meta({ id: 'CrechesListResponseDto' })

/** `size` 1 to 20 (default 20), `search` 0 to 100 characters. */
export const contractsQuerySchema = z.object({
  search: z.string().max(100).optional().meta({ description: 'Part of the name of the employee' }),
  size: z
    .string()
    .refine((s) => /^\d{1,2}$/.test(s) && Number(s) >= 1 && Number(s) <= 20, 'Must be an integer from 1 to 20')
    .transform(Number)
    .meta({ type: 'integer', minimum: 1, maximum: 20, default: 20 })
    .optional(),
})
export type ContractsQuery = z.infer<typeof contractsQuerySchema>

export const contractSchema = z
  .object({
    contractId: uuidFormat().meta({ description: 'Local identifier of the pair company + PayFit contract' }),
    payfitContractId: z.string(),
    employeeName: z.string(),
    startDate: isoDate(),
    endDate: isoDate().nullable(),
  })
  .meta({ id: 'CrecheContractDto' })

export const contractsResponseSchema = z
  .object({
    items: z.array(contractSchema).max(20),
    planningRestricted: z
      .boolean()
      .meta({ description: 'True when the crèche shares its SIRET with another verified crèche (rule-evp-siret-shared-contracts-flag)' }),
  })
  .meta({ id: 'CrecheContractsResponseDto' })
