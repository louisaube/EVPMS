import jwt from 'jsonwebtoken'
import { evpConfig } from '../../evp-core/evp-config'
import { registerSecret } from '../../evp-core/redact-secrets'
import { SourceError, statusCause } from '../source-error'
import type { SheetsRow } from '../source-connectors'
import { parseJson, SourceHttp } from './http-client'

/** rule-evp-sheets-scope-readonly: the only scope ever asked. */
export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'
const JWT_BEARER = 'urn:ietf:params:oauth:grant-type:jwt-bearer'
const ASSERTION_SECONDS = 3600

/** rule-evp-sheets-header-driven: headings compared without case, accents or surrounding blanks. */
export function normaliseHeading(text: unknown): string {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

const COLUMNS = {
  name: 'nom',
  code: 'code',
  siret: 'siret',
  loginEmail: 'adresse de connexion',
  directrice: 'directrice',
  roName: 'ro nom',
  roEmail: 'ro e-mail',
} as const

/**
 * rule-evp-sheets-columns, rule-evp-sheets-header-driven: the first row of the range is the heading; a missing heading
 * is an unexpected format. Rows without any cell are ignored.
 */
export function parseSheetRows(values: unknown): SheetsRow[] {
  if (values === undefined) return []
  if (!Array.isArray(values)) throw new SourceError('sources.unexpected_format', 'Réponse Google Sheets inattendue.')
  if (values.length === 0) return []
  const header = (Array.isArray(values[0]) ? values[0] : []).map(normaliseHeading)
  const index = {} as Record<keyof typeof COLUMNS, number>
  for (const [key, heading] of Object.entries(COLUMNS) as Array<[keyof typeof COLUMNS, string]>) {
    index[key] = header.indexOf(heading)
    if (index[key] === -1) {
      throw new SourceError('sources.unexpected_format', 'Le tableau des crèches ne porte pas tous les intitulés de colonnes attendus.')
    }
  }
  const cell = (row: unknown[], column: number): string => {
    const value = row[column]
    return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''
  }
  const rows: SheetsRow[] = []
  for (const raw of values.slice(1)) {
    if (!Array.isArray(raw) || raw.every((value) => String(value ?? '').trim() === '')) continue
    const roName = cell(raw, index.roName)
    const roEmail = cell(raw, index.roEmail)
    rows.push({
      name: cell(raw, index.name),
      code: cell(raw, index.code),
      siret: cell(raw, index.siret),
      loginEmail: cell(raw, index.loginEmail),
      directriceName: cell(raw, index.directrice),
      ros: roName || roEmail ? [{ name: roName, email: roEmail }] : [],
    })
  }
  return rows
}

/** rule-evp-sheets-values-get: the A1 range prefixed with the tab name between apostrophes (an apostrophe in the name is doubled). */
export function a1Range(tabName: string, range: string): string {
  return `'${tabName.replace(/'/g, "''")}'!${range}`
}

/** The private key of the service account as a PEM (the environment writes the line breaks `\n`). */
export function privateKeyPem(raw: string): string {
  return raw.replace(/\\n/g, '\n')
}

/**
 * rule-evp-sheets-values-get, rule-evp-sheets-service-account: reads the tab « Contacts des crèches » with one
 * `spreadsheets.values.get`, with the access token of the service account (flow JWT-bearer, cached until `expires_in`
 * minus 60 seconds). Nothing is ever written to Google.
 */
export class SheetsClient {
  private token: { value: string; expiresAt: number; owner: string } | null = null

  constructor(private readonly http = new SourceHttp()) {}

  private settings() {
    const { sheets, retryDelayMs } = evpConfig().sources
    const missing = [
      ['SHEETS_SPREADSHEET_ID', sheets.spreadsheetId],
      ['SHEETS_CLIENT_EMAIL', sheets.clientEmail],
      ['SHEETS_PRIVATE_KEY', sheets.privateKey],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name)
    if (missing.length > 0) {
      throw new SourceError('sources.not_configured', `Google Sheets n'est pas configuré : renseigner ${missing.join(', ')}.`)
    }
    return { ...sheets, spreadsheetId: sheets.spreadsheetId as string, clientEmail: sheets.clientEmail as string, privateKey: sheets.privateKey as string, retryDelayMs }
  }

  /** Names of the variables still to set (no value), for `GET /sources`. */
  missingConfiguration(): string[] {
    const { sheets } = evpConfig().sources
    return [
      ['SHEETS_SPREADSHEET_ID', sheets.spreadsheetId],
      ['SHEETS_CLIENT_EMAIL', sheets.clientEmail],
      ['SHEETS_PRIVATE_KEY', sheets.privateKey],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name as string)
  }

  private async accessToken(s: ReturnType<SheetsClient['settings']>): Promise<string> {
    const now = Date.now()
    if (this.token && this.token.owner === s.clientEmail && this.token.expiresAt > now) return this.token.value
    let assertion: string
    try {
      assertion = jwt.sign({ scope: SHEETS_SCOPE }, privateKeyPem(s.privateKey), {
        algorithm: 'RS256',
        issuer: s.clientEmail,
        audience: s.tokenUrl,
        expiresIn: ASSERTION_SECONDS,
      })
    } catch {
      throw new SourceError('sources.not_configured', "La clé privée du compte Google Sheets est illisible : vérifier SHEETS_PRIVATE_KEY.")
    }
    const answer = await this.http.postForm(
      s.tokenUrl,
      { grant_type: JWT_BEARER, assertion },
      { retryDelayMs: s.retryDelayMs, unreachable: "Google n'a pas répondu à la demande d'accès à Sheets." },
    )
    const cause = statusCause(answer.status)
    if (cause) {
      const refused = cause === 'sources.refused' || cause === 'sources.unexpected_format'
      throw new SourceError(
        refused ? 'sources.refused' : cause,
        refused ? 'Google a refusé le compte de service de Sheets.' : 'Google ne répond pas à la demande d’accès à Sheets.',
      )
    }
    const body = parseJson(answer.text, 'Réponse Google inattendue pour l’accès à Sheets.') as { access_token?: unknown; expires_in?: unknown }
    if (typeof body?.access_token !== 'string' || body.access_token === '') {
      throw new SourceError('sources.unexpected_format', 'Réponse Google inattendue pour l’accès à Sheets.')
    }
    registerSecret(body.access_token)
    registerSecret(assertion)
    const expiresIn = Number(body.expires_in)
    const ttl = Number.isFinite(expiresIn) ? Math.max(0, expiresIn - 60) : 0
    this.token = { value: body.access_token, expiresAt: Date.now() + ttl * 1000, owner: s.clientEmail }
    return body.access_token
  }

  async readContacts(): Promise<SheetsRow[]> {
    const s = this.settings()
    const token = await this.accessToken(s)
    const range = encodeURIComponent(a1Range(s.tabName, s.range))
    const url = `${s.baseUrl}/v4/spreadsheets/${encodeURIComponent(s.spreadsheetId)}/values/${range}?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`
    const answer = await this.http.get(url, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      retryDelayMs: s.retryDelayMs,
      unreachable: "Google Sheets n'a pas répondu.",
    })
    if (answer.status === 401 || answer.status === 403) {
      this.token = null
      throw new SourceError('sources.refused', 'Google Sheets a refusé la lecture : le classeur doit être partagé avec le compte de service.')
    }
    const cause = statusCause(answer.status)
    if (cause === 'sources.unexpected_format') {
      throw new SourceError(cause, "Google Sheets ne trouve pas l'onglet ou la plage demandés.")
    }
    if (cause === 'sources.rate_limited') throw new SourceError(cause, 'Google Sheets limite le débit des lectures.')
    if (cause) throw new SourceError('sources.unreachable', "Google Sheets est injoignable ou ne trouve pas le classeur.")
    const body = parseJson(answer.text, 'Réponse Google Sheets inattendue.') as { values?: unknown } | null
    if (body === null || typeof body !== 'object') throw new SourceError('sources.unexpected_format', 'Réponse Google Sheets inattendue.')
    return parseSheetRows(body.values)
  }
}
