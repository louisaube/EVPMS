import { z } from 'zod'
import { uuidFormat, uuidRefinement } from '../../platform/validation/common'
import { evpPageShape, isoDate } from '../evp-core/evp-query'
import { UNLINKED_CAUSES } from './link-causes'
import { SOURCE_ERROR_CODES } from './source-error'

export const SOURCE_KEYS = ['workspace', 'sheets', 'payfit', 'aqoona'] as const
export type SourceName = (typeof SOURCE_KEYS)[number]
export const READABLE_SOURCES = ['sheets', 'payfit', 'aqoona'] as const
export type ReadableSource = (typeof READABLE_SOURCES)[number]

export const sourceParamsSchema = z.object({ key: z.enum(SOURCE_KEYS) })
export type SourceParams = z.infer<typeof sourceParamsSchema>

export const runParamsSchema = z.object({ id: uuidRefinement() })

/** rule-evp-sources-no-invention: anomalies are listed, never corrected. */
export const anomaliesQuerySchema = z.object(evpPageShape(25))
export type AnomaliesQuery = z.infer<typeof anomaliesQuerySchema>

const volumeSchema = z.object({ label: z.string(), count: z.number().int().min(0) })

/** rule-evp-sources-error-codes: the five classified causes of a failed reading. */
const errorCodeSchema = z.enum(SOURCE_ERROR_CODES)

/** rule-evp-sources-failure-state: the cause of the last reading when it failed; a text without address, key or value. */
const lastErrorSchema = z
  .object({
    code: errorCodeSchema,
    message: z.string().min(1).max(200),
    at: z.string().meta({ format: 'date-time' }),
  })
  .meta({ id: 'SourceLastErrorDto' })

/** rule-evp-aqoona-mask: an address of Aqoona as shown, masked from the `?` on. */
const addressSchema = z
  .object({ label: z.string().min(1).max(100), masked: z.string().min(1).max(300) })
  .meta({ id: 'SourceAddressDto' })

export const sourceItemSchema = z
  .object({
    key: z.enum(SOURCE_KEYS),
    label: z.string(),
    /** PARTIAL: rule-evp-sources-partial-failure (decision D-0007). */
    state: z.enum(['NEVER_READ', 'UP_TO_DATE', 'RUNNING', 'ERROR', 'UNAVAILABLE', 'PARTIAL']),
    lastReadAt: z.string().meta({ format: 'date-time' }).nullable(),
    currentRunId: uuidFormat().nullable(),
    volumes: z.array(volumeSchema),
    anomalyCount: z.number().int().min(0),
    canRefresh: z.boolean(),
    windowFrom: isoDate().nullable(),
    windowTo: isoDate().nullable(),
    lastError: lastErrorSchema.nullable(),
    addresses: z.array(addressSchema),
  })
  .meta({ id: 'SourceItemDto' })

export const sourcesResponseSchema = z.object({ items: z.array(sourceItemSchema) }).meta({ id: 'SourcesResponseDto' })

export const startRunResponseSchema = z
  .object({ runId: uuidFormat(), state: z.literal('RUNNING') })
  .meta({ id: 'SourceStartRunResponseDto' })

export const startAllResponseSchema = z
  .object({ runId: uuidFormat(), steps: z.array(z.enum(READABLE_SOURCES)) })
  .meta({ id: 'SourceStartAllResponseDto' })

export const runResponseSchema = z
  .object({
    id: uuidFormat(),
    state: z.enum(['RUNNING', 'SUCCEEDED', 'FAILED']),
    step: z.string().nullable(),
    volumes: z.array(volumeSchema),
    errorMessage: z.string().min(1).max(200).nullable(),
    startedAt: z.string().meta({ format: 'date-time' }),
    finishedAt: z.string().meta({ format: 'date-time' }).nullable(),
  })
  .meta({ id: 'SourceRunDto' })

export const anomaliesResponseSchema = z
  .object({
    items: z.array(z.object({ type: z.string(), label: z.string(), subject: z.string(), detail: z.string() })),
    total: z.number().int().min(0),
  })
  .meta({ id: 'SourceAnomaliesResponseDto' })

/** rule-evp-matching-rates-people: the share of the people of one company in one part (`percent` = round(100 × count / total, 1)). */
const ratePartSchema = z.object({ count: z.number().int().min(0), percent: z.number().min(0).max(100) })

/** rule-evp-matching-rates-people, rule-evp-matching-rates-no-nir: identifiers, SIRET, company name and counts only; no NIR, no name of a person. */
export const sourceAqoonaMatchingRatesSchema = z
  .object({
    available: z.boolean(),
    lastReadAt: z.string().meta({ format: 'date-time' }).nullable(),
    windowFrom: isoDate().nullable(),
    windowTo: isoDate().nullable(),
    items: z
      .array(
        z.object({
          companyId: z.string().min(1).max(100).nullable(),
          siret: z.string().min(1).max(20).nullable(),
          name: z.string().min(1).max(200),
          total: z.number().int().min(1),
          linked: ratePartSchema,
          unlinked: ratePartSchema,
        }),
      )
      .max(200),
  })
  .meta({ id: 'SourceAqoonaMatchingRatesDto' })

/**
 * rule-evp-unlinked-list, rule-evp-unlinked-list-no-nir: a person not linked between Aqoona and PayFit, the cause and the crèches
 * where she was read; never a NIR, a fragment, an expected key or an identifier of PayFit.
 */
export const sourceAqoonaUnlinkedPeopleSchema = z
  .object({
    available: z.boolean(),
    lastReadAt: z.string().meta({ format: 'date-time' }).nullable(),
    windowFrom: isoDate().nullable(),
    windowTo: isoDate().nullable(),
    total: z.number().int().min(0),
    items: z
      .array(
        z.object({
          name: z.string().min(1).max(200),
          cause: z.enum(UNLINKED_CAUSES),
          causeLabel: z.string().min(1).max(100),
          creches: z.array(z.string().min(1).max(200)).max(50),
        }),
      )
      .max(50),
  })
  .meta({ id: 'SourceAqoonaUnlinkedPeopleDto' })

/** A volume read by a source, as shown on the screen. */
export interface Volume {
  label: string
  count: number
}

/** An anomaly of a source: French text, never a secret, a registration number or a medical detail. */
export interface Anomaly {
  type: string
  label: string
  subject: string
  detail: string
}
