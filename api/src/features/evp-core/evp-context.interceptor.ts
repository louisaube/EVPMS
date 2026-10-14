import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { Observable, from, lastValueFrom } from 'rxjs'
import { Database, InjectDb } from '../../platform/database/database.module'
import { ambientTransaction } from '../../platform/database/transaction-context'
import type { EvpAccess, EvpRequest } from './evp.types'

type Executor = Pick<Database, 'execute'>

/**
 * rule-evp-rights-db-enforced: the handler of an EVP route runs under the non-bypassing role `evp_app`, with the
 * identity of the caller in two transaction settings read by the row level security policies. Attached to every EVP
 * controller; innermost, so it joins the transaction of a traced route or opens its own.
 */
@Injectable()
export class EvpContextInterceptor implements NestInterceptor {
  constructor(@InjectDb() private readonly db: Database) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const evp = context.switchToHttp().getRequest<EvpRequest>().evp
    if (!evp) return next.handle()
    const run = () => lastValueFrom(next.handle(), { defaultValue: undefined })
    const ambient = ambientTransaction.getStore()
    if (ambient) {
      return from(applyIdentity(ambient.tx, evp).then(run))
    }
    return from(
      this.db.transaction(async (tx) => {
        await applyIdentity(tx, evp)
        return ambientTransaction.run({ tx: tx as unknown as Database }, run)
      }),
    )
  }
}

async function applyIdentity(executor: Executor, evp: EvpAccess): Promise<void> {
  await executor.execute(sql`set local role evp_app`)
  await executor.execute(
    sql`select set_config('evp.user_id', ${evp.userId}, true), set_config('evp.scope_all', ${evp.scope === 'ALL' ? 'true' : 'false'}, true)`,
  )
}
