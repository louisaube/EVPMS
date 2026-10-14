import { z } from 'zod'

/** `from`: integer 0 to 2147483647, default 0. As in the foundation, the range is checked on the string form. */
const fromParam = z
  .string()
  .refine((s) => /^\d{1,10}$/.test(s) && Number(s) <= 2147483647, 'Must be an integer from 0 to 2147483647')
  .transform(Number)
  .meta({ type: 'integer', minimum: 0, maximum: 2147483647, description: 'Index of the first element (default 0)' })
  .optional()

/** `size`: one of 10, 25 or 50 (rule-evp-access-pagination). */
const sizeParam = (defaultSize: 10 | 25) =>
  z
    .string()
    .refine((s) => s === '10' || s === '25' || s === '50', 'Must be 10, 25 or 50')
    .transform(Number)
    .meta({ type: 'integer', enum: [10, 25, 50], default: defaultSize, description: `Page size (default ${defaultSize})` })
    .optional()

/** Pagination keys of the EVP lists. */
export const evpPageShape = (defaultSize: 10 | 25) => ({ from: fromParam, size: sizeParam(defaultSize) })

export const evpPageOf = (query: { from?: number; size?: number }, defaultSize: 10 | 25): { from: number; size: number } => ({
  from: query.from ?? 0,
  size: query.size ?? defaultSize,
})

/** `true` or `false` only. */
export const queryBoolean = (description: string) =>
  z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .meta({ type: 'boolean', description })
    .optional()

/** A calendar date `AAAA-MM-JJ` that exists. */
export const isoDate = () =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => {
      const date = new Date(`${value}T00:00:00Z`)
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    }, 'Not a calendar date')
    .meta({ format: 'date' })

/** A payroll month `AAAA-MM`. */
export const monthString = () =>
  z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .meta({ pattern: '^\\d{4}-(0[1-9]|1[0-2])$', example: '2026-03' })

/** A crèche code as the Sheets read produces it. */
export const crecheCodeSchema = () => z.string().min(1).max(20)

/** Integer count in a response. */
export const countSchema = () => z.number().int().min(0)
