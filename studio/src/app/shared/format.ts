/** Dates `jj/mm/aaaa`, heures `jj/mm/aaaa à hh:mm` (Europe/Paris), nombres au format français. */
const TZ = 'Europe/Paris'

export function halfLabel(half: string): string {
  return half === 'MATIN' ? 'matin' : 'après-midi'
}

/** `2026-11-03` → `03/11/2026` (calendar dates carry no time zone). */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

function parts(iso: string, seconds = false) {
  const f = new Intl.DateTimeFormat('fr-FR', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
    hourCycle: 'h23',
  })
  const map: Record<string, string> = {}
  for (const p of f.formatToParts(new Date(iso))) map[p.type] = p.value
  return map
}

export function formatDateTime(iso: string): string {
  const p = parts(iso)
  return `${p.day}/${p.month}/${p.year} à ${p.hour}:${p.minute}`
}

export function formatDateTimeSeconds(iso: string): string {
  const p = parts(iso, true)
  return `${p.day}/${p.month}/${p.year} à ${p.hour}:${p.minute}:${p.second}`
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('fr-FR').format(n)
}

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${formatNumber(Math.max(1, Math.round(bytes / 1024)))} Ko`
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))} Mio`
}

interface Period {
  startDate: string
  startHalf: string
  endDate: string
  endHalf: string
}

/** « 03/11/2026 (matin) → 05/11/2026 (après-midi) » */
export function periodArrow(a: Period): string {
  return `${formatDate(a.startDate)} (${halfLabel(a.startHalf)}) → ${formatDate(a.endDate)} (${halfLabel(a.endHalf)})`
}

/** « Du 03/11/2026 (matin) au 05/11/2026 (après-midi) » */
export function periodSentence(a: Period): string {
  return `Du ${formatDate(a.startDate)} (${halfLabel(a.startHalf)}) au ${formatDate(a.endDate)} (${halfLabel(a.endHalf)})`
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

/** `2026-10` → `octobre 2026` */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-')
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`
}

/** Today in Europe/Paris, `AAAA-MM-JJ`. */
export function todayParis(): string {
  const p = parts(new Date().toISOString())
  return `${p.year}-${p.month}-${p.day}`
}

export function toIsoDate(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export const MESSAGE_END_BEFORE_START = 'La date de fin doit suivre la date de début.'
