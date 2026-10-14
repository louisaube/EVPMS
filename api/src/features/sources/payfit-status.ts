/** Statuses of an absence as PayFit gives them (rule-evp-payfit-status-all). */
export const PAYFIT_STATUSES = ['approved', 'pending_approval', 'declined', 'cancelled', 'pending_cancellation'] as const
export type PayfitStatus = (typeof PAYFIT_STATUSES)[number]

/** Statuses of the v1 vocabulary (fixtures and proofs recorded by the first version), read as their PayFit equivalent. */
const LEGACY: Record<string, PayfitStatus> = {
  VALIDATED: 'approved',
  CANCELED: 'cancelled',
  PENDING: 'pending_approval',
}

/**
 * rule-evp-payfit-status-admissible: the only place that knows both vocabularies. Returns the PayFit status, or the
 * raw text when it is neither (an unknown status confirms nothing and raises nothing).
 */
export function normalisePayfitStatus(raw: string | null | undefined): string {
  const value = String(raw ?? '')
  return LEGACY[value] ?? value
}

/** Raw statuses of an observed absence that do not count as an existing absence for the overlap control. */
export const NON_BLOCKING_STATUSES = ['CANCELED', 'cancelled', 'declined'] as const
