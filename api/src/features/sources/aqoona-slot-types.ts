import { looksLikeNir } from './nir'

export type SlotType = 'GARDE' | 'PAUSE' | 'MENAGE' | 'AUTRE' | 'NON_PRECISE'
export type SlotTypeAliases = Partial<Record<'GARDE' | 'PAUSE' | 'MENAGE', string[]>>

/** What the anomaly of an unreadable type says instead of quoting it (rule-evp-aqoona-nir-no-trace-in-types). */
export const UNREADABLE_TYPE = 'Type illisible'

/** Lower case, no accent, no punctuation, single spaces: « Ménage », « MENAGE » and « menage » are the same. */
function comparable(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** The plural is ignored: « pauses » is « pause », « gardes » is « garde ». */
const singular = (text: string): string => text.split(' ').map((word) => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word)).join(' ')

/**
 * rule-evp-aqoona-slot-type-normalised: the one place that knows the aliases (they live in the mapping file). An empty or
 * absent type is `NON_PRECISE`, a known alias gives its type, any other non empty type is `AUTRE`. `label` is what the
 * anomaly of an `AUTRE` type shows: the normalised type, 1 to 100 characters, « Type illisible » when it looks like a NIR
 * or has nothing readable (rule-evp-aqoona-nir-no-trace-in-types).
 */
export function normaliseSlotType(raw: string | null | undefined, aliases: SlotTypeAliases | undefined): { type: SlotType; label: string | null } {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (text === '') return { type: 'NON_PRECISE', label: null }
  if (!looksLikeNir(text)) {
    const wanted = singular(comparable(text))
    for (const type of ['GARDE', 'PAUSE', 'MENAGE'] as const) {
      if ((aliases?.[type] ?? []).some((alias) => singular(comparable(alias)) === wanted)) return { type, label: null }
    }
    if (wanted !== '') return { type: 'AUTRE', label: wanted.slice(0, 100) }
  }
  return { type: 'AUTRE', label: UNREADABLE_TYPE }
}
