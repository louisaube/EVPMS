import { z } from 'zod'
import { uuidFormat } from '../../platform/validation/common'
import { EVP_CAPABILITIES } from '../evp-core/evp.types'

export const profileResponseSchema = z
  .object({
    id: uuidFormat(),
    name: z.string().min(1).max(120),
    email: z.string().max(254),
    role: z.enum(['DIRECTRICE', 'RO', 'RH', 'ADMINISTRATRICE', 'SUPERADMIN']),
    active: z.literal(true),
    scope: z.enum(['ASSIGNED', 'ALL']).meta({ description: 'ALL: global consultation; ASSIGNED: only the crèches listed' }),
    creches: z.array(z.object({ code: z.string().min(1).max(20), name: z.string() }).meta({ id: 'ProfileCrecheDto' })),
    capabilities: z.array(z.enum(EVP_CAPABILITIES)).meta({ description: 'Capabilities held by the role (rule-evp-capabilities-list)' }),
    sessionExpiresAt: z.string().meta({ format: 'date-time', description: 'End of the session: 8 hours after the issue of the token' }),
  })
  .meta({ id: 'ProfileResponseDto' })
export type ProfileResponse = z.infer<typeof profileResponseSchema>
