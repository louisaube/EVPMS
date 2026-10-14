import { parisDay, payrollMonth, shiftDay, shiftMonth } from '../payroll-month'

describe('payroll month', () => {
  it('[rule-evp-closure-payroll-month] up to the 25th included, the month of the start date', () => {
    expect(payrollMonth('2026-03-10', new Date('2026-03-25T10:00:00Z'))).toBe('2026-03')
    expect(payrollMonth('2026-02-27', new Date('2026-03-25T10:00:00Z'))).toBe('2026-02')
  })

  it('[rule-evp-closure-payroll-month] from the 26th, the month following the creation', () => {
    expect(payrollMonth('2026-03-10', new Date('2026-03-26T10:00:00Z'))).toBe('2026-04')
  })

  it('[rule-evp-closure-payroll-month] an absence starting in a later month keeps its own month', () => {
    expect(payrollMonth('2026-06-02', new Date('2026-03-26T10:00:00Z'))).toBe('2026-06')
    expect(payrollMonth('2026-04-02', new Date('2026-03-26T10:00:00Z'))).toBe('2026-04')
  })

  it('[rule-evp-closure-payroll-month] the following month crosses the year', () => {
    expect(payrollMonth('2026-12-15', new Date('2026-12-28T10:00:00Z'))).toBe('2027-01')
  })

  it('[rule-evp-closure-payroll-month] the creation day is read in Paris time', () => {
    // 25 Mar 23:30 UTC is already the 26th in Paris (UTC+1 then UTC+2 after the 29th)
    expect(parisDay(new Date('2026-03-25T23:30:00Z'))).toBe('2026-03-26')
    expect(payrollMonth('2026-03-10', new Date('2026-03-25T23:30:00Z'))).toBe('2026-04')
  })

  it('shifts months and days across boundaries', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-11', 3)).toBe('2027-02')
    expect(shiftDay('2026-02-28', 1)).toBe('2026-03-01')
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
  })
})
