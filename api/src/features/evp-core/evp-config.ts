import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { API_DIR, currentEnvironment, getConfig } from '../../platform/config/config'

export type Driver = 'fake' | 'real'

/** rule-evp-google-endpoints-configurable: the only default values are the official addresses of Google. */
export interface GoogleConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  /** rule-evp-google-domain-configurable */
  allowedDomain: string
  authUrl: string
  tokenUrl: string
  certsUrl: string
}

/** Raw settings of the sources: parsed (and refused when unreadable) when a reading starts, never at import. */
export interface SourcesConfig {
  sheets: {
    baseUrl: string
    tokenUrl: string
    spreadsheetId?: string
    tabName: string
    range: string
    clientEmail?: string
    privateKey?: string
  }
  payfit: {
    baseUrl: string
    introspectUrl: string
    apiKeysRaw?: string
    typesFile: string
    retryDelayMs: number
  }
  aqoona: {
    urlsRaw?: string
    mappingFile: string
  }
  /** Base delay before a new try on 429 or 5xx for Sheets and Aqoona (PayFit has its own variable). */
  retryDelayMs: number
}

export interface EvpConfig {
  /** Connectors of the sources (Sheets, PayFit, Aqoona): fixtures files or real read-only clients. */
  sourcesDriver: Driver
  /** Storage of the supporting documents: local signed-URL double, or S3 compatible. */
  storageDriver: Driver
  fixturesDir: string
  storageDir: string
  /** null as soon as one of the identifiers is missing, outside production as well (no substitute value). */
  google: GoogleConfig | null
  sources: SourcesConfig
  maintenance: boolean
  /** Origin of the studio the browser is sent back to after the Google sign-in. */
  studioOrigin: string
  s3: { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string } | null
}

const read = (name: string): string | undefined => {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

const readNumber = (name: string, fallback: number): number => {
  const value = Number(read(name))
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

const trimSlash = (value: string): string => value.replace(/\/+$/, '')

/** A path designated by the environment: absolute, or relative to `api/` (then to the root of the repository). */
export function configFilePath(name: string, fallback: string): string {
  const given = read(name)
  if (!given) return join(API_DIR, fallback)
  if (isAbsolute(given)) return given
  const candidates = [join(API_DIR, given), join(API_DIR, '..', given)]
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]
}

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'
const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs'

/**
 * rule-evp-sources-credentials: the credentials of the sources and of the storage live in the environment only; no
 * route returns them.
 * Optional EVP settings, read from the environment at each call (`api/.env.<NODE_ENV>` is loaded by `getConfig`).
 * The test doubles of the sources are the default outside production; production refuses them
 * (rule-evp-settings-no-secret: nothing is ever returned).
 */
export function evpConfig(): EvpConfig {
  const base = getConfig()
  const production = currentEnvironment() === 'production'
  const driver = (name: string): Driver => {
    const wanted = read(name)
    if (production) return 'real'
    return wanted === 'real' ? 'real' : 'fake'
  }
  const clientId = read('GOOGLE_CLIENT_ID')
  const clientSecret = read('GOOGLE_CLIENT_SECRET')
  const publicOrigin = read('GOOGLE_PUBLIC_ORIGIN')
  const redirectUri = read('GOOGLE_REDIRECT_URI') ?? (publicOrigin ? `${trimSlash(publicOrigin)}/google-sign-in/callback` : undefined)
  const endpoint = read('EVP_S3_ENDPOINT')
  const bucket = read('EVP_S3_BUCKET')
  const accessKeyId = read('EVP_S3_ACCESS_KEY_ID')
  const secretAccessKey = read('EVP_S3_SECRET_ACCESS_KEY')
  const environment = currentEnvironment()
  const googleTokenUrl = read('GOOGLE_TOKEN_URL') ?? GOOGLE_TOKEN
  return {
    sourcesDriver: driver('EVP_SOURCES_DRIVER'),
    storageDriver: driver('EVP_STORAGE_DRIVER'),
    fixturesDir: join(API_DIR, `.evp-fixtures-${environment}`),
    storageDir: join(API_DIR, `.evp-storage-${environment}`),
    google:
      clientId && clientSecret && redirectUri
        ? {
            clientId,
            clientSecret,
            redirectUri,
            allowedDomain: read('GOOGLE_ALLOWED_DOMAIN') ?? 'micro-stars.fr',
            authUrl: read('GOOGLE_AUTH_URL') ?? GOOGLE_AUTH,
            tokenUrl: googleTokenUrl,
            certsUrl: read('GOOGLE_CERTS_URL') ?? GOOGLE_CERTS,
          }
        : null,
    sources: {
      sheets: {
        baseUrl: trimSlash(read('SHEETS_BASE_URL') ?? 'https://sheets.googleapis.com'),
        tokenUrl: read('SHEETS_TOKEN_URL') ?? googleTokenUrl,
        spreadsheetId: read('SHEETS_SPREADSHEET_ID'),
        tabName: read('SHEETS_TAB_NAME') ?? 'Contacts des crèches',
        range: read('SHEETS_RANGE') ?? 'A:G',
        clientEmail: read('SHEETS_CLIENT_EMAIL'),
        privateKey: read('SHEETS_PRIVATE_KEY'),
      },
      payfit: {
        baseUrl: trimSlash(read('PAYFIT_BASE_URL') ?? 'https://partner-api.payfit.com'),
        introspectUrl: read('PAYFIT_INTROSPECT_URL') ?? 'https://oauth.payfit.com/introspect',
        apiKeysRaw: read('PAYFIT_API_KEYS'),
        typesFile: configFilePath('PAYFIT_ABSENCE_TYPES_FILE', 'config/payfit-absence-types.json'),
        retryDelayMs: readNumber('PAYFIT_RETRY_DELAY_MS', 1000),
      },
      aqoona: {
        urlsRaw: read('AQOONA_URLS'),
        mappingFile: configFilePath('AQOONA_MAPPING_FILE', 'config/aqoona-mapping.json'),
      },
      retryDelayMs: readNumber('SOURCES_RETRY_DELAY_MS', readNumber('PAYFIT_RETRY_DELAY_MS', 1000)),
    },
    maintenance: read('EVP_MAINTENANCE') === 'true',
    studioOrigin: base.studioOrigins[0] ?? 'http://localhost:5173',
    s3:
      endpoint && bucket && accessKeyId && secretAccessKey
        ? { endpoint, region: read('EVP_S3_REGION') ?? 'eu-west-3', bucket, accessKeyId, secretAccessKey }
        : null,
  }
}
