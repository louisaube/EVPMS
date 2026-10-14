import { Injectable } from '@nestjs/common'
import type { Response } from 'express'
import jwt from 'jsonwebtoken'
import { getConfig } from '../../platform/config/config'
import { SessionService } from '../../platform/security/session.service'
import { EVP_SESSION_SECONDS } from './evp.types'

/**
 * rule-evp-session-8h: the session of an EVP account lasts 8 hours, whereas the foundation token lasts 24 hours.
 * Same claims and same cookie as the foundation (`sub`, `role`, `iat`, `exp`), so that the access guard accepts it.
 */
@Injectable()
export class EvpSessionService {
  constructor(private readonly sessions: SessionService) {}

  /** rule-evp-access-unlink-session: `sv` is the session version of the account at the time of the sign-in. */
  sign(userId: string, role: 'user' | 'admin', sessionVersion: number): string {
    return jwt.sign({ role, sv: sessionVersion }, getConfig().jwtSecret, {
      algorithm: 'HS256',
      subject: userId,
      expiresIn: EVP_SESSION_SECONDS,
    })
  }

  setCookie(res: Response, host: string, token: string): void {
    res.cookie(this.sessions.cookieName(host), token, {
      ...this.sessions.cookieOptions(host),
      maxAge: EVP_SESSION_SECONDS * 1000,
    })
  }
}
