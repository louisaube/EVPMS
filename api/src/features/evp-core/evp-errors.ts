import { ApiError, notFound } from '../../platform/http/errors'
import type { ValidationDetail } from '../../platform/http/errors'

/**
 * An error whose `details` is an object (for instance `{ openCount }`) instead of the list of the validation errors.
 * The body stays `{ status, code, message, details }`: never a stack, SQL or path.
 */
export class DetailedApiError extends ApiError {
  constructor(
    status: number,
    code: string,
    message: string,
    readonly info: Record<string, unknown>,
  ) {
    super(status, code, message)
  }

  override toBody(): { status: number; code: string; message: string; details?: ValidationDetail[] } {
    return { status: this.status, code: this.code, message: this.message, details: this.info as never }
  }
}

/** A crèche outside the perimeter of the caller is indistinguishable from an unknown one (rule-evp-creche-scope). */
export const crecheNotFound = (): ApiError => notFound()
