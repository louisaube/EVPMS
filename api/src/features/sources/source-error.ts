/** rule-evp-sources-error-codes: the causes of a failed reading, classified. */
export const SOURCE_ERROR_CODES = [
  'sources.not_configured',
  'sources.unreachable',
  'sources.refused',
  'sources.rate_limited',
  'sources.unexpected_format',
] as const
export type SourceErrorCode = (typeof SOURCE_ERROR_CODES)[number]

export const MAX_ERROR_MESSAGE = 200

/**
 * The only failure the clients throw. `message` is French, of 1 to 200 characters and names the source and the cause,
 * never a value (rule-evp-secrets-never-exposed); `detail` is the short cause shown in the anomaly of a company or of an
 * address that failed among others (rule-evp-sources-partial-failure). Both are fixed texts: the exception of an HTTP
 * library is never relayed.
 */
export class SourceError extends Error {
  constructor(
    readonly code: SourceErrorCode,
    message: string,
    readonly detail: string = message,
  ) {
    super(message.slice(0, MAX_ERROR_MESSAGE))
    this.name = 'SourceError'
  }
}

export const isSourceError = (error: unknown): error is SourceError => error instanceof SourceError

/** What `status` of an HTTP answer means for the reading (after the retries). `null`: the answer is usable. */
export function statusCause(status: number): SourceErrorCode | null {
  if (status >= 200 && status < 300) return null
  if (status === 401 || status === 403) return 'sources.refused'
  if (status === 429) return 'sources.rate_limited'
  if (status === 400) return 'sources.unexpected_format'
  return 'sources.unreachable'
}
