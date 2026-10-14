import jwt from 'jsonwebtoken'
import { getConfig } from '../../../platform/config/config'
import { call, closePool, resetData, sql } from '../../../platform/testing/helpers'

type EvpRole = 'DIRECTRICE' | 'RO' | 'RH' | 'ADMINISTRATRICE' | 'SUPERADMIN'
interface Account {
  id: string
  email: string
  token: string
}

const UNKNOWN = '00000000-0000-4000-8000-000000000000'

describe('access routes: address edit, Google unlink, googleLinked', () => {
  let rh: Account
  let superadmin: Account
  let ro: Account
  let directrice: Account
  let privileged: Account

  /** The session token of the Google sign-in: same claims as the foundation plus `sv`; without `sv`, version 0. */
  const sessionToken = (id: string, sessionVersion?: number): string =>
    jwt.sign({ role: 'user', ...(sessionVersion === undefined ? {} : { sv: sessionVersion }) }, getConfig().jwtSecret, {
      algorithm: 'HS256',
      subject: id,
      expiresIn: 3600,
    })

  async function seed(email: string, role: EvpRole, over: { sub?: string; active?: boolean; creche?: string } = {}): Promise<Account> {
    const [user] = await sql<{ id: string }>("insert into base.users (email, role) values ($1, 'user') returning id", [email])
    await sql(
      "insert into base.credentials (user_id, password, type) values ($1, 'x', 'token')",
      [user.id],
    )
    await sql(
      'insert into base.evp_accounts (user_id, name, email, role, active, google_sub) values ($1, $2, $3, $4, $5, $6)',
      [user.id, `${role} ${email.split('@')[0]}`, email, role, over.active ?? true, over.sub ?? null],
    )
    if (over.creche) await sql('insert into base.creche_assignments (user_id, creche_code) values ($1, $2)', [user.id, over.creche])
    return { id: user.id, email, token: sessionToken(user.id) }
  }
  const send = (path: string, token: string | undefined, method = 'GET', body?: unknown) =>
    call(path, { method, body, headers: token ? { authorization: `Bearer ${token}` } : {} })
  const accountRow = async (id: string) => (await sql('select * from base.evp_accounts where user_id = $1', [id]))[0]
  const audits = async (action: string) => sql('select * from base.audit_logs where action = $1 order by occurred_at', [action])

  beforeEach(async () => {
    await resetData()
    await sql("insert into base.creches (code, name, siret, verified, scope_code) values ('alpha', 'Crèche Alpha', '11111111111111', true, 'alpha')")
    rh = await seed('rh@micro-stars.fr', 'RH')
    superadmin = await seed('louis@micro-stars.fr', 'SUPERADMIN')
    privileged = await seed('adm@micro-stars.fr', 'ADMINISTRATRICE')
    ro = await seed('rosa@micro-stars.fr', 'RO', { sub: 'sub-rosa-secret', creche: 'alpha' })
    directrice = await seed('camille@micro-stars.fr', 'DIRECTRICE', { creche: 'alpha' })
  })
  afterAll(closePool)

  describe('GET /access-accounts', () => {
    it('[rule-evp-access-google-linked-visible] googleLinked is true exactly when google_sub is set, and the identifier itself never appears', async () => {
      const res = await send('/access-accounts?size=50', rh.token)
      expect(res.status).toBe(200)
      const text = JSON.stringify(await res.json())
      const body = JSON.parse(text)
      expect(body.items.find((i: any) => i.id === ro.id).googleLinked).toBe(true)
      expect(body.items.every((i: any) => typeof i.googleLinked === 'boolean')).toBe(true)
      expect(text).not.toContain('sub-rosa-secret')
      expect(text).not.toContain('sessionVersion')
      expect(text).not.toContain('session_version')
    })

    it('[rule-evp-access-google-linked-visible] a superadmin sees the directrice as not linked', async () => {
      const body = await (await send('/access-accounts?size=50', superadmin.token)).json()
      expect(body.items.find((i: any) => i.id === directrice.id).googleLinked).toBe(false)
    })

    it('401 without a session', async () => {
      expect((await send('/access-accounts', undefined)).status).toBe(401)
    })
  })

  describe('PATCH /access-accounts/:id with email', () => {
    it('[rule-evp-access-address-edit] [rule-evp-access-address-keeps-link] the address is stored in lower case, the platform account follows, the link, role, state and crèches stay', async () => {
      const res = await send(`/access-accounts/${ro.id}`, rh.token, 'PATCH', { email: 'Rosa.Nouvelle@Micro-Stars.FR' })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toMatchObject({ email: 'rosa.nouvelle@micro-stars.fr', googleLinked: true, role: 'RO', active: true })
      expect(body.creches).toEqual([{ code: 'alpha', name: 'Crèche Alpha' }])
      const row = await accountRow(ro.id)
      expect(row).toMatchObject({ email: 'rosa.nouvelle@micro-stars.fr', google_sub: 'sub-rosa-secret', role: 'RO', active: true, session_version: 0 })
      expect((await sql('select email from base.users where id = $1', [ro.id]))[0].email).toBe('rosa.nouvelle@micro-stars.fr')
    })

    it('[rule-evp-access-address-edit] a superadmin changes the address of a directrice', async () => {
      const res = await send(`/access-accounts/${directrice.id}`, superadmin.token, 'PATCH', { email: 'camille.bis@micro-stars.fr' })
      expect(res.status).toBe(200)
      expect((await res.json()).email).toBe('camille.bis@micro-stars.fr')
    })

    it('[rule-evp-access-address-edit] the current address with another case changes nothing', async () => {
      const res = await send(`/access-accounts/${ro.id}`, rh.token, 'PATCH', { email: 'ROSA@micro-stars.fr' })
      expect(res.status).toBe(200)
      expect((await accountRow(ro.id)).email).toBe('rosa@micro-stars.fr')
      expect((await sql('select email from base.users where id = $1', [ro.id]))[0].email).toBe('rosa@micro-stars.fr')
    })

    it('[rule-evp-access-address-edit] 409 access.email_already_exists for an address of another access, removed or not, whatever the case', async () => {
      await sql("update base.evp_accounts set removed_at = now(), active = false where user_id = $1", [directrice.id])
      for (const email of ['Camille@micro-stars.fr', 'louis@micro-stars.fr']) {
        const res = await send(`/access-accounts/${ro.id}`, superadmin.token, 'PATCH', { email })
        expect({ status: res.status, code: (await res.json()).code }).toEqual({ status: 409, code: 'access.email_already_exists' })
      }
      expect((await accountRow(ro.id)).email).toBe('rosa@micro-stars.fr')
    })

    it('[rule-evp-access-address-edit] 409 for an address of a platform account outside EVP, without saying which', async () => {
      await sql("insert into base.users (email, role) values ('plateforme@micro-stars.fr', 'user')")
      const res = await send(`/access-accounts/${ro.id}`, rh.token, 'PATCH', { email: 'plateforme@micro-stars.fr' })
      const body = await res.json()
      expect({ status: res.status, code: body.code }).toEqual({ status: 409, code: 'access.email_already_exists' })
      expect((await accountRow(ro.id)).email).toBe('rosa@micro-stars.fr')
    })

    it('[rule-evp-access-address-edit] 422 access.invalid_domain outside the Workspace domain', async () => {
      const res = await send(`/access-accounts/${ro.id}`, rh.token, 'PATCH', { email: 'rosa@example.com' })
      expect({ status: res.status, code: (await res.json()).code }).toEqual({ status: 422, code: 'access.invalid_domain' })
    })

    it.each([['not an address'], ['a'.repeat(250) + '@micro-stars.fr'], [42]])('[rule-evp-access-address-edit] an invalid address (%p) is a validation error', async (email) => {
      const res = await send(`/access-accounts/${ro.id}`, rh.token, 'PATCH', { email })
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('api.validation.incoming_failed')
    })

    it('[rule-evp-access-email-lock-order] two simultaneous edits to the same address give one 200 and one 409', async () => {
      const other = await seed('robin@micro-stars.fr', 'RO', { creche: 'alpha' })
      const results = await Promise.all([
        send(`/access-accounts/${ro.id}`, rh.token, 'PATCH', { email: 'commune@micro-stars.fr' }),
        send(`/access-accounts/${other.id}`, rh.token, 'PATCH', { email: 'commune@micro-stars.fr' }),
      ])
      expect(results.map((r) => r.status).sort()).toEqual([200, 409])
      expect(await sql("select 1 from base.evp_accounts where email = 'commune@micro-stars.fr'")).toHaveLength(1)
    })

    it('[rule-evp-access-no-privileged] [rule-evp-access-who-manages] a privileged account is 403 access.privileged_account, a directrice for the RH is 403 access.role_not_manageable, an unknown id is 404', async () => {
      const privilegedRes = await send(`/access-accounts/${privileged.id}`, superadmin.token, 'PATCH', { email: 'x@micro-stars.fr' })
      expect({ status: privilegedRes.status, code: (await privilegedRes.json()).code }).toEqual({ status: 403, code: 'access.privileged_account' })
      const directriceRes = await send(`/access-accounts/${directrice.id}`, rh.token, 'PATCH', { email: 'x@micro-stars.fr' })
      expect({ status: directriceRes.status, code: (await directriceRes.json()).code }).toEqual({ status: 403, code: 'access.role_not_manageable' })
      const unknown = await send(`/access-accounts/${UNKNOWN}`, rh.token, 'PATCH', { email: 'x@micro-stars.fr' })
      expect({ status: unknown.status, code: (await unknown.json()).code }).toEqual({ status: 404, code: 'access.not_found' })
    })

    it('[rule-evp-access-address-audited] the entry names the field « adresse » and neither the former nor the new address', async () => {
      await send(`/access-accounts/${ro.id}`, rh.token, 'PATCH', { email: 'rosa.tracee@micro-stars.fr' })
      const [entry] = await audits('access:update')
      expect(entry.summary).toBe("Modification d'un accès RO (adresse)")
      for (const hidden of ['rosa@micro-stars.fr', 'rosa.tracee']) expect(entry.summary).not.toContain(hidden)
    })

    it('[rule-evp-access-session-version] an address edit keeps the open session of the account valid', async () => {
      await send(`/access-accounts/${ro.id}`, rh.token, 'PATCH', { email: 'rosa.nouvelle@micro-stars.fr' })
      expect((await send('/profile', ro.token)).status).toBe(200)
      expect((await accountRow(ro.id)).session_version).toBe(0)
    })
  })

  describe('POST /access-accounts/:id/unlink-google', () => {
    const unlink = (id: string, token: string | undefined) => send(`/access-accounts/${id}/unlink-google`, token, 'POST')

    it('[rule-evp-access-google-unlink] [rule-evp-access-unlink-who] the RH unbinds a RO, the superadmin a directrice', async () => {
      await sql("update base.evp_accounts set google_sub = 'sub-camille' where user_id = $1", [directrice.id])
      const first = await unlink(ro.id, rh.token)
      expect(first.status).toBe(200)
      expect(await first.json()).toMatchObject({ id: ro.id, googleLinked: false })
      const second = await unlink(directrice.id, superadmin.token)
      expect(second.status).toBe(200)
      expect((await accountRow(ro.id)).google_sub).toBeNull()
      expect((await accountRow(directrice.id)).google_sub).toBeNull()
    })

    it('[rule-evp-access-unlink-audited] the entry says « Liaison Google levée », written once, with no identifier and no address', async () => {
      await unlink(ro.id, rh.token)
      const entries = await audits('access:unlink-google')
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ actor_id: rh.id, object_type: 'Accès', object_id: ro.id, summary: 'Liaison Google levée' })
      expect(JSON.stringify(await sql('select * from base.audit_logs'))).not.toContain('sub-rosa-secret')
    })

    it('[rule-evp-access-unlink-needs-link] an access that is not linked is 409 access.google_not_linked and nothing is traced', async () => {
      const res = await unlink(directrice.id, superadmin.token)
      expect({ status: res.status, code: (await res.json()).code }).toEqual({ status: 409, code: 'access.google_not_linked' })
      expect(await audits('access:unlink-google')).toHaveLength(0)
      expect((await accountRow(directrice.id)).session_version).toBe(0)
    })

    it('[rule-evp-access-privileged-google-fix] a privileged account is 403, the superadmin on their own access included', async () => {
      await sql("update base.evp_accounts set google_sub = 'sub-louis' where user_id = $1", [superadmin.id])
      for (const [id, token] of [[privileged.id, superadmin.token], [superadmin.id, superadmin.token], [rh.id, rh.token]]) {
        const res = await unlink(id, token)
        expect({ status: res.status, code: (await res.json()).code }).toEqual({ status: 403, code: 'access.privileged_account' })
      }
      expect((await accountRow(superadmin.id)).google_sub).toBe('sub-louis')
    })

    it('[rule-evp-access-unlink-who] the RH cannot unbind a directrice (403 access.role_not_manageable)', async () => {
      await sql("update base.evp_accounts set google_sub = 'sub-camille' where user_id = $1", [directrice.id])
      const res = await unlink(directrice.id, rh.token)
      expect({ status: res.status, code: (await res.json()).code }).toEqual({ status: 403, code: 'access.role_not_manageable' })
      expect((await accountRow(directrice.id)).google_sub).toBe('sub-camille')
    })

    it('401 without a session, 404 for an unknown access, 400 for a malformed identifier', async () => {
      expect((await unlink(ro.id, undefined)).status).toBe(401)
      const unknown = await unlink(UNKNOWN, rh.token)
      expect({ status: unknown.status, code: (await unknown.json()).code }).toEqual({ status: 404, code: 'access.not_found' })
      expect((await unlink('not-a-uuid', rh.token)).status).toBe(400)
    })

    it('[rule-evp-access-unlink-session] [rule-evp-access-session-version] the sessions opened before the unlink are cut, the one opened after is valid', async () => {
      expect((await send('/profile', ro.token)).status).toBe(200)
      await unlink(ro.id, rh.token)
      const cut = await send('/profile', ro.token)
      expect({ status: cut.status, code: (await cut.json()).code }).toEqual({ status: 401, code: 'security.invalid_token' })
      expect((await accountRow(ro.id)).session_version).toBe(1)
      expect((await send('/profile', sessionToken(ro.id, 1))).status).toBe(200)
    })

    it('[rule-evp-access-unlink-session] a refused unlink cuts nothing', async () => {
      await unlink(directrice.id, rh.token)
      await unlink(UNKNOWN, rh.token)
      await unlink(ro.id, directrice.token)
      expect((await send('/profile', ro.token)).status).toBe(200)
      expect((await send('/profile', directrice.token)).status).toBe(200)
    })

    it('[rule-evp-access-unlink-session] a token without `sv` is version 0, a token of another version is refused', async () => {
      expect((await send('/profile', sessionToken(ro.id, 0))).status).toBe(200)
      expect((await send('/profile', sessionToken(ro.id, 3))).status).toBe(401)
    })

    it('[rule-evp-access-google-rebind] the access can be bound again: the unlink leaves google_sub null for the next sign-in', async () => {
      await unlink(ro.id, rh.token)
      expect((await accountRow(ro.id)).google_sub).toBeNull()
    })
  })
})
