import { Injectable } from '@nestjs/common'
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm'
import { Database, InjectDb } from '../../platform/database/database.module'
import { ApiError, validationFailed } from '../../platform/http/errors'
import { evpAccounts } from '../access/access.tables'
import { absences } from '../absences/absences.tables'
import { DetailedApiError } from '../evp-core/evp-errors'
import type { EvpAccess } from '../evp-core/evp.types'
import { shiftMonth, todayParis } from '../evp-core/payroll-month'
import { assertCrecheInPerimeter } from '../evp-core/perimeter'
import type { AttestResponse, ClosureItem } from './closures.schemas'
import { closures } from './closures.tables'

/** rule-evp-closure-open-blocks: open = to complete, anticipated, to validate, to enter. */
export const OPEN_STATUSES = ['A_COMPLETER', 'ANTICIPEE', 'A_VALIDER', 'A_SAISIR'] as const

/** The current payroll month: the month of today up to the 25th, the following month after (rule of the 25th). */
export function currentPayrollMonth(): string {
  const today = todayParis()
  return Number(today.slice(8, 10)) <= 25 ? today.slice(0, 7) : shiftMonth(today.slice(0, 7), 1)
}

@Injectable()
export class ClosuresService {
  constructor(@InjectDb() private readonly db: Database) {}

  /** rule-evp-closure-attest: the current payroll month and the five previous ones, plus any closed month. */
  async list(evp: EvpAccess, code: string): Promise<{ items: ClosureItem[] }> {
    await assertCrecheInPerimeter(this.db, evp, code)
    const current = currentPayrollMonth()
    const closed = await this.db
      .select({
        month: closures.month,
        closedAt: closures.closedAt,
        closedByName: evpAccounts.name,
      })
      .from(closures)
      .leftJoin(evpAccounts, eq(evpAccounts.userId, closures.closedBy))
      .where(eq(closures.crecheCode, code))
    const byMonth = new Map(closed.map((row) => [row.month, row]))
    const months = new Set<string>(closed.map((row) => row.month))
    for (let back = 0; back <= 5; back++) months.add(shiftMonth(current, -back))
    const counts = await this.db
      .select({ month: absences.payrollMonth, n: count() })
      .from(absences)
      .where(and(eq(absences.crecheCode, code), inArray(absences.status, [...OPEN_STATUSES])))
      .groupBy(absences.payrollMonth)
    const openByMonth = new Map(counts.map((row) => [row.month, Number(row.n)]))
    const items = [...months].sort().map((month): ClosureItem => {
      const row = byMonth.get(month)
      return {
        month,
        status: row ? 'CLOTURE' : 'OUVERT',
        openCount: openByMonth.get(month) ?? 0,
        closedAt: row ? row.closedAt.toISOString() : null,
        closedByName: row ? (row.closedByName ?? '') : null,
      }
    })
    return { items }
  }

  /**
   * rule-evp-closure-attest, rule-evp-closure-open-blocks, rule-evp-closure-month-bounds, rule-evp-closure-no-reopen.
   * The (crèche, month) pair is locked, so that parallel attestations give one success and the others `already_closed`;
   * the open dossiers are counted again under the lock.
   */
  async attest(evp: EvpAccess, code: string, month: string): Promise<AttestResponse> {
    if (month > currentPayrollMonth()) {
      throw validationFailed([{ path: 'params.month', message: 'The month is in the future' }])
    }
    await assertCrecheInPerimeter(this.db, evp, code)
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`closure:${code}:${month}`}))`)
      const [existing] = await tx
        .select({ month: closures.month })
        .from(closures)
        .where(and(eq(closures.crecheCode, code), eq(closures.month, month)))
      if (existing) throw new ApiError(409, 'closures.already_closed', 'This month is already closed')
      const [{ openCount }] = await tx
        .select({ openCount: count() })
        .from(absences)
        .where(
          and(eq(absences.crecheCode, code), eq(absences.payrollMonth, month), inArray(absences.status, [...OPEN_STATUSES])),
        )
      if (Number(openCount) > 0) {
        throw new DetailedApiError(409, 'closures.open_absences', 'Open dossiers block the closure', {
          openCount: Number(openCount),
        })
      }
      const [row] = await tx
        .insert(closures)
        .values({ crecheCode: code, scopeCode: code, month, closedBy: evp.userId })
        .returning({ closedAt: closures.closedAt })
      return { month, status: 'CLOTURE' as const, closedAt: row.closedAt.toISOString(), closedByName: evp.name }
    })
  }
}
