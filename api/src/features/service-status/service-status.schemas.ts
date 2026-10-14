import { z } from 'zod'

export const serviceStatusResponseSchema = z
  .object({
    status: z.enum(['ready', 'unavailable']),
    reason: z.enum(['google_not_configured', 'database_unreachable', 'maintenance']).nullable(),
    message: z.string().max(300),
  })
  .meta({ id: 'ServiceStatusResponseDto' })
export type ServiceStatusResponse = z.infer<typeof serviceStatusResponseSchema>
