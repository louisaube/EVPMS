import { Controller, Get, Req, UseGuards, UseInterceptors } from '@nestjs/common'
import jwt from 'jsonwebtoken'
import { Access } from '../../platform/access/access.decorators'
import { ApiRoute, ApiTag } from '../../platform/openapi/route-contract'
import { SessionService } from '../../platform/security/session.service'
import { CapabilityGuard } from '../evp-core/capability.guard'
import { EvpContextInterceptor } from '../evp-core/evp-context.interceptor'
import { Evp } from '../evp-core/evp.decorators'
import { EVP_SESSION_SECONDS, EvpAccess, EvpRequest } from '../evp-core/evp.types'
import { ProfileResponse, profileResponseSchema } from './profile.schemas'

const UNAUTHORIZED = { description: 'Unauthorized - no session, invalid token or session older than 8 hours' }
const FORBIDDEN = { description: 'Forbidden - no EVP access (access.not_authorized) or inactive account (access.account_inactive)' }

/** rule-evp-rights-rechecked: the role, the status and the crèches are read in the database at every call. */
@Controller('profile')
@ApiTag('Profile')
@UseInterceptors(EvpContextInterceptor)
export class ProfileController {
  constructor(private readonly sessions: SessionService) {}

  @Get()
  @UseGuards(CapabilityGuard('profile:read'))
  @Access({ action: 'profile:read', roles: ['user'] })
  @ApiRoute({
    description: 'Use this API action to read the profile, the scope and the capabilities of the caller',
    responses: {
      200: { description: 'Profile of the caller', schema: profileResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
    },
  })
  read(@Evp() evp: EvpAccess, @Req() req: EvpRequest): ProfileResponse {
    // rule-evp-session-8h: the session ends 8 hours after the issue of the token (the guard refuses an older one)
    const source = this.sessions.tokenSource(req)
    const payload = source.kind === 'present' ? jwt.decode(source.token) : null
    const issuedAt = typeof payload === 'object' && payload !== null ? Number(payload.iat) : Date.now() / 1000
    return {
      id: evp.userId,
      name: evp.name,
      email: evp.email,
      role: evp.role,
      active: true,
      scope: evp.scope,
      creches: evp.creches,
      capabilities: evp.capabilities,
      sessionExpiresAt: new Date((issuedAt + EVP_SESSION_SECONDS) * 1000).toISOString(),
    }
  }
}
