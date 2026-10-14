import { z } from 'zod'
import { uuidFormat, uuidRefinement } from '../../platform/validation/common'
import { crecheCodeSchema } from '../evp-core/evp-query'

export const MAX_PIECE_BYTES = 10_485_760
export const PIECE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const

/** rule-evp-attach-formats: PDF, JPEG or PNG, 1 byte to 10 MiB, a file name of 1 to 255 characters. */
export const authorizeUploadBodySchema = z
  .object({
    crecheCode: crecheCodeSchema()
      .optional()
      .meta({ description: 'Crèche of the piece; defaults to the crèche of the dossier, else to the only crèche of the caller' }),
    absenceId: uuidFormat().optional().meta({ description: 'Dossier the piece is meant for; it is attached on confirmation' }),
    fileName: z
      .string()
      .min(1)
      .max(255)
      .refine((value) => !value.includes('\u0000'), 'Must not contain a null character'),
    contentType: z.enum(PIECE_TYPES),
    sizeBytes: z.number().int().min(1).max(MAX_PIECE_BYTES),
  })
  .meta({ id: 'PieceAuthorizeUploadParamsDto' })
export type AuthorizeUploadBody = z.infer<typeof authorizeUploadBodySchema>

export const authorizeUploadResponseSchema = z
  .object({
    id: uuidFormat(),
    method: z.literal('PUT'),
    uploadUrl: z.string(),
    headers: z.record(z.string(), z.string()),
    expiresAt: z.string().meta({ format: 'date-time' }),
  })
  .meta({ id: 'PieceAuthorizeUploadResponseDto' })

export const pieceParamsSchema = z.object({ id: uuidRefinement() })

export const confirmResponseSchema = z
  .object({
    id: uuidFormat(),
    name: z.string(),
    sizeBytes: z.number().int(),
    confirmed: z.literal(true),
  })
  .meta({ id: 'PieceConfirmResponseDto' })

export const readLinkResponseSchema = z
  .object({ url: z.string(), expiresAt: z.string().meta({ format: 'date-time' }) })
  .meta({ id: 'PieceReadLinkResponseDto' })

export const UPLOAD_TTL_SECONDS = 300
export const READ_TTL_SECONDS = 60
