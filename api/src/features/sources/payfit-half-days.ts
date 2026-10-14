export type Half = 'MATIN' | 'APRES_MIDI'

/**
 * rule-evp-payfit-half-day-source, rule-evp-payfit-half-day-mapping (inferred, decision D-0006): PayFit gives a
 * `moment` and nothing else. Read by position: at the start `beginning-of-day` is the morning and `middle-of-day` the
 * afternoon; at the end `middle-of-day` is the morning and `end-of-day` the afternoon. Any other combination is not
 * interpretable (null): the absence is kept, confirms nothing and is reported. Isolated here so that a different
 * decision changes one table.
 */
const START: Record<string, Half> = { 'beginning-of-day': 'MATIN', 'middle-of-day': 'APRES_MIDI' }
const END: Record<string, Half> = { 'middle-of-day': 'MATIN', 'end-of-day': 'APRES_MIDI' }

export function halfDays(
  startMoment: string | null | undefined,
  endMoment: string | null | undefined,
): { startHalf: Half; endHalf: Half } | null {
  const startHalf = START[String(startMoment)]
  const endHalf = END[String(endMoment)]
  return startHalf && endHalf ? { startHalf, endHalf } : null
}
