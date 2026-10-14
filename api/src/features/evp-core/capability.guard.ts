import { CanActivate, ExecutionContext, Injectable, mixin, Type } from '@nestjs/common'
import jwt from 'jsonwebtoken'
import { accessDenied, invalidToken } from '../../platform/http/errors'
import { SessionService } from '../../platform/security/session.service'
import { EvpAccessService } from './evp-access.service'
import { Capability, EVP_SESSION_SECONDS, EvpRequest } from './evp.types'

/** `null`: any EVP account; a capability or a list (any of); a function of the request (e.g. a path parameter). */
export type CapabilitySpec = Capability | Capability[] | ((req: EvpRequest) => Capability[]) | null

/**
 * Business guard of every EVP route: the session of an EVP account lasts 8 hours (older token: 401), the account must
 * exist and be active, and hold one of the capabilities. It runs before the validation (rule-evp-declare-roles).
 */
export function CapabilityGuard(spec: CapabilitySpec = null): Type<CanActivate> {
  @Injectable()
  class Guard implements CanActivate {
    constructor(
      private readonly access: EvpAccessService,
      private readonly sessions: SessionService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
      const req = context.switchToHttp().getRequest<EvpRequest>()
      if (!req.user) throw invalidToken()
      const source = this.sessions.tokenSource(req)
      const payload = source.kind === 'present' ? jwt.decode(source.token) : null
      const issuedAt = typeof payload === 'object' && payload !== null ? Number(payload.iat) : NaN
      if (!Number.isFinite(issuedAt) || Date.now() / 1000 - issuedAt > EVP_SESSION_SECONDS) throw invalidToken()
      const evp = await this.access.load(req.user.id)
      // rule-evp-access-unlink-session (decision D-0011): a token without `sv` is version 0; a cut session is refused
      const carried = typeof payload === 'object' && payload !== null && payload.sv !== undefined ? Number(payload.sv) : 0
      if (!Number.isInteger(carried) || carried !== evp.sessionVersion) throw invalidToken()
      const wanted = typeof spec === 'function' ? spec(req) : spec === null ? [] : Array.isArray(spec) ? spec : [spec]
      if (wanted.length > 0 && !wanted.some((capability) => evp.capabilities.includes(capability))) {
        throw accessDenied()
      }
      req.evp = evp
      return true
    }
  }
  return mixin(Guard)
}
