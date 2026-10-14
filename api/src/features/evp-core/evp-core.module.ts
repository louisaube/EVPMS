import { Global, MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import type { NextFunction, Request, Response } from 'express'
import { EvpAccessService } from './evp-access.service'
import { EvpContextInterceptor } from './evp-context.interceptor'
import { EvpLoginBlockInterceptor } from './evp-login-block.interceptor'
import { EvpSessionService } from './evp-session.service'

const EVP_PATHS =
  /^\/(service-status|google-sign-in|profile|settings|access-accounts|creches|absence-types|todo|absences|justificatifs|notifications|journal-entries|exports|sources|test)(\/|$)/

/** rule-evp-no-store: nothing of the EVP is cached by the browser or an intermediary, errors and 404 included. */
function noStore(req: Request, res: Response, next: NextFunction): void {
  if (EVP_PATHS.test(req.path)) res.setHeader('Cache-Control', 'no-store')
  next()
}

const CLOSURE_PATH = /^(\/creches\/[^/?]+\/closures\/)([^?]*)(\?.*)?$/

/**
 * rule-evp-closure-month-bounds: a month written with a slash (`2026/01`) must reach the month validation (400), not fall
 * through to « route not found ». The extra slash is encoded so that the path still matches `:month`.
 */
function closureMonth(req: Request, _res: Response, next: NextFunction): void {
  const match = CLOSURE_PATH.exec(req.url)
  if (match && /^\d+\/\d+$/.test(match[2])) req.url = `${match[1]}${match[2].replace(/\//g, '%2F')}${match[3] ?? ''}`
  // a doubled question mark (`/absences??status=…`) is a client slip: the first parameter must not be lost
  if (EVP_PATHS.test(req.path) && req.url.includes('??')) req.url = req.url.replace(/\?\?+/, '?')
  next()
}

/** Shared code of the EVP modules: access resolution, 8 hour session, database identity. No route. */
@Global()
@Module({
  providers: [
    EvpAccessService,
    EvpSessionService,
    EvpContextInterceptor,
    { provide: APP_INTERCEPTOR, useClass: EvpLoginBlockInterceptor },
  ],
  exports: [EvpAccessService, EvpSessionService, EvpContextInterceptor],
})
export class EvpCoreModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(noStore, closureMonth).forRoutes({ path: '*path', method: RequestMethod.ALL })
  }
}
