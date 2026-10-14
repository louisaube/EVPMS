import { Injectable } from '@nestjs/common'
import { createPublicKey, KeyObject } from 'node:crypto'
import jwt from 'jsonwebtoken'
import type { GoogleConfig } from '../evp-core/evp-config'

/** Why a token was refused: `domaine` for the hosted domain only, `echec` for everything else (rule-evp-google-error-causes). */
export type TokenRefusal = 'domaine' | 'echec'

export class TokenRejected extends Error {
  constructor(readonly refusal: TokenRefusal) {
    super('Identity token refused')
    this.name = 'TokenRejected'
  }
}

export interface VerifiedIdentity {
  sub: string
  email: string
}

const KEYS_TIMEOUT_MS = 10_000
/** rule-evp-google-exp (inferred): clock tolerance. */
const CLOCK_TOLERANCE_SECONDS = 60
/** rule-evp-google-certs-rotation (inferred): at most one forced re-read of the keys per minute. */
const FORCED_REREAD_MS = 60_000
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com']

interface KeyCache {
  keys: Map<string, KeyObject>
  expiresAt: number
}

/** `max-age` of the answer in seconds; 0 when absent, `no-cache`, `no-store` or unreadable. */
export function maxAgeSeconds(cacheControl: string | null): number {
  if (!cacheControl || /\b(no-cache|no-store)\b/i.test(cacheControl)) return 0
  const match = /\bmax-age=(\d+)/i.exec(cacheControl)
  return match ? Number(match[1]) : 0
}

/**
 * rule-evp-google-token-verified-server, rule-evp-google-signature: the identity token is verified here, with the public
 * keys of Google (RS256 only, key chosen by `kid`). The algorithm announced by the token is never obeyed.
 */
@Injectable()
export class GoogleIdTokenVerifier {
  private cache: KeyCache | null = null
  private inflight: Promise<KeyCache> | null = null
  private lastForcedAt = 0

  /** rule-evp-google-certs-fail-closed: unreadable, unreachable or empty keys refuse the token. */
  private async fetchKeys(certsUrl: string): Promise<KeyCache> {
    if (this.inflight) return this.inflight
    this.inflight = (async () => {
      try {
        const response = await fetch(certsUrl, { redirect: 'manual', signal: AbortSignal.timeout(KEYS_TIMEOUT_MS) })
        if (response.status !== 200) throw new TokenRejected('echec')
        const body = JSON.parse(await response.text()) as { keys?: unknown }
        if (!Array.isArray(body?.keys)) throw new TokenRejected('echec')
        const keys = new Map<string, KeyObject>()
        for (const jwk of body.keys as Array<Record<string, unknown>>) {
          if (!jwk || typeof jwk.kid !== 'string' || jwk.kty !== 'RSA') continue
          try {
            keys.set(jwk.kid, createPublicKey({ key: jwk as never, format: 'jwk' }))
          } catch {
            // an unreadable key is ignored: a token signed by it is refused
          }
        }
        const cache: KeyCache = { keys, expiresAt: Date.now() + maxAgeSeconds(response.headers.get('cache-control')) * 1000 }
        this.cache = cache
        return cache
      } catch (error) {
        this.cache = null
        throw error instanceof TokenRejected ? error : new TokenRejected('echec')
      } finally {
        this.inflight = null
      }
    })()
    return this.inflight
  }

  /** rule-evp-google-certs-cache, rule-evp-google-certs-rotation: the key of `kid`, from the cache or after one re-read. */
  private async keyFor(kid: string, certsUrl: string): Promise<KeyObject> {
    const now = Date.now()
    let fresh = false
    let cache = this.cache && this.cache.expiresAt > now ? this.cache : null
    if (!cache) {
      cache = await this.fetchKeys(certsUrl)
      fresh = true
    }
    let key = cache.keys.get(kid)
    if (!key && !fresh && now - this.lastForcedAt >= FORCED_REREAD_MS) {
      this.lastForcedAt = now
      cache = await this.fetchKeys(certsUrl)
      key = cache.keys.get(kid)
    }
    if (!key) throw new TokenRejected('echec')
    return key
  }

  /**
   * Verifies the token: signature, `aud`, `iss`, `exp`, `nonce`, `email_verified`, then `hd` (done by the code itself,
   * the libraries do not) and `sub`. Each check refuses on its own.
   */
  async verify(idToken: unknown, google: GoogleConfig, nonce: string): Promise<VerifiedIdentity> {
    if (typeof idToken !== 'string') throw new TokenRejected('echec')
    const decoded = jwt.decode(idToken, { complete: true })
    const kid = decoded && typeof decoded === 'object' ? decoded.header?.kid : undefined
    if (!decoded || decoded.header.alg !== 'RS256' || typeof kid !== 'string') throw new TokenRejected('echec')
    const key = await this.keyFor(kid, google.certsUrl)
    let claims: jwt.JwtPayload
    try {
      const verified = jwt.verify(idToken, key, { algorithms: ['RS256'], clockTolerance: CLOCK_TOLERANCE_SECONDS })
      if (typeof verified === 'string') throw new TokenRejected('echec')
      claims = verified
    } catch {
      throw new TokenRejected('echec')
    }
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    if (typeof claims.exp !== 'number') throw new TokenRejected('echec')
    if (!audiences.includes(google.clientId)) throw new TokenRejected('echec')
    if (typeof claims.iss !== 'string' || !ISSUERS.includes(claims.iss)) throw new TokenRejected('echec')
    if (claims.nonce !== nonce) throw new TokenRejected('echec')
    if (claims.email_verified !== true) throw new TokenRejected('echec')
    if (typeof claims.email !== 'string' || claims.email === '') throw new TokenRejected('echec')
    if (typeof claims.sub !== 'string' || claims.sub.length < 1 || claims.sub.length > 255) throw new TokenRejected('echec')
    // rule-evp-google-hd: no hosted domain (personal account) or another one is refused as « domaine »
    if (typeof claims.hd !== 'string' || claims.hd.toLowerCase() !== google.allowedDomain.toLowerCase()) throw new TokenRejected('domaine')
    return { sub: claims.sub, email: claims.email.toLowerCase() }
  }
}
