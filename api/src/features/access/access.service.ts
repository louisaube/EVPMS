import { Injectable } from '@nestjs/common'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { and, asc, count, eq, inArray, like, ne, or, sql, SQL } from 'drizzle-orm'
import { Database, InjectDb } from '../../platform/database/database.module'
import { ApiError, isUniqueViolation } from '../../platform/http/errors'
import { creches } from '../creches/creches.tables'
import { EvpAccess } from '../evp-core/evp.types'
import { evpPageOf } from '../evp-core/evp-query'
import { groups, groupUsers } from '../groups/groups.tables'
import { lockMemberships } from '../groups/memberships'
import { credentials, users } from '../users/users.tables'
import type {
  AccessAccountDto,
  AccessListQuery,
  CreateAccessBody,
  UpdateAccessBody,
} from './access.schemas'
import { crecheAssignments, evpAccounts } from './access.tables'

type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'execute'>
type ManageableRole = 'RO' | 'DIRECTRICE'

const DOMAIN = 'micro-stars.fr'
const fail = (status: number, code: string, message: string) => new ApiError(status, code, message)
const notManageable = () => fail(403, 'access.role_not_manageable', 'This role cannot be managed by the caller')
const privileged = () => fail(403, 'access.privileged_account', 'A privileged account cannot be changed here')
const unknownAccount = () => fail(404, 'access.not_found', 'Access account not found')

/** Lower case, without accents, single spaces: the comparison of a name with the source table. */
const normaliseName = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

@Injectable()
export class AccessService {
  constructor(@InjectDb() private readonly db: Database) {}

  /** rule-evp-access-who-manages: the RH and the ADMINISTRATRICE manage the ROs, the SUPERADMIN also the directrices. */
  private manageable(caller: EvpAccess): ManageableRole[] {
    return caller.capabilities.includes('access:manage:directrice') ? ['RO', 'DIRECTRICE'] : ['RO']
  }

  /** rule-evp-access-list-scope, rule-evp-access-pagination. */
  async list(query: AccessListQuery, caller: EvpAccess): Promise<{ items: AccessAccountDto[]; total: number }> {
    const roles = this.manageable(caller)
    if (query.role && !roles.includes(query.role)) throw notManageable()
    const { from, size } = evpPageOf(query, 10)
    const filters: SQL[] = [inArray(evpAccounts.role, query.role ? [query.role] : roles)]
    if (query.active !== undefined) filters.push(eq(evpAccounts.active, query.active))
    if (query.search) {
      const pattern = `%${query.search.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`
      filters.push(
        or(sql`lower(${evpAccounts.name}) like ${pattern}`, sql`lower(${evpAccounts.email}) like ${pattern}`) as SQL,
      )
    }
    const where = and(...filters)
    const page = await this.db
      .select({ id: evpAccounts.userId })
      .from(evpAccounts)
      .where(where)
      .orderBy(sql`lower(${evpAccounts.name})`, asc(evpAccounts.userId))
      .limit(size)
      .offset(from)
    const [{ total }] = await this.db.select({ total: count() }).from(evpAccounts).where(where)
    return { items: await this.load(this.db, page.map((row) => row.id)), total: Number(total) }
  }

  /** rule-evp-access-admin, rule-evp-access-active-needs-creche, rule-evp-access-directrice-source. */
  async create(body: CreateAccessBody, caller: EvpAccess): Promise<AccessAccountDto> {
    if (!this.manageable(caller).includes(body.role)) throw notManageable()
    const email = body.email.trim().toLowerCase()
    if (email.split('@')[1] !== DOMAIN) {
      throw fail(422, 'access.invalid_domain', `The address must end with @${DOMAIN}`)
    }
    const codes = [...new Set(body.crecheCodes)]
    if (body.active && codes.length === 0) throw fail(422, 'access.creche_required', 'An active account needs a crèche')
    const hash = await bcrypt.hash(randomBytes(32).toString('hex'), 10)
    return this.db.transaction(async (tx) => {
      await lockMemberships(tx)
      await this.assertCreches(tx, codes, body.role, body.name)
      const [existing] = await tx
        .select({ id: evpAccounts.userId })
        .from(evpAccounts)
        .where(sql`lower(${evpAccounts.email}) = ${email}`)
        .limit(1)
      if (existing) throw fail(409, 'access.email_already_exists', 'An account already uses this e-mail')
      const inserted = await tx
        .insert(users)
        .values({ email, role: 'user' })
        .onConflictDoNothing({ target: users.email })
        .returning({ id: users.id })
      const created = inserted[0]
      if (!created) throw fail(409, 'access.email_already_exists', 'An account already uses this e-mail')
      // no usable password: the sign-in is Google only (rule-evp-login-google-only)
      await tx.insert(credentials).values({ userId: created.id, password: hash, type: 'token' })
      await tx.insert(evpAccounts).values({
        userId: created.id,
        name: body.name,
        email,
        role: body.role,
        active: body.active,
      })
      await this.replaceAssignments(tx, created.id, codes)
      return (await this.load(tx, [created.id]))[0]
    })
  }

