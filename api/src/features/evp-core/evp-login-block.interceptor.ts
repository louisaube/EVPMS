import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { Observable, from } from 'rxjs'
import { switchMap } from 'rxjs/operators'
import { Database, InjectDb } from '../../platform/database/database.module'
import { invalidCredentials } from '../../platform/http/errors'
import type { ApiRequest } from '../../platform/http/request-context'
import { evpAccounts } from '../access/access.tables'

/**
 * rule-evp-login-google-only: an EVP account has no usable password; the e-mail and password login of the foundation
 * answers the same single error as for a wrong password, whether or not the password is right.
 */
@Injectable()
export class EvpLoginBlockInterceptor implements NestInterceptor {
  constructor(@InjectDb() private readonly db: Database) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<ApiRequest>()
    if (req.method !== 'POST' || req.path !== '/auth/login') return next.handle()
    const email = (req.body as { email?: unknown } | undefined)?.email
    if (typeof email !== 'string') return next.handle()
    return from(
      this.db
        .select({ userId: evpAccounts.userId })
        .from(evpAccounts)
        .where(sql`lower(${evpAccounts.email}) = lower(${email.trim()})`)
        .limit(1),
    ).pipe(
      switchMap((rows) => {
        if (rows.length > 0) throw invalidCredentials()
        return next.handle()
      }),
    )
  }
}
