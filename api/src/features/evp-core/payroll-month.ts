const PARIS_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** `AAAA-MM-JJ` of an instant, Paris time. */
export function parisDay(instant: Date): string {
  return PARIS_DAY.format(instant)
}

export const todayParis = (): string => parisDay(new Date())

/** `AAAA-MM` shifted by `count` months. */
export function shiftMonth(month: string, count: number): string {
  const [year, number] = month.split('-').map(Number)
  const index = year * 12 + (number - 1) + count
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

/** `AAAA-MM-JJ` shifted by `count` days. */
export function shiftDay(day: string, count: number): string {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + count)
  return date.toISOString().slice(0, 10)
}

/**
 * rule-evp-closure-payroll-month (user): up to the 25th (included) of the month of creation, the payroll month is the
 * month the absence starts; after the 25th it is the month following the creation, unless the absence starts in a
 * later month, which is then retained. Creation day read in Paris time.
 */
export function payrollMonth(startDate: string, createdAt: Date): string {
  const created = parisDay(createdAt)
  const startMonth = startDate.slice(0, 7)
  if (Number(created.slice(8, 10)) <= 25) return startMonth
  const following = shiftMonth(created.slice(0, 7), 1)
  return startMonth > following ? startMonth : following
}
