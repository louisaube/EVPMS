import { Controller, Get, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { Public } from '../../platform/access/access.decorators'
import { ApiRoute, ApiTag } from '../../platform/openapi/route-contract'
import { ValidQuery } from '../../platform/validation/zod-validation.interceptor'
import { evpConfig } from '../evp-core/evp-config'
import { EvpSessionService } from '../evp-core/evp-session.service'
import {
  CallbackQuery,
  callbackQuerySchema,
  StartQuery,
  startQuerySchema,
} from './google-sign-in.schemas'
import { FLOW_COOKIE, GoogleSignInService } from './google-sign-in.service'

const REDIRECT = { description: 'Redirection (no body)' }

function cookieValue(req: Request, name: string): string | undefined {
  for (const part of (req.header('cookie') ?? '').split(';')) {
    const index = part.indexOf('=')
    if (index !== -1 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim()
  }
  return undefined
}

/** Google Workspace sign-in (rule-evp-login-google-only): the browser is redirected, no body is ever returned. */
@Controller('google-sign-in')
@ApiTag('GoogleSignIn')
export class GoogleSignInController {
  constructor(
    private readonly service: GoogleSignInService,
    private readonly sessions: EvpSessionService,
  ) {}

  @Get('start')
  @Public()
  @ApiRoute({
    description: 'Use this API action to start the Google Workspace sign-in (redirection to Google)',
    query: startQuerySchema,
    responses: {
      302: REDIRECT,
      503: { description: 'Google sign-in is not configured (platform.service_unavailable)' },
    },
  })
  start(@ValidQuery() query: StartQuery, @Res() res: Response): void {
    const { location, cookie } = this.service.start(query.redirection)
    res.cookie(FLOW_COOKIE, cookie, {
      httpOnly: true,
      sameSite: 'lax',
      secure: new URL(evpConfig().studioOrigin).protocol === 'https:',
      path: '/google-sign-in',
      maxAge: 10 * 60 * 1000,
    })
    res.status(302).setHeader('Location', location)
    res.end()
  }

  @Get('callback')
  @Public()
  @ApiRoute({
    description:
      'Use this API action as the return address of Google: it opens the session (8 hours) and redirects to the studio',
    query: callbackQuerySchema,
    responses: { 302: REDIRECT },
  })
  async callback(@ValidQuery() query: CallbackQuery, @Req() req: Request, @Res() res: Response): Promise<void> {
    const studio = new URL(evpConfig().studioOrigin)
    res.clearCookie(FLOW_COOKIE, { path: '/google-sign-in' })
    // rule-evp-login-single-denial: whatever goes wrong, the outcome is a redirection, never a JSON body
    const outcome = await this.service.complete(query, cookieValue(req, FLOW_COOKIE)).catch((): { error: 'echec' } => ({ error: 'echec' }))
    if ('error' in outcome) {
      res.status(302).setHeader('Location', `${studio.origin}/connexion?erreur=${outcome.error}`)
      res.end()
      return
    }
    this.sessions.setCookie(res, studio.hostname, outcome.token)
    res.status(302).setHeader('Location', `${studio.origin}${outcome.redirection}`)
    res.end()
  }
}
