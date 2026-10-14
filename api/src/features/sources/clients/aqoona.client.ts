import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { evpConfig } from '../../evp-core/evp-config'
import { maskUrl, registerSecret } from '../../evp-core/redact-secrets'
import { SourceError } from '../source-error'
import type { AqoonaData, AqoonaRow, Window } from '../source-connectors'
import { parseJson, SourceHttp } from './http-client'

/** rule-evp-aqoona-get-only: a reply is limited to 20 MB. */
export const MAX_AQOONA_BYTES = 20 * 1024 * 1024

const mappingSchema = z.object({
  records: z.string(),
  fields: z.object({
    matricule: z.string().min(1),
    prenom: z.string().min(1),
    nom: z.string().min(1),
    creche: z.string().min(1),
    jour: z.string().min(1),
    debut: z.string().min(1),
    fin: z.string().min(1),
    /** rule-evp-aqoona-mapping-final: optional, absent = every slot is `NON_PRECISE`. */
    type: z.string().min(1).optional(),
  }),
  dayFormat: z.enum(['YYYY-MM-DD', 'DD/MM/YYYY']),
  timeFormat: z.enum(['HH:mm', 'HH:mm:ss']),
  /** rule-evp-aqoona-slot-type-normalised: optional table of aliases, absent = any non empty type is `AUTRE`. */
  slotTypes: z
    .object({
      GARDE: z.array(z.string()).optional(),
      PAUSE: z.array(z.string()).optional(),
      MENAGE: z.array(z.string()).optional(),
    })
    .optional(),
})
export type AqoonaMapping = z.infer<typeof mappingSchema>

const invalidMapping = (): SourceError =>
  new SourceError('sources.not_configured', 'Le fichier de correspondance des champs Aqoona est invalide : vérifier AQOONA_MAPPING_FILE.')

/** rule-evp-aqoona-field-mapping: the mapping is configuration, validated at each reading; its content is never quoted. */
export function parseMapping(content: unknown): AqoonaMapping {
  const parsed = mappingSchema.safeParse(content)
  if (!parsed.success) throw invalidMapping()
  return parsed.data
}

