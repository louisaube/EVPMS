/**
 * rule-evp-sources-nir-redaction-studio, rule-evp-aqoona-nir-never-stored, rule-evp-nir-key-never-shown: defence in depth.
 * A NIR-looking run (13 digits, or 2A/2B at the 6th-7th positions, plus an optional 2-digit key, separators allowed,
 * delimited by non-digits) is replaced by « … ». A SIRET (14 digits) is not touched. A NIR with a wrong key looks
 * like a valid one and is masked the same way.
 */
export const NIR_LIKE = /(?<!\d)\d[ .-]?\d{2}[ .-]?\d{2}[ .-]?(?:\d{2}|2[AB])[ .-]?\d{3}[ .-]?\d{3}(?:[ .-]?\d{2})?(?!\d)/gi

export function redactNir(text: string): string {
  return text.replace(NIR_LIKE, '…')
}
