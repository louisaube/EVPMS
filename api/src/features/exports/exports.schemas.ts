import { z } from 'zod'
import { isoDate } from '../evp-core/evp-query'

const DAY_MS = 86_400_000
export const MAX_EXPORT_DAYS = 366

/** rule-evp-export-max-span: `to` is not before `from`, and the period covers 366 days at most (bounds included). */
export const exportBodySchema = z
  .object({ from: isoDate(), to: isoDate() })
  .refine((body) => body.to >= body.from, { message: '`to` cannot precede `from`', path: ['to'] })
  .refine((body) => (Date.parse(body.to) - Date.parse(body.from)) / DAY_MS + 1 <= MAX_EXPORT_DAYS, {
    message: 'The period covers 366 days at most',
    path: ['to'],
  })
  .meta({ id: 'ExportAbsencesParamsDto' })
export type ExportBody = z.infer<typeof exportBodySchema>

export const exportResponseSchema = z
  .string()
  .meta({ description: 'CSV file: UTF-8 with BOM, semicolon separated, CRLF lines, quoted cells' })
