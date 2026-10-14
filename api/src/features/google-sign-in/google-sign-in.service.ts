import { Injectable } from '@nestjs/common'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { getConfig } from '../../platform/config/config'
import { Database, InjectDb } from '../../platform/database/database.module'
import { ApiError, isUniqueViolation } from '../../platform/http/errors'
import { users } from '../users/users.tables'
import { evpAccounts } from '../access/access.tables'
import { auditLogs } from '../audit/audit.tables'
import { EvpAccessService } from '../evp-core/evp-access.service'
import { evpConfig, GoogleConfig } from '../evp-core/evp-config'
import { EvpSessionService } from '../evp-core/evp-session.service'
import { SYSTEM_ACTOR_EMAIL, SYSTEM_ACTOR_ID } from '../evp-core/system-actor'
import { GoogleIdTokenVerifier, TokenRejected, VerifiedIdentity } from './google-id-token.verifier'

export const FLOW_COOKIE = 'evp-google-flow'
const FLOW_SECONDS = 10 * 60
const EXCHANGE_TIMEOUT_MS = 10_000

export type SignInError = 'domaine' | 'non_autorise' | 'annule' | 'echec' | 'adresse_modifiee' | 'compte_recree'

/** rule-evp-google-error-causes: the one table of the causes of refusal and of what the person is told. */
export function toLoginError(
  cause:
    | 'google_error'
    | 'hosted_domain'
    | 'account'
    | 'address_changed'
    | 'account_recreated'
    | 'flow'
    | 'token'
    | 'exchange'
    | 'keys'
    | 'timeout',
): SignInError {
  switch (cause) {
    case 'address_changed':
      return 'adresse_modifiee'
    case 'account_recreated':
      return 'compte_recree'
    case 'google_error':
      return 'annule'
    case 'hosted_domain':
      return 'domaine'
    case 'account':
      return 'non_autorise'
    default:
      return 'echec'
  }
}

interface Flow {
  state: string
  verifier: string
  nonce: string
  redirection: string
  expiresAt: number
}

const b64 = (input: Buffer | string): string => Buffer.from(input).toString('base64url')

/** rule-evp-login-safe-redirect: `/` followed by a path; never `//`, a backslash, a scheme or a control character. */
export function safeRedirection(value: string | undefined): string {
  if (!value || value.length > 300 || !value.startsWith('/') || value.startsWith('//')) return '/'
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return '/'
  try {
    const url = new URL(value, 'http://studio.invalid')
    if (url.origin !== 'http://studio.invalid') return '/'
  } catch {
    return '/'
  }
  return value
}

