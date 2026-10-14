import { evpConfig } from '../evp-config'
import { maskUrl, redactSecrets, registerSecret } from '../redact-secrets'

describe('masking of secrets and addresses', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it('[rule-evp-aqoona-mask] an address keeps its origin and path, everything from the ? is hidden, credentials too', () => {
    expect(maskUrl('https://user:pass@aqoona.example/export/planning?token=abc123&x=1#frag')).toBe('https://aqoona.example/export/planning?…')
    expect(maskUrl('not an address')).toBe('?…')
  })

  it('[rule-evp-aqoona-mask] the masked address never exceeds 300 characters', () => {
    expect(maskUrl(`https://a.example/${'p'.repeat(500)}?t=1`).length).toBeLessThanOrEqual(300)
  })

  it('[rule-evp-secrets-never-exposed] configured secrets, runtime tokens and query tails are replaced', () => {
    process.env.PAYFIT_API_KEYS = '[{"siret":"11111111111111","apiKey":"payfit-secret-key-xyz"}]'
    process.env.AQOONA_URLS = '[{"url":"https://aqoona.example/a?token=tok-aqoona-777"}]'
    registerSecret('runtime-access-token-42')
    const text = 'Bearer payfit-secret-key-xyz, tok-aqoona-777, runtime-access-token-42, https://other.example/p?k=v'
    const out = redactSecrets(text)
    for (const secret of ['payfit-secret-key-xyz', 'tok-aqoona-777', 'runtime-access-token-42', 'k=v']) expect(out).not.toContain(secret)
    expect(out).toContain('[masqué]')
  })

  it('[rule-evp-google-not-configured] without the Google variables there is no Google configuration and no substitute value', () => {
    delete process.env.GOOGLE_CLIENT_ID
    delete process.env.GOOGLE_CLIENT_SECRET
    delete process.env.GOOGLE_PUBLIC_ORIGIN
    delete process.env.GOOGLE_REDIRECT_URI
    expect(evpConfig().google).toBeNull()
  })

  it('[rule-evp-google-endpoints-configurable] the only defaults are the official addresses and the return address comes from the public origin', () => {
    process.env.GOOGLE_CLIENT_ID = 'id.apps.googleusercontent.com'
    process.env.GOOGLE_CLIENT_SECRET = 'a-client-secret'
    process.env.GOOGLE_PUBLIC_ORIGIN = 'https://evp.example'
    delete process.env.GOOGLE_AUTH_URL
    delete process.env.GOOGLE_TOKEN_URL
    delete process.env.GOOGLE_CERTS_URL
    delete process.env.GOOGLE_ALLOWED_DOMAIN
    const google = evpConfig().google!
    expect(google.authUrl).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(google.tokenUrl).toBe('https://oauth2.googleapis.com/token')
    expect(google.certsUrl).toBe('https://www.googleapis.com/oauth2/v3/certs')
    expect(google.allowedDomain).toBe('micro-stars.fr')
    expect(google.redirectUri).toBe('https://evp.example/google-sign-in/callback')
  })
})
