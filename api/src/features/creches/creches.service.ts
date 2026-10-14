import { Injectable } from '@nestjs/common'
import { and, asc, count, eq, inArray, ne, sql, SQL } from 'drizzle-orm'
import { Database, InjectDb } from '../../platform/database/database.module'
import type { EvpAccess } from '../evp-core/evp.types'
import { assertCrecheInPerimeter } from '../evp-core/perimeter'
import { aqoonaPlannings, payfitCompanies, payfitContracts, payfitEmployees } from '../sources/sources.tables'
import type { ContractsQuery } from './creches.schemas'
import { creches } from './creches.tables'

@Injectable()
export class CrechesService {
  constructor(@InjectDb() private readonly db: Database) {}

  /** rule-evp-creche-scope: assigned crèches for a directrice or a RO, all of them for the global roles. */
  async list(evp: EvpAccess) {
    const where = evp.scope === 'ALL' ? undefined : inArray(creches.code, evp.creches.map((c) => c.code))
    const rows = await this.db
      .select({
        code: creches.code,
        name: creches.name,
        siret: creches.siret,
        directriceName: creches.directriceName,
        roNames: creches.roNames,
        verified: creches.verified,
      })
      .from(creches)
      .where(where)
      .orderBy(asc(creches.name), asc(creches.code))
    return { items: rows }
  }

  /**
   * rule-evp-creche-link-siret: the contracts of the PayFit company whose SIRET is the one of the crèche; no contract
   * when no company, or several, carry it. rule-evp-declare-employee-key: `contractId` is the local identifier.
   */
  async contracts(evp: EvpAccess, code: string, query: ContractsQuery) {
    const creche = await assertCrecheInPerimeter(this.db, evp, code)
    // rule-evp-siret-shared-contracts-flag: another verified crèche of the referential carries the same SIRET
    const [{ others }] = await this.db
      .select({ others: count() })
      .from(creches)
      .where(and(eq(creches.siret, creche.siret), eq(creches.verified, true), ne(creches.code, code)))
    const planningRestricted = Number(others) > 0
    const companies = await this.db
      .select({ id: payfitCompanies.id })
      .from(payfitCompanies)
      .where(eq(payfitCompanies.siret, creche.siret))
    if (companies.length !== 1) return { items: [], planningRestricted }
    const companyId = companies[0].id
    // rule-evp-declare-contracts-not-archived, rule-evp-declare-contracts-status: active and upcoming only, before the
    // search and before the limit; rule-evp-declare-contracts-list-only: only the proposed list changes
    const filters: SQL[] = [
      eq(payfitContracts.companyId, companyId),
      inArray(payfitContracts.status, ['ACTIVE', 'PENDING']),
    ]
    if (planningRestricted) {
      // rule-evp-siret-shared-contracts, rule-evp-siret-shared-contracts-visible (decision D-0013 and the owner's
      // precision): an employee seen only at the planning of another crèche of the SIRET is left out; seen nowhere, or
      // here, she is proposed. `not exists`, never `not in` on a nullable column.
      filters.push(sql`(
        not exists (
          select 1 from ${aqoonaPlannings} p
          where p.company_id = ${companyId} and p.employee_company_id = ${companyId} and p.employee_id = ${payfitContracts.employeeId}
            and p.creche_code is not null and p.creche_code <> ${code}
        ) or exists (
          select 1 from ${aqoonaPlannings} p
          where p.company_id = ${companyId} and p.employee_company_id = ${companyId} and p.employee_id = ${payfitContracts.employeeId}
            and p.creche_code = ${code}
        )
      )`)
    }
    if (query.search) {
      const pattern = `%${query.search.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`
      filters.push(sql`lower(${payfitEmployees.firstName} || ' ' || ${payfitEmployees.lastName}) like ${pattern}`)
    }
    const rows = await this.db
      .select({
        contractId: payfitContracts.id,
        payfitContractId: payfitContracts.payfitContractId,
        firstName: payfitEmployees.firstName,
        lastName: payfitEmployees.lastName,
        startDate: payfitContracts.startDate,
        endDate: payfitContracts.endDate,
      })
      .from(payfitContracts)
      .innerJoin(
        payfitEmployees,
        and(eq(payfitEmployees.companyId, payfitContracts.companyId), eq(payfitEmployees.employeeId, payfitContracts.employeeId)),
      )
      .where(and(...filters))
      .orderBy(asc(payfitEmployees.lastName), asc(payfitEmployees.firstName), asc(payfitContracts.id))
      .limit(query.size ?? 20)
    return {
      items: rows.map((row) => ({
        contractId: row.contractId,
        payfitContractId: row.payfitContractId,
        employeeName: `${row.firstName} ${row.lastName}`,
        startDate: row.startDate,
        endDate: row.endDate,
      })),
      planningRestricted,
    }
  }
}
