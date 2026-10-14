import { resetData, closePool, sql, createUser } from './harness'
import { GET, POST, PATCH, UNKNOWN_UUID, seedWorld, seedAccount, World, auditRows, auditCount, countRows, assignmentInvariantViolations, closeEvp } from './evp-helpers'

// Acceptance suite of version v3-evp-acces-contrats-siret: Accès screen. `googleLinked` on the access list, address edit
// by PATCH /access-accounts/{id}, POST /access-accounts/{id}/unlink-google, cut of the open sessions (D-0011), privileged
// accounts out of reach (D-0012). Default API variant (fake sources): nothing here reads an external source.
describe('Access: address edit and Google unlink (v3-evp-acces-contrats-siret)', () => {
  let w: World

  beforeEach(async () => {
    await resetData()
    w = await seedWorld()
  })
  afterAll(async () => {
    await closeEvp()
    await closePool()
  })

  const setSub = (userId: string, sub: string | null) => sql('update base.evp_accounts set google_sub = $2 where user_id = $1', [userId, sub])
  const subOf = async (userId: string): Promise<string | null> => (await sql('select google_sub from base.evp_accounts where user_id = $1', [userId]))[0].google_sub
  const accountRow = async (userId: string) => (await sql('select * from base.evp_accounts where user_id = $1', [userId]))[0]
  const userEmail = async (userId: string): Promise<string> => (await sql('select email from base.users where id = $1', [userId]))[0].email
  const unlink = (id: string, token?: string) => POST(`/access-accounts/${id}/unlink-google`, token)
  const unlinkAudits = async () => (await auditRows()).filter((e) => JSON.stringify(e).includes('Liaison Google levée'))
  const updateAudits = () => auditRows('access:update')

  // ───────────────────────────── googleLinked ─────────────────────────────
  describe('GET /access-accounts: googleLinked', () => {
    it('[rule-evp-access-google-linked-visible] googleLinked is a boolean on every item, true exactly when the access is bound to a Google account; the identifier itself never leaves the API', async () => {
      const other = await seedAccount('RO', { name: 'Rita Alpha', creches: ['alpha'], email: 'rita.alpha@micro-stars.fr' })
      await setSub(w.roA.id, 'sub-secret-google-id-0001')
      await setSub(w.dirA.id, 'sub-secret-google-id-0002')
      for (const caller of [w.rh, w.sup]) {
        const res = await GET('/access-accounts?size=50', caller.token)
        expect(res.status).toBe(200)
        for (const item of res.body.items) expect(typeof item.googleLinked).toBe('boolean')
        const byId = (id: string) => res.body.items.find((i: any) => i.id === id)
        expect(byId(w.roA.id).googleLinked).toBe(true)
        expect(byId(other.id).googleLinked).toBe(false)
        expect(res.text).not.toContain('sub-secret-google-id')
        expect(res.text).not.toMatch(/google_?sub|googleSub/i)
      }
      const sup = await GET('/access-accounts?size=50', w.sup.token)
      expect(sup.body.items.find((i: any) => i.id === w.dirA.id).googleLinked).toBe(true)
      expect(sup.body.items.find((i: any) => i.id === w.dirB.id).googleLinked).toBe(false)
    })

    it('[rule-evp-access-google-linked-visible] the PATCH and unlink answers carry googleLinked too, and no identifier', async () => {
      await setSub(w.roA.id, 'sub-secret-google-id-0003')
      const patched = await PATCH(`/access-accounts/${w.roA.id}`, w.rh.token, { name: 'Rosa Renommée' })
      expect(patched.status).toBe(200)
      expect(patched.body.googleLinked).toBe(true)
      const unlinked = await unlink(w.roA.id, w.rh.token)
      expect(unlinked.status).toBe(200)
      expect(unlinked.body.googleLinked).toBe(false)
      for (const text of [patched.text, unlinked.text]) expect(text).not.toContain('sub-secret-google-id')
    })

    it('[rule-evp-access-google-linked-visible] the list keeps its existing guards (401 anonymous, 403 for a directrice and a RO) and only the callers admitted see googleLinked', async () => {
      await setSub(w.roA.id, 'sub-secret-google-id-0004')
      const allowed = await GET('/access-accounts?size=50', w.rh.token)
      expect(allowed.status).toBe(200)
      expect(allowed.body.items.find((i: any) => i.id === w.roA.id).googleLinked).toBe(true)
      expect((await GET('/access-accounts')).status).toBe(401)
      expect((await GET('/access-accounts', w.dirA.token)).status).toBe(403)
      expect((await GET('/access-accounts', w.roA.token)).status).toBe(403)
    })
  })

  // ───────────────────────────── PATCH : adresse ─────────────────────────────
  describe('PATCH /access-accounts/{id}: email', () => {
    it('[rule-evp-access-address-edit] [rule-evp-access-address-keeps-link] RH changes the address of a RO: the answer carries it, base.users follows in the same stroke, the binding, role, active state, crèches and groups are kept', async () => {
      await setSub(w.roA.id, 'sub-roa-1')
      const before = await accountRow(w.roA.id)
      const groups = JSON.stringify(await sql('select g.name from base.group_users gu join base.groups g on g.id = gu.group_id where gu.user_id = $1 order by g.name', [w.roA.id]))
      const assignments = JSON.stringify(await sql('select creche_code from base.creche_assignments where user_id = $1 order by creche_code', [w.roA.id]))
      const res = await PATCH(`/access-accounts/${w.roA.id}`, w.rh.token, { email: 'rosa.nouvelle@micro-stars.fr' })
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ id: w.roA.id, email: 'rosa.nouvelle@micro-stars.fr', role: 'RO', active: true, googleLinked: true })
      const after = await accountRow(w.roA.id)
      expect(after.email).toBe('rosa.nouvelle@micro-stars.fr')
      expect(await userEmail(w.roA.id)).toBe('rosa.nouvelle@micro-stars.fr')
      expect({ sub: after.google_sub, role: after.role, active: after.active, name: after.name, removed: after.removed_at }).toEqual({
        sub: 'sub-roa-1', role: before.role, active: before.active, name: before.name, removed: before.removed_at,
      })
      expect(JSON.stringify(await sql('select g.name from base.group_users gu join base.groups g on g.id = gu.group_id where gu.user_id = $1 order by g.name', [w.roA.id]))).toBe(groups)
      expect(JSON.stringify(await sql('select creche_code from base.creche_assignments where user_id = $1 order by creche_code', [w.roA.id]))).toBe(assignments)
      expect(await assignmentInvariantViolations()).toEqual([])
      expect(await countRows('users', 'id = $1', [w.roA.id])).toBe(1)
    })

    it('[rule-evp-access-address-edit] the superadmin changes the address of a directrice; ADMINISTRATRICE changes the address of a RO', async () => {
      const dir = await PATCH(`/access-accounts/${w.dirA.id}`, w.sup.token, { email: 'camille.nouvelle@micro-stars.fr' })
      expect(dir.status).toBe(200)
      expect(dir.body.email).toBe('camille.nouvelle@micro-stars.fr')
      expect(await userEmail(w.dirA.id)).toBe('camille.nouvelle@micro-stars.fr')
      const ro = await PATCH(`/access-accounts/${w.roB.id}`, w.adm.token, { email: 'robin.nouveau@micro-stars.fr' })
      expect(ro.status).toBe(200)
      expect(await userEmail(w.roB.id)).toBe('robin.nouveau@micro-stars.fr')
    })

    it('[rule-evp-access-address-edit] the address is stored in lower case and compared without regard to case', async () => {
      const res = await PATCH(`/access-accounts/${w.roA.id}`, w.rh.token, { email: 'Rosa.MAJUSCULE@Micro-Stars.FR' })
      expect(res.status).toBe(200)
      expect(res.body.email).toBe('rosa.majuscule@micro-stars.fr')
      expect((await accountRow(w.roA.id)).email).toBe('rosa.majuscule@micro-stars.fr')
      expect(await userEmail(w.roA.id)).toBe('rosa.majuscule@micro-stars.fr')
    })

    it('[rule-evp-access-address-audited] the change is traced as a modification of an access, naming the field « adresse » and neither the former nor the new address', async () => {
      const before = (await updateAudits()).length
      const oldEmail = w.roA.email
      const res = await PATCH(`/access-accounts/${w.roA.id}`, w.rh.token, { email: 'rosa.tracee@micro-stars.fr' })
      expect(res.status).toBe(200)
      const entries = await updateAudits()
      expect(entries).toHaveLength(before + 1)
      const entry = entries[entries.length - 1]
      expect(entry).toMatchObject({ actor_id: w.rh.id, object_type: 'Accès' })
      expect(entry.summary).toContain('adresse')
      // actor_email (contracted, not null) is the caller's own address, written by the foundation: it is the author, not the content of the trace.
      const { actor_email: author, ...content } = entry
      expect(author).toBe(w.rh.email)
      const text = JSON.stringify(content)
      for (const hidden of [oldEmail, 'rosa.tracee', 'micro-stars.fr']) expect(text).not.toContain(hidden)
      expect(text.length).toBeGreaterThan(0)
    })

    it('[rule-evp-access-address-audited] sending the current address, even in another case, changes nothing: both tables keep the stored value', async () => {
      const stored = w.roA.email
      const res = await PATCH(`/access-accounts/${w.roA.id}`, w.rh.token, { email: stored.toUpperCase() })
      expect(res.status).toBe(200)
      expect(res.body.email).toBe(stored)
      expect((await accountRow(w.roA.id)).email).toBe(stored)
      expect(await userEmail(w.roA.id)).toBe(stored)
    })

    it('[rule-evp-access-address-edit] 409 access.email_already_exists for the address of another access (active, removed, other case) and of a platform account outside EVP; nothing written, no audit entry', async () => {
      const removed = await seedAccount('RO', { name: 'Ancienne RO', email: 'ancienne.ro@micro-stars.fr', creches: [], active: false, removed: true })
      await createUser({ email: 'compte.plateforme@micro-stars.fr', password: 'Passw0rd!x', role: 'user' })
      const auditsBefore = await auditCount()
      const attempts = [w.roB.email, w.roB.email.toUpperCase(), removed.email, 'ANCIENNE.RO@micro-stars.fr', w.rh.email, 'compte.plateforme@micro-stars.fr', 'Compte.Plateforme@MICRO-STARS.fr']
      for (const email of attempts) {
        const res = await PATCH(`/access-accounts/${w.roA.id}`, w.rh.token, { email })
        expect({ email: email.length, status: res.status, code: res.body?.code }).toEqual({ email: email.length, status: 409, code: 'access.email_already_exists' })
      }
      expect((await accountRow(w.roA.id)).email).toBe(w.roA.email)
      expect(await userEmail(w.roA.id)).toBe(w.roA.email)
      expect(await auditCount()).toBe(auditsBefore)
    })

    it('[rule-evp-access-address-edit] 422 access.invalid_domain outside @micro-stars.fr, look-alike domains included; the access keeps its address', async () => {
      for (const email of ['rosa@gmail.com', 'rosa@xmicro-stars.fr', 'rosa@micro-stars.fr.evil.com', 'rosa@sub.micro-stars.fr']) {
        const res = await PATCH(`/access-accounts/${w.roA.id}`, w.rh.token, { email })
        expect({ email, status: res.status, code: res.body?.code }).toEqual({ email, status: 422, code: 'access.invalid_domain' })
      }
      expect((await accountRow(w.roA.id)).email).toBe(w.roA.email)
      expect(await userEmail(w.roA.id)).toBe(w.roA.email)
    })

    it('[rule-evp-access-address-edit] an invalid or too long address is refused by the input schema (validation error) and nothing is written', async () => {
      // The field exists in v3: a well-formed address is accepted (v2 refused the key itself, which would make every refusal below true for the wrong reason).
      const valid = await PATCH(`/access-accounts/${w.roA.id}`, w.rh.token, { email: 'rosa.valide@micro-stars.fr' })
      expect(valid.status).toBe(200)
      const tooLong = `${'a'.repeat(242)}@micro-stars.fr`
      expect(tooLong.length).toBe(257)
      for (const email of ['pas-une-adresse', '', 'a@', '@micro-stars.fr', tooLong, 123 as unknown as string, null as unknown as string]) {
        const res = await PATCH(`/access-accounts/${w.roA.id}`, w.rh.token, { email })
        expect({ email: String(email).slice(0, 20), invalidInput: [400, 422].includes(res.status), code: res.body?.code }).toMatchObject({ invalidInput: true })
        expect(res.body.code).not.toBe('access.invalid_domain')
      }
      expect((await accountRow(w.roA.id)).email).toBe('rosa.valide@micro-stars.fr')
    })

    it('[rule-evp-access-address-edit] the address can be sent with other fields in the same PATCH; they are all applied, and unknown keys stay refused', async () => {
      const res = await PATCH(`/access-accounts/${w.roA.id}`, w.rh.token, { email: 'rosa.groupee@micro-stars.fr', name: 'Rosa Groupée' })
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ email: 'rosa.groupee@micro-stars.fr', name: 'Rosa Groupée' })
      const bad = await PATCH(`/access-accounts/${w.roA.id}`, w.rh.token, { email: 'rosa.autre@micro-stars.fr', unknown: 1 })
      expect(bad.status).toBe(400)
      expect(bad.body.code).toBe('api.validation.incoming_failed')
      expect((await accountRow(w.roA.id)).email).toBe('rosa.groupee@micro-stars.fr')
    })

    it('[rule-evp-access-email-lock-order] two simultaneous changes to the same address on two accesses: one 200, one 409 access.email_already_exists, exactly one access ends with the address', async () => {
      const target = 'adresse.disputee@micro-stars.fr'
      const [a, b] = await Promise.all([
        PATCH(`/access-accounts/${w.roA.id}`, w.rh.token, { email: target }),
        PATCH(`/access-accounts/${w.roB.id}`, w.rh.token, { email: target }),
      ])
      expect([a.status, b.status].sort()).toEqual([200, 409])
      const refused = a.status === 409 ? a : b
      expect(refused.body.code).toBe('access.email_already_exists')
      expect(await countRows('evp_accounts', 'email = $1', [target])).toBe(1)
      expect(await countRows('users', 'email = $1', [target])).toBe(1)
    })

    it('[rule-evp-access-no-privileged] [rule-evp-access-who-manages] privileged accounts keep 403 access.privileged_account for an address change, even for the superadmin; RH cannot change a directrice (403 access.role_not_manageable)', async () => {
      for (const target of [w.rh, w.adm, w.sup]) {
        const res = await PATCH(`/access-accounts/${target.id}`, w.sup.token, { email: 'piratage@micro-stars.fr' })
        expect({ status: res.status, code: res.body?.code }).toEqual({ status: 403, code: 'access.privileged_account' })
        expect((await accountRow(target.id)).email).toBe(target.email)
        expect(await userEmail(target.id)).toBe(target.email)
      }
      const rhOnDirectrice = await PATCH(`/access-accounts/${w.dirA.id}`, w.rh.token, { email: 'piratage@micro-stars.fr' })
      expect({ status: rhOnDirectrice.status, code: rhOnDirectrice.body.code }).toEqual({ status: 403, code: 'access.role_not_manageable' })
      expect((await accountRow(w.dirA.id)).email).toBe(w.dirA.email)
    })

    it('[rule-evp-access-address-edit] 404 access.not_found for an unknown id, 400 for a malformed id, 403 for a directrice or a RO, 401 anonymous', async () => {
      const unknown = await PATCH(`/access-accounts/${UNKNOWN_UUID}`, w.rh.token, { email: 'nouvelle@micro-stars.fr' })
      expect({ status: unknown.status, code: unknown.body.code }).toEqual({ status: 404, code: 'access.not_found' })
      expect((await PATCH('/access-accounts/not-a-uuid', w.rh.token, { email: 'nouvelle@micro-stars.fr' })).status).toBe(400)
      expect((await PATCH(`/access-accounts/${w.roA.id}`, w.dirA.token, { email: 'nouvelle@micro-stars.fr' })).status).toBe(403)
      expect((await PATCH(`/access-accounts/${w.roA.id}`, w.roB.token, { email: 'nouvelle@micro-stars.fr' })).status).toBe(403)
      expect((await PATCH(`/access-accounts/${w.roA.id}`, undefined, { email: 'nouvelle@micro-stars.fr' })).status).toBe(401)
      expect((await accountRow(w.roA.id)).email).toBe(w.roA.email)
    })

    it('[rule-evp-access-address-keeps-link] the sessions already open stay valid after an address change (they carry the identifier of the account)', async () => {
      expect((await GET('/profile', w.roA.token)).status).toBe(200)
      expect((await PATCH(`/access-accounts/${w.roA.id}`, w.rh.token, { email: 'rosa.session@micro-stars.fr' })).status).toBe(200)
      const profile = await GET('/profile', w.roA.token)
      expect(profile.status).toBe(200)
    })
  })

  // ───────────────────────────── POST unlink-google ─────────────────────────────
  describe('POST /access-accounts/{id}/unlink-google', () => {
    it('[rule-evp-access-google-unlink] [rule-evp-access-unlink-who] RH unlinks a RO: 200 with the access and googleLinked false, google_sub null, nothing else changed', async () => {
      await setSub(w.roA.id, 'sub-roa-old')
      const before = await accountRow(w.roA.id)
      const res = await unlink(w.roA.id, w.rh.token)
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ id: w.roA.id, email: before.email, name: before.name, role: 'RO', active: true, googleLinked: false })
      expect(res.body.creches.map((c: any) => c.code)).toEqual(['alpha'])
      expect(await subOf(w.roA.id)).toBeNull()
      const after = await accountRow(w.roA.id)
      expect({ email: after.email, name: after.name, role: after.role, active: after.active, removed: after.removed_at }).toEqual({
        email: before.email, name: before.name, role: before.role, active: before.active, removed: before.removed_at,
      })
      expect(await assignmentInvariantViolations()).toEqual([])
      const listed = (await GET('/access-accounts?size=50', w.rh.token)).body.items.find((i: any) => i.id === w.roA.id)
      expect(listed.googleLinked).toBe(false)
    })

    it('[rule-evp-access-unlink-who] ADMINISTRATRICE unlinks a RO; the superadmin unlinks a RO and a directrice; RH is refused on a directrice (403 access.role_not_manageable) and the binding stays', async () => {
      await setSub(w.roA.id, 'sub-roa')
      await setSub(w.roB.id, 'sub-rob')
      await setSub(w.dirA.id, 'sub-dira')
      await setSub(w.dirB.id, 'sub-dirb')
      expect((await unlink(w.roA.id, w.adm.token)).status).toBe(200)
      expect((await unlink(w.roB.id, w.sup.token)).status).toBe(200)
      expect((await unlink(w.dirA.id, w.sup.token)).status).toBe(200)
      const refused = await unlink(w.dirB.id, w.rh.token)
      expect({ status: refused.status, code: refused.body.code }).toEqual({ status: 403, code: 'access.role_not_manageable' })
      const refusedAdm = await unlink(w.dirB.id, w.adm.token)
      expect({ status: refusedAdm.status, code: refusedAdm.body.code }).toEqual({ status: 403, code: 'access.role_not_manageable' })
      expect(await subOf(w.dirB.id)).toBe('sub-dirb')
      for (const id of [w.roA.id, w.roB.id, w.dirA.id]) expect(await subOf(id)).toBeNull()
    })

    it('[rule-evp-access-unlink-audited] each unlink is traced in the same stroke: object « Accès », summary « Liaison Google levée », author = the caller, neither the Google identifier nor any address', async () => {
      await setSub(w.roA.id, 'sub-google-id-to-hide-0042')
      const res = await unlink(w.roA.id, w.rh.token)
      expect(res.status).toBe(200)
      const entries = await unlinkAudits()
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ actor_id: w.rh.id, object_type: 'Accès' })
      expect(entries[0].summary).toContain('Liaison Google levée')
      // actor_email is the caller's own address (author column of the foundation), not the content of the trace.
      const { actor_email: author, ...content } = entries[0]
      expect(author).toBe(w.rh.email)
      const text = JSON.stringify(content)
      for (const hidden of ['sub-google-id-to-hide-0042', w.roA.email, 'micro-stars.fr']) expect(text).not.toContain(hidden)
      expect(JSON.stringify(await auditRows())).not.toContain('sub-google-id-to-hide-0042')
    })

    it('[rule-evp-access-unlink-needs-link] unlinking an access that is not bound answers 409 access.google_not_linked, writes nothing and leaves no audit entry; a second unlink is refused the same way', async () => {
      const auditsBefore = await auditCount()
      const never = await unlink(w.roA.id, w.rh.token)
      expect({ status: never.status, code: never.body.code }).toEqual({ status: 409, code: 'access.google_not_linked' })
      await setSub(w.roB.id, 'sub-rob')
      expect((await unlink(w.roB.id, w.rh.token)).status).toBe(200)
      const again = await unlink(w.roB.id, w.rh.token)
      expect({ status: again.status, code: again.body.code }).toEqual({ status: 409, code: 'access.google_not_linked' })
      expect(await auditCount()).toBe(auditsBefore + 1)
      expect(await unlinkAudits()).toHaveLength(1)
    })

    it('[rule-evp-access-unlink-needs-link] two simultaneous unlinks of the same access: one 200, one 409 access.google_not_linked, exactly one audit entry', async () => {
      await setSub(w.roA.id, 'sub-roa-race')
      const [a, b] = await Promise.all([unlink(w.roA.id, w.rh.token), unlink(w.roA.id, w.adm.token)])
      expect([a.status, b.status].sort()).toEqual([200, 409])
      expect((a.status === 409 ? a : b).body.code).toBe('access.google_not_linked')
      expect(await unlinkAudits()).toHaveLength(1)
    })

    it('[rule-evp-access-privileged-google-fix] [rule-evp-access-no-privileged] RH, ADMINISTRATRICE and SUPERADMIN accesses cannot be unlinked, the superadmin on his own access included: 403 access.privileged_account, binding unchanged, no audit entry', async () => {
      for (const t of [w.rh, w.adm, w.sup]) await setSub(t.id, `sub-${t.role}`)
      const auditsBefore = await auditCount()
      for (const target of [w.rh, w.adm, w.sup]) {
        for (const caller of [w.sup, w.rh]) {
          const res = await unlink(target.id, caller.token)
          expect({ target: target.role, caller: caller.role, status: res.status, code: res.body.code }).toEqual({ target: target.role, caller: caller.role, status: 403, code: 'access.privileged_account' })
        }
        expect(await subOf(target.id)).toBe(`sub-${target.role}`)
      }
      expect(await auditCount()).toBe(auditsBefore)
    })

    it('[rule-evp-access-privileged-google-fix][D-0012] superadmin on a RH access bound to a Google account: 403 access.privileged_account, binding unchanged', async () => {
      await setSub(w.rh.id, 'sub-marine-old-google-account')
      const res = await POST(`/access-accounts/${w.rh.id}/unlink-google`, w.sup.token)
      expect(res.status).toBe(403)
      expect(res.body.code).toBe('access.privileged_account')
      expect(await subOf(w.rh.id)).toBe('sub-marine-old-google-account')
    })

    it('[rule-evp-access-privileged-google-fix] the checks run in the order of PATCH: a privileged or out-of-reach access is refused 403 even when it is not bound (never 409)', async () => {
      const privileged = await unlink(w.rh.id, w.sup.token)
      expect({ status: privileged.status, code: privileged.body.code }).toEqual({ status: 403, code: 'access.privileged_account' })
      const notManageable = await unlink(w.dirA.id, w.rh.token)
      expect({ status: notManageable.status, code: notManageable.body.code }).toEqual({ status: 403, code: 'access.role_not_manageable' })
    })

    it('[rule-evp-access-google-unlink] an inactive access can be unlinked like it can be modified', async () => {
      await PATCH(`/access-accounts/${w.roA.id}`, w.rh.token, { active: false })
      await setSub(w.roA.id, 'sub-roa-inactive')
      const res = await unlink(w.roA.id, w.rh.token)
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ active: false, googleLinked: false })
      expect(await subOf(w.roA.id)).toBeNull()
    })

    it('[rule-evp-access-google-unlink] 404 access.not_found for an unknown id, 400 for a malformed id, 401 anonymous, 403 directrice and RO callers; no write, no audit entry', async () => {
      await setSub(w.roA.id, 'sub-roa')
      const auditsBefore = await auditCount()
      const unknown = await unlink(UNKNOWN_UUID, w.rh.token)
      expect({ status: unknown.status, code: unknown.body.code }).toEqual({ status: 404, code: 'access.not_found' })
      expect((await unlink('not-a-uuid', w.rh.token)).status).toBe(400)
      expect((await unlink(w.roA.id)).status).toBe(401)
      expect((await unlink(w.roA.id, w.dirA.token)).status).toBe(403)
      expect((await unlink(w.roA.id, w.roB.token)).status).toBe(403)
      expect(await subOf(w.roA.id)).toBe('sub-roa')
      expect(await auditCount()).toBe(auditsBefore)
    })
  })

  // ───────────────────────────── sessions ouvertes ─────────────────────────────
  describe('open sessions (D-0011)', () => {
    it('[rule-evp-access-unlink-session][D-0011] GET /profile with a session opened before the unlink answers 401 security.invalid_token once the access is unlinked', async () => {
      await setSub(w.roA.id, 'sub-roa-session')
      expect((await GET('/profile', w.roA.token)).status).toBe(200)
      expect((await unlink(w.roA.id, w.rh.token)).status).toBe(200)
      const cut = await GET('/profile', w.roA.token)
      expect(cut.status).toBe(401)
      expect(cut.body.code).toBe('security.invalid_token')
    })

    it('[rule-evp-access-unlink-session] the cut applies to every authenticated route, and only to the unlinked access: other accesses keep their sessions', async () => {
      await setSub(w.roA.id, 'sub-roa')
      await setSub(w.roB.id, 'sub-rob')
      expect((await unlink(w.roA.id, w.rh.token)).status).toBe(200)
      for (const path of ['/profile', '/settings', '/creches', '/notifications']) {
        const res = await GET(path, w.roA.token)
        expect({ path, status: res.status, code: res.body?.code }).toEqual({ path, status: 401, code: 'security.invalid_token' })
      }
      expect((await GET('/profile', w.roB.token)).status).toBe(200)
      expect((await GET('/profile', w.rh.token)).status).toBe(200)
      expect(await subOf(w.roB.id)).toBe('sub-rob')
    })

    it('[rule-evp-access-unlink-session] a refused unlink (403, 404, 409) cuts nothing: the session stays valid', async () => {
      expect((await unlink(w.roA.id, w.rh.token)).status).toBe(409)
      expect((await GET('/profile', w.roA.token)).status).toBe(200)
      await setSub(w.dirA.id, 'sub-dira')
      expect((await unlink(w.dirA.id, w.rh.token)).status).toBe(403)
      expect((await GET('/profile', w.dirA.token)).status).toBe(200)
      expect((await unlink(UNKNOWN_UUID, w.rh.token)).status).toBe(404)
      await setSub(w.rh.id, 'sub-rh')
      expect((await unlink(w.rh.id, w.sup.token)).status).toBe(403)
      expect((await GET('/profile', w.rh.token)).status).toBe(200)
      expect((await GET('/profile', w.sup.token)).status).toBe(200)
    })

    it('[rule-evp-access-unlink-session] only the unlink cuts sessions: an address change keeps them valid, a removal keeps its existing answer (403 access refused, not 401)', async () => {
      await setSub(w.roA.id, 'sub-roa')
      await setSub(w.roB.id, 'sub-rob')
      expect((await PATCH(`/access-accounts/${w.roA.id}`, w.rh.token, { email: 'rosa.session2@micro-stars.fr', name: 'Rosa Session', crecheCodes: ['alpha'] })).status).toBe(200)
      expect((await GET('/profile', w.roA.token)).status).toBe(200)
      expect((await PATCH(`/access-accounts/${w.roA.id}`, w.rh.token, { active: false })).status).toBe(200)
      expect((await GET('/profile', w.roA.token)).status).toBe(403)
      expect((await PATCH(`/access-accounts/${w.roA.id}`, w.rh.token, { active: true, crecheCodes: ['alpha'] })).status).toBe(200)
      expect((await GET('/profile', w.roA.token)).status).toBe(200)
      expect((await POST(`/access-accounts/${w.roB.id}/remove`, w.rh.token)).status).toBe(200)
      expect((await GET('/profile', w.roB.token)).status).toBe(403)
    })
  })
})
