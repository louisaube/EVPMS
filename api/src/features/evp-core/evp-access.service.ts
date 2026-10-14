import { Injectable } from '@nestjs/common'
import { asc, eq } from 'drizzle-orm'
import { Database, InjectDb } from '../../platform/database/database.module'
import { ApiError } from '../../platform/http/errors'
import { crecheAssignments, evpAccounts } from '../access/access.tables'
import { creches } from '../creches/creches.tables'
import type { Capability, EvpAccess, EvpRoleName } from './evp.types'

const CAPABILITIES: Record<EvpRoleName, Capability[]> = {
  DIRECTRICE: ['absences:create', 'closures:attest', 'notifications:read', 'profile:read', 'settings:read'],
  RO: ['absences:create', 'notifications:read', 'profile:read', 'settings:read'],
  RH: [
    'absences:create',
    'absences:decide',
    'access:manage:ro',
    'export:run',
    'journal:read',
    'notifications:read',
    'profile:read',
    'settings:read',
    'sources:read',
    'sources:refresh:aqoona',
    'sources:refresh:payfit',
  ],
  ADMINISTRATRICE: ['access:manage:ro', 'notifications:read', 'profile:read', 'settings:read'],
  SUPERADMIN: [
    'absences:create',
    'access:manage:directrice',
    'access:manage:ro',
    'export:run',
    'journal:read',
    'notifications:read',
    'profile:read',
    'settings:read',
    'sources:read',
    'sources:refresh:aqoona',
    'sources:refresh:payfit',
    'sources:refresh:sheets',
  ],
}

export const notAuthorized = (): ApiError => new ApiError(403, 'access.not_authorized', 'No EVP access for this account')
export const accountInactive = (): ApiError => new ApiError(403, 'access.account_inactive', 'This EVP account is inactive')

@Injectable()
export class EvpAccessService {
  constructor(@InjectDb() private readonly db: Database) {}

  /** rule-evp-declare-roles: 403 for an unknown, inactive or removed account, or an assigned role with no crèche. */
  async load(userId: string): Promise<EvpAccess> {
    const [account] = await this.db.select().from(evpAccounts).where(eq(evpAccounts.userId, userId))
    if (!account) throw notAuthorized()
    if (!account.active || account.removedAt) throw accountInactive()
    const scope = account.role === 'DIRECTRICE' || account.role === 'RO' ? 'ASSIGNED' : 'ALL'
    const assigned =
      scope === 'ASSIGNED'
        ? await this.db
            .select({ code: creches.code, name: creches.name })
            .from(crecheAssignments)
            .innerJoin(creches, eq(creches.code, crecheAssignments.crecheCode))
            .where(eq(crecheAssignments.userId, userId))
            .orderBy(asc(creches.name), asc(creches.code))
        : []
    if (scope === 'ASSIGNED' && assigned.length === 0) throw notAuthorized()
    return {
      userId,
      name: account.name,
      email: account.email,
      role: account.role,
      active: true,
      scope,
      creches: assigned,
      capabilities: CAPABILITIES[account.role],
      sessionVersion: account.sessionVersion,
    }
  }
}
