import { blockage, periodsOverlap, slotOf, statusFor } from '../absence-checks'
import { allowedActionsFor } from '../absence-shapes'

const period = (startDate: string, startHalf: string, endDate: string, endHalf: string) => ({ startDate, startHalf, endDate, endHalf })

describe('absence rules (pure)', () => {
  it('[rule-evp-declare-overlap-blocks] half days are the unit of overlap', () => {
    const morning = period('2026-03-10', 'MATIN', '2026-03-10', 'MATIN')
    const afternoon = period('2026-03-10', 'APRES_MIDI', '2026-03-10', 'APRES_MIDI')
    expect(periodsOverlap(morning, afternoon)).toBe(false)
    expect(periodsOverlap(morning, period('2026-03-09', 'MATIN', '2026-03-10', 'MATIN'))).toBe(true)
    expect(periodsOverlap(afternoon, period('2026-03-10', 'MATIN', '2026-03-11', 'APRES_MIDI'))).toBe(true)
    expect(slotOf('2026-03-10', 'APRES_MIDI')).toBe(slotOf('2026-03-10', 'MATIN') + 1)
  })

  it('[rule-evp-states] blockages → to complete; otherwise anticipated or to validate by start date', () => {
    expect(statusFor([blockage('piece_missing')], '2020-01-01')).toBe('A_COMPLETER')
    expect(statusFor([], '2999-01-01')).toBe('ANTICIPEE')
    expect(statusFor([], '2020-01-01')).toBe('A_VALIDER')
  })

  it('[rule-evp-detail-actions-from-api] actions follow the state and the capabilities', () => {
    const declarant = { capabilities: ['absences:create'] } as never
    const rh = { capabilities: ['absences:create', 'absences:decide'] } as never
    expect(allowedActionsFor('A_VALIDER', declarant)).toEqual(['ATTACH', 'CANCEL', 'SUBMIT'])
    expect(allowedActionsFor('A_VALIDER', rh)).toEqual(['ATTACH', 'CANCEL', 'REJECT', 'RETURN', 'SUBMIT', 'VALIDATE'])
    expect(allowedActionsFor('A_SAISIR', declarant)).toEqual(['ATTACH'])
    expect(allowedActionsFor('DANS_PAYFIT', rh)).toEqual([])
    expect(allowedActionsFor('REJETEE', rh)).toEqual([])
  })
})
