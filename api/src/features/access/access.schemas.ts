import { z } from 'zod'
import { idParamsSchema, uuidFormat } from '../../platform/validation/common'
import { isValidEmail } from '../../platform/validation/email'
import { crecheCodeSchema, evpPageShape, queryBoolean } from '../evp-core/evp-query'

export const accessIdParamsSchema = idParamsSchema

/** Roles an access administrator can give: the privileged roles are never created from the application. */
export const manageableRoleSchema = z.enum(['RO', 'DIRECTRICE'])

/** rule-evp-access-pagination: `size` 10, 25 or 50 (default 10), `from` ≥ 0, `search` 1 to 100 characters. */
export const accessListQuerySchema = z.object({
  search: z.string().min(1).max(100).optional().meta({ description: 'Part of the name or of the e-mail address' }),
  role: manageableRoleSchema.optional().meta({ description: 'DIRECTRICE is reserved to the superadmin' }),
  active: queryBoolean('Only the active (true) or the inactive (false) accounts'),
  ...evpPageShape(10),
})
export type AccessListQuery = z.infer<typeof accessListQuerySchema>

const crecheRefSchema = z
  .object({ code: z.string().min(1).max(20), name: z.string() })
  .meta({ id: 'AccessCrecheDto' })

export const accessAccountSchema = z
  .object({
    id: uuidFormat(),
    name: z.string().min(1).max(120),
    email: z.string().max(254),
    role: manageableRoleSchema,
    active: z.boolean(),
    /** rule-evp-access-google-linked-visible: `google_sub` is not null; the identifier itself never leaves the API. */
    googleLinked: z.boolean().meta({ description: 'Whether the access is bound to a Google account' }),
    creches: z.array(crecheRefSchema).max(50),
  })
  .meta({ id: 'AccessAccountDto' })
export type AccessAccountDto = z.infer<typeof accessAccountSchema>

export const accessListResponseSchema = z
  .object({ items: z.array(accessAccountSchema).max(50), total: z.number().int().min(0) })
  .meta({ id: 'AccessListResponseDto' })

const nameSchema = z
  .string()
  .min(1)
  .max(120)
  .refine((value) => value.trim().length > 0, 'Must not be blank')
  .transform((value) => value.trim())
  .meta({ description: 'Display name, 1 to 120 characters', example: 'Rosa Alpha' })

const crecheCodesSchema = z
  .array(crecheCodeSchema())
  .max(50)
  .meta({ description: 'Codes of the verified crèches the account is assigned to (0 to 50)' })

/** rule-evp-access-admin: the domain (422) and the crèches (422) are business checks, not bounds. */
export const createAccessBodySchema = z
  .object({
    email: z
      .string()
      .max(254)
      .refine(isValidEmail, 'Invalid e-mail address')
      .meta({ description: 'Address ending with @micro-stars.fr, at most 254 characters', example: 'rosa@micro-stars.fr' }),
    name: nameSchema,
    role: manageableRoleSchema,
    active: z.boolean(),
    crecheCodes: crecheCodesSchema,
  })
  .meta({ id: 'AccessCreateParamsDto' })
export type CreateAccessBody = z.infer<typeof createAccessBodySchema>

/** rule-evp-access-address-edit: the address is optional; unknown keys are refused. The domain (422) is a business check. */
export const updateAccessBodySchema = z
  .strictObject({
    email: z
      .string()
      .max(254)
      .refine(isValidEmail, 'Invalid e-mail address')
      .optional()
      .meta({ description: 'New address ending with @micro-stars.fr, at most 254 characters, compared ignoring case' }),
    name: nameSchema.optional(),
    role: manageableRoleSchema.optional(),
    active: z.boolean().optional(),
    crecheCodes: crecheCodesSchema.optional(),
  })
  .meta({ id: 'AccessUpdateParamsDto', additionalProperties: undefined })
export type UpdateAccessBody = z.infer<typeof updateAccessBodySchema>
