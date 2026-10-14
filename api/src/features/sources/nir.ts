/**
 * rule-evp-aqoona-nir-format: the one definition of what looks like a NIR (French social security number): 13 characters
 * (sex, year, month, department `2A`/`2B` included, commune, order) and, normally, the 2-digit key, so 15 characters.
 * rule-evp-aqoona-nir-never-stored: nothing in this file writes, logs or exports a value.
 */
export const NIR_PATTERN = /^[12]\d{4}(\d{2}|2[AB])\d{6}(\d{2})?$/i

/** Same shape inside a text, with the usual separators (space, dot, hyphen) and no digit around it. */
export const NIR_IN_TEXT = /(?<![\dA-Za-z])[12][\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?(?:\d{2}|2[AB])[\s.-]?\d{3}[\s.-]?\d{3}(?:[\s.-]?\d{2})?(?![\dA-Za-z])/gi

const SEPARATORS = /[\s.-]/g

/** The value without separators and in upper case when it is a NIR of 13 or 15 characters, else null. */
function normalised(raw: string): string | null {
  const value = raw.replace(SEPARATORS, '').toUpperCase()
  return NIR_PATTERN.test(value) ? value : null
}

/** rule-evp-aqoona-nir-format: the 15 characters of a complete NIR (key included), else null. */
export function canonicalNir(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null
  const value = normalised(String(raw))
  return value !== null && value.length === 15 ? value : null
}

/**
 * The key under which PayFit delivers a number: 15 characters, or only the 13 first when PayFit gives no key
 * (rule-evp-aqoona-nir-format). Null when it is not a NIR.
 */
export function payfitNirKey(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null
  return normalised(String(raw))
}

/** Whether a text is a NIR (13 or 15 characters, separators ignored): used to keep it out of types and messages. */
export function looksLikeNir(text: string): boolean {
  return normalised(text.trim()) !== null
}

/**
 * rule-evp-nir-key-formula: the check key of a complete NIR (15 characters) is `97 − (N mod 97)` on two digits, where N is
 * formed by the 13 first characters (`2A` → 19, `2B` → 18). N exceeds 2^53: `BigInt`. A key `00` is always wrong.
 * rule-evp-nir-key-never-shown: returns a boolean only, the expected key is never exposed.
 */
export function nirKeyIsValid(raw: unknown): boolean {
  const value = canonicalNir(raw)
  if (value === null) return false
  const head = value.slice(0, 13).replace('2A', '19').replace('2B', '18')
  if (!/^\d{13}$/.test(head)) return false
  const key = value.slice(13)
  return key !== '00' && Number(key) === Number(97n - (BigInt(head) % 97n))
}

/** rule-evp-payfit-scope-format: the scope required to read the NIR of the collaborators, compared exactly. */
export const NIR_SCOPE = 'collaborators:social-security:read'