@Injectable()
export class GoogleSignInService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly access: EvpAccessService,
    private readonly sessions: EvpSessionService,
    private readonly verifier: GoogleIdTokenVerifier,
  ) {}

  private sign(payload: string): string {
    return b64(createHmac('sha256', getConfig().cookieSecret).update(payload).digest())
  }

  /** rule-evp-login-no-secret-in-studio: the state, the PKCE verifier and the nonce stay in a signed cookie. */
  start(redirection: string | undefined): { location: string; cookie: string } {
    const google = evpConfig().google
    if (!google) throw new ApiError(503, 'platform.service_unavailable', 'Google sign-in is not configured')
    const flow: Flow = {
      state: b64(randomBytes(24)),
      verifier: b64(randomBytes(48)),
      nonce: b64(randomBytes(16)),
      redirection: safeRedirection(redirection),
      expiresAt: Date.now() + FLOW_SECONDS * 1000,
    }
    const params = new URLSearchParams({
      client_id: google.clientId,
      redirect_uri: google.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: flow.state,
      nonce: flow.nonce,
      hd: google.allowedDomain,
      prompt: 'select_account',
      code_challenge: b64(createHash('sha256').update(flow.verifier).digest()),
      code_challenge_method: 'S256',
    })
    const payload = b64(JSON.stringify(flow))
    const separator = google.authUrl.includes('?') ? '&' : '?'
    return { location: `${google.authUrl}${separator}${params.toString()}`, cookie: `${payload}.${this.sign(payload)}` }
  }

  private readFlow(cookie: string | undefined): Flow | null {
    if (!cookie) return null
    const [payload, signature] = cookie.split('.')
    if (!payload || !signature) return null
    const expected = Buffer.from(this.sign(payload))
    const given = Buffer.from(signature)
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
    try {
      const flow = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Flow
      return flow.expiresAt > Date.now() ? flow : null
    } catch {
      return null
    }
  }

  /**
   * rule-evp-login-single-denial, rule-evp-login-domain-not-enough: the outcome is a redirection, never a JSON body.
   * Success: a session of 8 hours; no account is ever created by the sign-in.
   */
  async complete(
    query: { code?: string; state?: string; error?: string },
    flowCookie: string | undefined,
  ): Promise<{ error: SignInError } | { token: string; redirection: string }> {
    if (query.error) return { error: toLoginError('google_error') }
    const flow = this.readFlow(flowCookie)
    const google = evpConfig().google
    if (!flow || !google || !query.code || !query.state) return { error: toLoginError('flow') }
    const given = Buffer.from(query.state)
    const wanted = Buffer.from(flow.state)
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return { error: toLoginError('flow') }

    // rule-evp-google-token-verified-server: nothing is read from evp_accounts before the token is verified
    let identity: VerifiedIdentity
    try {
      identity = await this.exchange(query.code, flow, google)
    } catch (error) {
      if (error instanceof TokenRejected) return { error: error.refusal === 'domaine' ? toLoginError('hosted_domain') : toLoginError('token') }
      return { error: toLoginError('exchange') }
    }
    const resolved = await this.resolveAccount(identity)
    if ('error' in resolved) return resolved
    const [user] = await this.db.select({ role: users.role }).from(users).where(eq(users.id, resolved.userId))
    if (!user) return { error: toLoginError('account') }
    return { token: this.sessions.sign(resolved.userId, user.role, resolved.sessionVersion), redirection: flow.redirection }
  }

  /**
   * The seven cases of the decision table (rule-evp-google-sub-identity, rule-evp-google-sub-binding,
   * rule-evp-google-sub-email-mismatch, rule-evp-google-sub-recreated, rule-evp-google-sub-address-fix,
   * rule-evp-login-mismatch-admissible-only, rule-evp-login-mismatch-no-write, rule-evp-google-sub-unique): the person
   * is identified by `sub`. An unbound admissible account found by address (case ignored) is bound at the first valid
   * sign-in, in a transaction holding the row, so that two simultaneous sign-ins bind one `sub` only. The refusals
   * `adresse_modifiee` and `compte_recree` write nothing and are given for an admissible account only.
   */
  private async resolveAccount(
    identity: VerifiedIdentity,
  ): Promise<{ userId: string; sessionVersion: number } | { error: SignInError }> {
    const refused = { error: toLoginError('account') }
    try {
      return await this.db.transaction(async (tx) => {
        const [bound] = await tx
          .select({ userId: evpAccounts.userId, email: evpAccounts.email, sessionVersion: evpAccounts.sessionVersion })
          .from(evpAccounts)
          .where(eq(evpAccounts.googleSub, identity.sub))
          .for('update')
        if (bound) {
          // case 3: not admissible, whatever the address
          if (!(await this.usable(bound.userId))) return refused
          // case 2: the address of the token is not the registered one
          if (bound.email.trim().toLowerCase() !== identity.email) return { error: toLoginError('address_changed') }
          // case 1
          return { userId: bound.userId, sessionVersion: bound.sessionVersion }
        }

        const [candidate] = await tx
          .select({
            userId: evpAccounts.userId,
            googleSub: evpAccounts.googleSub,
            sessionVersion: evpAccounts.sessionVersion,
          })
          .from(evpAccounts)
          .where(sql`lower(${evpAccounts.email}) = ${identity.email}`)
          .for('update')
        // case 7
        if (!candidate) return refused
        // case 6
        if (!(await this.usable(candidate.userId))) return refused
        // case 5 (decision D-0008): bound to another sub, refused, binding unchanged
        if (candidate.googleSub !== null && candidate.googleSub !== identity.sub) {
          return { error: toLoginError('account_recreated') }
        }
        // case 4
        await tx.update(evpAccounts).set({ googleSub: identity.sub }).where(eq(evpAccounts.userId, candidate.userId))
        // rule-evp-google-sign-in-audit: the binding is traced, never with the sub
        await tx.insert(auditLogs).values({
          actorId: SYSTEM_ACTOR_ID,
          actorEmail: SYSTEM_ACTOR_EMAIL,
          action: 'access:google-link',
          objectType: 'Accès',
          objectId: candidate.userId,
          scopeCode: null,
          summary: 'Liaison Google enregistrée',
        })
        return { userId: candidate.userId, sessionVersion: candidate.sessionVersion }
      })
    } catch (error) {
      if (isUniqueViolation(error)) return refused
      throw error
    }
  }

  /** Active, registered, with a role and its crèches. */
  private async usable(userId: string): Promise<boolean> {
    try {
      await this.access.load(userId)
      return true
    } catch {
      return false
    }
  }

  /**
   * Code exchange on the back channel; the identity token is read from the response of Google itself and verified
   * (signature, audience, issuer, expiry, nonce, hosted domain, verified e-mail): TLS does not replace the signature.
   */
  private async exchange(code: string, flow: Flow, google: GoogleConfig): Promise<VerifiedIdentity> {
    let idToken: unknown
    try {
      const response = await fetch(google.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: google.clientId,
          client_secret: google.clientSecret,
          redirect_uri: google.redirectUri,
          grant_type: 'authorization_code',
          code_verifier: flow.verifier,
        }),
        redirect: 'manual',
        signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
      })
      if (!response.ok) throw new TokenRejected('echec')
      idToken = ((await response.json()) as { id_token?: unknown } | null)?.id_token
    } catch {
      throw new TokenRejected('echec')
    }
    return this.verifier.verify(idToken, google, flow.nonce)
  }
}