export function loadMapping(path: string): AqoonaMapping {
  try {
    return parseMapping(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    throw invalidMapping()
  }
}

export interface AqoonaAddress {
  label: string
  url: string
}

const urlsSchema = z
  .array(z.object({ label: z.string().min(1).max(100).optional(), url: z.string().min(1).max(2000) }))
  .min(1)
  .max(50)

/**
 * rule-evp-aqoona-url-secret, rule-evp-aqoona-mask: the full address is a secret. The label is optional (`Adresse 1`,
 * `Adresse 2`…) and may not hold an address: it is shown on the screen.
 */
export function parseAqoonaUrls(raw: string | undefined): AqoonaAddress[] {
  if (!raw) throw new SourceError('sources.not_configured', "Aqoona n'est pas configuré : renseigner AQOONA_URLS.")
  const unreadable = new SourceError('sources.not_configured', 'La configuration des adresses Aqoona est illisible : vérifier AQOONA_URLS.')
  let entries: z.infer<typeof urlsSchema>
  try {
    entries = urlsSchema.parse(JSON.parse(raw))
  } catch {
    throw unreadable
  }
  return entries.map((entry, index) => {
    if (entry.label?.includes('://')) throw unreadable
    try {
      const url = new URL(entry.url)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw unreadable
    } catch {
      throw unreadable
    }
    return { label: entry.label ?? `Adresse ${index + 1}`, url: entry.url }
  })
}

/** A value below a dotted path of property names (an empty path is the document itself). */
export function readPath(document: unknown, path: string): unknown {
  if (path === '') return document
  let current: unknown = document
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

const str = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function parseDay(value: string | null, format: AqoonaMapping['dayFormat']): string | null {
  if (!value) return null
  const match = format === 'YYYY-MM-DD' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value)
  if (!match) return null
  const [year, month, dayOfMonth] = format === 'YYYY-MM-DD' ? [match[1], match[2], match[3]] : [match[3], match[2], match[1]]
  const iso = `${year}-${month}-${dayOfMonth}`
  const date = new Date(`${iso}T12:00:00Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? null : iso
}

function parseTime(value: string | null, format: AqoonaMapping['timeFormat']): string | null {
  if (!value) return null
  const match = (format === 'HH:mm' ? /^(\d{2}):(\d{2})$/ : /^(\d{2}):(\d{2}):(\d{2})$/).exec(value)
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || (match[3] !== undefined && Number(match[3]) > 59)) return null
  return `${match[1]}:${match[2]}`
}

/** rule-evp-aqoona-fields: one slot, or null when the crèche, the person, the day or an hour cannot be used. */
export function interpretRecord(record: unknown, mapping: AqoonaMapping): AqoonaRow | null {
  const field = (name: keyof AqoonaMapping['fields']): unknown => {
    const path = mapping.fields[name]
    return path === undefined ? undefined : readPath(record, path)
  }
  const crecheName = str(field('creche'))
  const day = parseDay(str(field('jour')), mapping.dayFormat)
  const start = parseTime(str(field('debut')), mapping.timeFormat)
  const end = parseTime(str(field('fin')), mapping.timeFormat)
  const matricule = str(field('matricule'))
  const firstName = str(field('prenom')) ?? ''
  const lastName = str(field('nom')) ?? ''
  if (!crecheName || !day || !start || !end || (!matricule && !firstName && !lastName)) return null
  // rule-evp-aqoona-nir-transient-key: `matricule` only carries a possible NIR, it is never stored
  const row: AqoonaRow = { firstName, lastName, matricule, crecheName, day, start, end }
  // `type` stays absent (not null) when the mapping has no such field: no slot is then reported « sans type »
  if (mapping.fields.type !== undefined) row.type = str(field('type'))
  return row
}

/**
 * rule-evp-aqoona-window-params: `dateBegin` and `dateEnd` are set on the configured address (any value already there is
 * replaced, every other parameter, `securityCheck` included, is kept as it is). Nothing else is added.
 */
export function withWindow(address: string, window: Window): string {
  const url = new URL(address)
  url.searchParams.set('dateBegin', window.from)
  url.searchParams.set('dateEnd', window.to)
  return url.toString()
}

/**
 * rule-evp-aqoona-unexpected-format (decision D-0004): a record that cannot be used is dropped and counted; the whole
 * answer of an address fails only when more than half of its records are unusable.
 */
export function interpretDocument(document: unknown, mapping: AqoonaMapping): { rows: AqoonaRow[]; unusable: number } {
  const records = readPath(document, mapping.records)
  if (!Array.isArray(records)) throw new SourceError('sources.unexpected_format', 'Réponse Aqoona inattendue.', 'Réponse inattendue')
  const rows: AqoonaRow[] = []
  let unusable = 0
  for (const record of records) {
    const row = interpretRecord(record, mapping)
    if (row) rows.push(row)
    else unusable++
  }
  if (unusable * 2 > records.length) {
    throw new SourceError('sources.unexpected_format', 'Réponse Aqoona inattendue : trop de lignes inexploitables.', 'Trop de lignes inexploitables')
  }
  return { rows, unusable }
}

/**
 * rule-evp-aqoona-get-only: one `GET` per address, as configured (the `securityCheck` is in the address): no header of
 * authentication, only `dateBegin` and `dateEnd` set, no redirection followed, `Accept: application/json`, 20 MB at most.
 */
export class AqoonaClient {
  constructor(private readonly http = new SourceHttp()) {}

  missingConfiguration(): string[] {
    return evpConfig().sources.aqoona.urlsRaw ? [] : ['AQOONA_URLS']
  }

  /** rule-evp-aqoona-mask: the addresses of the screen, masked; unreadable configuration shows none. */
  addresses(): Array<{ label: string; masked: string }> {
    try {
      return parseAqoonaUrls(evpConfig().sources.aqoona.urlsRaw).map((a) => ({ label: a.label, masked: maskUrl(a.url) }))
    } catch {
      return []
    }
  }

  async read(window: Window): Promise<AqoonaData> {
    const config = evpConfig().sources
    const addresses = parseAqoonaUrls(config.aqoona.urlsRaw)
    const mapping = loadMapping(config.aqoona.mappingFile)
    const rows: AqoonaRow[] = []
    const results: AqoonaData['addresses'] = []
    const failures: SourceError[] = []
    let unusable = 0
    for (const address of addresses) {
      registerSecret(address.url)
      try {
        // the completed address is as secret as the configured one
        const completed = withWindow(address.url, window)
        registerSecret(completed)
        const read = await this.readAddress(completed, mapping, config.retryDelayMs)
        rows.push(...read.rows.map((row) => ({ ...row, addressLabel: address.label })))
        unusable += read.unusable
        results.push({ label: address.label, ok: true, unusable: read.unusable })
      } catch (error) {
        const failure = error instanceof SourceError ? error : new SourceError('sources.unreachable', 'Adresse Aqoona injoignable.')
        failures.push(failure)
        results.push({ label: address.label, ok: false, unusable: 0, failure: { code: failure.code, detail: failure.detail } })
      }
    }
    // rule-evp-sources-partial-failure: every address failed → the whole reading fails
    if (failures.length === addresses.length) throw failures[0]
    return { rows, unusable, slotTypes: mapping.slotTypes, addresses: results }
  }

  private async readAddress(url: string, mapping: AqoonaMapping, retryDelayMs: number): Promise<{ rows: AqoonaRow[]; unusable: number }> {
    const answer = await this.http.get(url, {
      headers: { accept: 'application/json' },
      retryDelayMs,
      maxBytes: MAX_AQOONA_BYTES,
      unreachable: 'Adresse Aqoona injoignable.',
      tooLarge: 'Réponse Aqoona trop volumineuse.',
    })
    if (answer.status === 401 || answer.status === 403) {
      throw new SourceError('sources.refused', 'Adresse Aqoona refusée.', 'Adresse Aqoona refusée')
    }
    if (answer.status < 200 || answer.status >= 300) {
      throw new SourceError('sources.unreachable', 'Adresse Aqoona introuvable ou injoignable.', 'Adresse Aqoona injoignable')
    }
    return interpretDocument(parseJson(answer.text, 'Réponse Aqoona inattendue : ce n’est pas du JSON.'), mapping)
  }
}