  /** rule-evp-access-admin, rule-evp-access-no-privileged, rule-evp-access-no-self-role. */
  async update(requestedId: string, body: UpdateAccessBody, caller: EvpAccess): Promise<AccessAccountDto> {
    const id = requestedId.toLowerCase()
    return this.db.transaction(async (tx) => {
      await lockMemberships(tx)
      const [target] = await tx
        .select()
        .from(evpAccounts)
        .where(eq(evpAccounts.userId, id))
        .for('no key update')
      if (!target) throw unknownAccount()
      if (target.role !== 'RO' && target.role !== 'DIRECTRICE') {
        if (target.userId === caller.userId && body.role !== undefined) {
          throw fail(409, 'access.cannot_change_own_role', 'A caller cannot change their own role')
        }
        throw privileged()
      }
      const roles = this.manageable(caller)
      if (!roles.includes(target.role)) throw notManageable()
      if (body.role !== undefined && !roles.includes(body.role)) throw notManageable()

      const role = body.role ?? target.role
      const active = body.active ?? target.active
      const name = body.name ?? target.name
      const current = await tx
        .select({ code: crecheAssignments.crecheCode })
        .from(crecheAssignments)
        .where(eq(crecheAssignments.userId, id))
      const codes = body.crecheCodes ? [...new Set(body.crecheCodes)] : current.map((row) => row.code)
      if (active && codes.length === 0) throw fail(422, 'access.creche_required', 'An active account needs a crèche')
      if (body.crecheCodes !== undefined || body.role !== undefined || body.name !== undefined) {
        await this.assertCreches(tx, body.crecheCodes ? codes : [], role, name, codes)
      }
      const email = await this.nextEmail(tx, target, body.email)
      await tx
        .update(evpAccounts)
        .set({ name, role, active, email, removedAt: active ? null : target.removedAt })
        .where(eq(evpAccounts.userId, id))
      if (body.crecheCodes !== undefined) await this.replaceAssignments(tx, id, codes)
      return (await this.load(tx, [id]))[0]
    })
  }

  /**
   * rule-evp-access-unlink-who, rule-evp-access-privileged-google-fix, rule-evp-access-unlink-needs-link,
   * rule-evp-access-unlink-session: `google_sub` becomes null and the session version rises, in one transaction with the
   * audit entry; the checks and their order are those of `update()`. The next valid sign-in of the address binds the
   * Google account it presents (rule-evp-access-google-rebind).
   */
  async unlinkGoogle(requestedId: string, caller: EvpAccess): Promise<AccessAccountDto> {
    const id = requestedId.toLowerCase()
    return this.db.transaction(async (tx) => {
      await lockMemberships(tx)
      const [target] = await tx.select().from(evpAccounts).where(eq(evpAccounts.userId, id)).for('no key update')
      if (!target) throw unknownAccount()
      if (target.role !== 'RO' && target.role !== 'DIRECTRICE') throw privileged()
      if (!this.manageable(caller).includes(target.role)) throw notManageable()
      if (target.googleSub === null) throw fail(409, 'access.google_not_linked', 'This access is not linked to a Google account')
      await tx
        .update(evpAccounts)
        .set({ googleSub: null, sessionVersion: sql`${evpAccounts.sessionVersion} + 1` })
        .where(eq(evpAccounts.userId, id))
      return (await this.load(tx, [id]))[0]
    })
  }

  /**
   * rule-evp-access-address-edit, rule-evp-access-address-keeps-link, rule-evp-access-email-lock-order: the address is
   * trimmed and lower-cased like on creation; the same address (case ignored) writes nothing; the domain, then the
   * uniqueness among the EVP accesses (removed ones included) and among all platform accounts. `users.email` follows in
   * the same transaction, `google_sub`, role, state, assignments and groups do not move. Returns the address to keep.
   */
  private async nextEmail(
    tx: Executor,
    target: { userId: string; email: string },
    requested: string | undefined,
  ): Promise<string> {
    if (requested === undefined) return target.email
    const email = requested.trim().toLowerCase()
    if (email === target.email.trim().toLowerCase()) return target.email
    if (email.split('@')[1] !== DOMAIN) {
      throw fail(422, 'access.invalid_domain', `The address must end with @${DOMAIN}`)
    }
    const taken = await tx
      .select({ id: evpAccounts.userId })
      .from(evpAccounts)
      .where(and(sql`lower(trim(${evpAccounts.email})) = ${email}`, ne(evpAccounts.userId, target.userId)))
      .limit(1)
    if (taken.length > 0) throw fail(409, 'access.email_already_exists', 'An account already uses this e-mail')
    try {
      await tx.update(users).set({ email }).where(eq(users.id, target.userId))
    } catch (error) {
      if (isUniqueViolation(error)) throw fail(409, 'access.email_already_exists', 'An account already uses this e-mail')
      throw error
    }
    return email
  }

