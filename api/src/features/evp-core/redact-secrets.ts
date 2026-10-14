import { NIR_IN_TEXT } from '../sources/nir'
import { evpConfig } from './evp-config'

const MASK = '[masqué]'
/** Access tokens held in memory (service account, introspection): registered when obtained. */
const runtimeSecrets = new Set<string>()

export function registerSecret(value: string | undefined | null): void {
  if (value && value.length >= 6) runtimeSecrets.add(value)
}

function jsonStrings(raw: string | undefined, pick: (entry: Record<string, unknown>) => unknown[]): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry) => (entry && typeof entry === 'object' ? pick(entry as Record<string, unknown>) : [])).filter((v): v is string => typeof v === 'string')
  } catch {
    return []
  }
}

/** Every secret value known from the configuration, whole and in the parts that could leak on their own. */
export function knownSecrets(): string[] {
  const config = evpConfig()
  const out = new Set<string>(runtimeSecrets)
  const add = (value: string | undefined): void => {
    if (value && value.length >= 6) out.add(value)
  }
  add(config.google?.clientSecret)
  const key = config.sources.sheets.privateKey
  if (key) {
    add(key)
    const pem = key.replace(/\\n/g, '\n')
    add(pem)
    for (const line of pem.split('\n')) if (line.length > 40 && !line.startsWith('-----')) add(line.trim())
  }
  for (const apiKey of jsonStrings(config.sources.payfit.apiKeysRaw, (e) => [e.apiKey])) add(apiKey)
  for (const url of jsonStrings(config.sources.aqoona.urlsRaw, (e) => [e.url])) {
    add(url)
    try {
      const parsed = new URL(url)
      add(parsed.search.slice(1))
      parsed.searchParams.forEach((value) => add(value))
      add(parsed.password)
    } catch {
      // an unreadable address is reported as not configured elsewhere
    }
  }
  return [...out]
}

/**
 * rule-evp-secrets-never-exposed: replaces every known secret value, and any `?…` tail of an address, by `[masqué]`.
 * Applied to each message before it is logged, stored or returned.
 */
export function redactSecrets(text: string): string {
  let out = text
  for (const secret of knownSecrets().sort((a, b) => b.length - a.length)) out = out.split(secret).join(MASK)
  return maskNirs(out.replace(/(https?:\/\/[^\s"'<>?]*)\?[^\s"'<>]*/g, `$1?${MASK}`))
}

/** rule-evp-aqoona-nir-never-stored, rule-evp-secrets-never-exposed: any text that looks like a NIR is replaced. */
export function maskNirs(text: string): string {
  return text.replace(NIR_IN_TEXT, MASK)
}

/**
 * rule-evp-aqoona-mask: where an address is shown, everything from the `?` is replaced by `?…`; the credentials
 * (`user:password@`) and the fragment are removed.
 */
export function maskUrl(address: string): string {
  try {
    const url = new URL(address)
    const shown = `${url.origin}${url.pathname}`
    return `${shown.length > 297 ? shown.slice(0, 297) : shown}?…`
  } catch {
    return '?…'
  }
}