  /** rule-evp-access-remove-ro: deactivated, assignments and technical groups emptied, the row and the history kept. */
  async remove(requestedId: string, caller: EvpAccess): Promise<AccessAccountDto> {
    const id = requestedId.toLowerCase()
    return this.db.transaction(async (tx) => {
      await lockMemberships(tx)
      const [target] = await tx.select().from(evpAccounts).where(eq(evpAccounts.userId, id)).for('no key update')
      if (!target) throw unknownAccount()
      if (target.role !== 'RO' && target.role !== 'DIRECTRICE') throw privileged()
      if (target.role !== 'RO' || !this.manageable(caller).includes(target.role)) throw notManageable()
      await tx
        .update(evpAccounts)
        .set({ active: false, removedAt: target.removedAt ?? sql`now()` })
        .where(eq(evpAccounts.userId, id))
      await this.replaceAssignments(tx, id, [])
      return (await this.load(tx, [id]))[0]
    })
  }

  /**
   * The crèches must exist and be verified (422 `creche_not_verified`); the name of a directrice must be the one of the
   * source table for each of her crèches (422 `directrice_source_mismatch`). `toCheck` are the codes to verify,
   * `assigned` all the codes of the account.
   */
  private async assertCreches(
    tx: Executor,
    toCheck: string[],
    role: ManageableRole,
    name: string,
    assigned: string[] = toCheck,
  ): Promise<void> {
    if (toCheck.length > 0) {
      const found = await tx
        .select({ code: creches.code })
        .from(creches)
        .where(and(inArray(creches.code, toCheck), eq(creches.verified, true)))
      if (found.length !== toCheck.length) {
        throw fail(422, 'access.creche_not_verified', 'A crèche is unknown or not verified')
      }
    }
    if (role === 'DIRECTRICE' && assigned.length > 0) {
      const rows = await tx
        .select({ directriceName: creches.directriceName })
        .from(creches)
        .where(inArray(creches.code, assigned))
      const wanted = normaliseName(name)
      if (rows.some((row) => !row.directriceName || normaliseName(row.directriceName) !== wanted)) {
        throw fail(422, 'access.directrice_source_mismatch', 'The name differs from the source table')
      }
    }
  }

  /** Assignments and technical groups `evp:<code>` change together (rule-evp-creche-scope). */
  private async replaceAssignments(tx: Executor, userId: string, codes: string[]): Promise<void> {
    await tx.delete(crecheAssignments).where(eq(crecheAssignments.userId, userId))
    const technical = await tx
      .select({ id: groups.id })
      .from(groups)
      .where(and(like(groups.name, 'evp:%'), ne(groups.name, 'evp:all')))
    if (technical.length > 0) {
      await tx
        .delete(groupUsers)
        .where(and(eq(groupUsers.userId, userId), inArray(groupUsers.groupId, technical.map((g) => g.id))))
    }
    if (codes.length === 0) return
    await tx.insert(crecheAssignments).values(codes.map((crecheCode) => ({ userId, crecheCode })))
    const wanted = await tx
      .select({ id: groups.id })
      .from(groups)
      .where(inArray(groups.name, codes.map((code) => `evp:${code}`)))
    if (wanted.length > 0) {
      await tx
        .insert(groupUsers)
        .values(wanted.map((group) => ({ groupId: group.id, userId })))
        .onConflictDoNothing()
    }
  }

  private async load(executor: Executor, ids: string[]): Promise<AccessAccountDto[]> {
    if (ids.length === 0) return []
    const rows = await executor
      .select({
        id: evpAccounts.userId,
        name: evpAccounts.name,
        email: evpAccounts.email,
        role: evpAccounts.role,
        active: evpAccounts.active,
        googleLinked: sql<boolean>`${evpAccounts.googleSub} is not null`,
      })
      .from(evpAccounts)
      .where(inArray(evpAccounts.userId, ids))
    const assigned = await executor
      .select({ userId: crecheAssignments.userId, code: creches.code, name: creches.name })
      .from(crecheAssignments)
      .innerJoin(creches, eq(creches.code, crecheAssignments.crecheCode))
      .where(inArray(crecheAssignments.userId, ids))
      .orderBy(asc(creches.name), asc(creches.code))
    const byId = new Map(rows.map((row) => [row.id, row]))
    return ids.flatMap((id) => {
      const row = byId.get(id)
      if (!row || (row.role !== 'RO' && row.role !== 'DIRECTRICE')) return []
      return [
        {
          id: row.id,
          name: row.name,
          email: row.email,
          role: row.role,
          active: row.active,
          googleLinked: row.googleLinked,
          creches: assigned.filter((a) => a.userId === id).map((a) => ({ code: a.code, name: a.name })),
        },
      ]
    })
  }
}
