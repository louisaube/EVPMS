import { resetData, closePool, sql } from './harness'
import {
  seedWorld, seedAbsence, World, closeEvp, asEvpApp, rowsAsEvpApp, addDays, todayParis,
} from './evp-helpers'

const d = (n: number) => addDays(todayParis(), n)

// Acceptance suite of version v1-evp: the same restrictions are enforced by the database (row level security).
// The connection role of the test database is a superuser and bypasses row level security: the proofs below run
// inside a transaction under the non-bypassing role `evp_app` of the migration (plan du module, « Sécurité au niveau des lignes »).
describe('EVP database level security', () => {
  let w: World
  let aAbs: string
  let bAbs: string
  const RLS_TABLES = ['absences', 'absence_pieces', 'absence_events', 'notifications', 'notification_reads', 'closures', 'payfit_alerts', 'payfit_proofs']

  const as = (who: { id: string }, scopeAll = false) => ({ userId: who.id, scopeAll })
  const count = async (settings: { userId: string; scopeAll: boolean } | null, table: string, where = 'true') => {
    const rows = await rowsAsEvpApp(settings, `select count(*)::int as n from base.${table} where ${where}`)
    return rows === null ? 0 : rows[0].n
  }

  beforeEach(async () => {
    await resetData()
    w = await seedWorld()
    aAbs = await seedAbsence({ contractId: w.ctA.id, declaredBy: w.dirA.id })
    bAbs = await seedAbsence({ contractId: w.ctB.id, crecheCode: 'beta', declaredBy: w.dirB.id })
    for (const [abs, creche, uploader] of [[aAbs, 'alpha', w.dirA.id], [bAbs, 'beta', w.dirB.id]] as const) {
      await sql(
        `insert into base.absence_pieces (creche_code, scope_code, absence_id, uploaded_by, file_name, content_type, announced_size, size_bytes, storage_key, final_key, status,
           private_piece, upload_expires_at, confirmed_at, attached_at)
         values ($1, $1, $2, $3, 'p.pdf', 'application/pdf', 10, 10, 'k-' || $2, 'f-' || $2, 'CONFIRMED', false, now(), now(), now())`,
        [creche, abs, uploader],
      )
      await sql(`insert into base.absence_events (absence_id, at, kind, text, by_user_id, payload) values ($1, now(), 'CREATION', 'Dossier créé', $2, '{}'::jsonb)`, [abs, uploader])
      await sql(`insert into base.notifications (kind, absence_id, scope_code, title, message) values ('CONFIRMATION', $1, $2, 'Titre', 'Message')`, [abs, creche])
    }
    await sql("insert into base.closures (creche_code, month, scope_code, closed_at, closed_by) values ('alpha', '2020-01', 'alpha', now(), $1), ('beta', '2020-01', 'beta', now(), $2)", [w.dirA.id, w.dirB.id])
    const notifs = await sql('select id, scope_code from base.notifications')
    for (const n of notifs) {
      await sql('insert into base.notification_reads (notification_id, user_id, read_at) values ($1, $2, now())', [n.id, w.rh.id])
      if (n.scope_code === 'alpha') await sql('insert into base.notification_reads (notification_id, user_id, read_at) values ($1, $2, now())', [n.id, w.dirA.id])
    }
  })
  afterAll(async () => {
    await closeEvp()
    await closePool()
  })

  it('[rule-evp-rights-db-enforced] the application role exists and does not bypass row level security', async () => {
    const [role] = await sql("select rolsuper, rolbypassrls, rolcanlogin from pg_roles where rolname = 'evp_app'")
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false, rolcanlogin: false })
  })

  it.each(RLS_TABLES)('[rule-evp-rights-db-enforced] row level security is enabled and forced on %s', async (table) => {
    const [row] = await sql("select c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'base' and c.relname = $1", [table])
    expect(row).toEqual({ relrowsecurity: true, relforcerowsecurity: true })
  })

  it.each(['absences', 'absence_pieces', 'absence_events', 'notifications', 'closures'])(
    '[rule-evp-rights-db-enforced] [rule-evp-creche-scope] under the application role a directrice reads only the rows of her crèche in %s, a RO only the crèches assigned to her',
    async (table) => {
      expect(await count(as(w.dirA), table)).toBe(1)
      expect(await count(as(w.dirB), table)).toBe(1)
      expect(await count(as(w.roA), table)).toBe(1)
      expect(await count(as(w.roB), table)).toBe(1)
      expect(await rowsAsEvpApp(as(w.dirA), `select 1 from base.${table}`)).toHaveLength(1)
    },
  )

  it('[rule-evp-rights-db-enforced] a directrice reads the dossier of her crèche and never the one of another crèche, by identifier either', async () => {
    const own = await rowsAsEvpApp(as(w.dirA), 'select id from base.absences where id = $1', [aAbs])
    const foreign = await rowsAsEvpApp(as(w.dirA), 'select id from base.absences where id = $1', [bAbs])
    expect(own).toHaveLength(1)
    expect(foreign).toEqual([])
  })

  it('[rule-evp-rights-db-enforced] a RO assigned to two crèches reads both and no other', async () => {
    await sql("insert into base.creche_assignments (user_id, creche_code) values ($1, 'beta')", [w.roA.id])
    expect(await count(as(w.roA), 'absences')).toBe(2)
    await sql("delete from base.creche_assignments where user_id = $1 and creche_code = 'alpha'", [w.roA.id])
    expect(await count(as(w.roA), 'absences')).toBe(1)
    expect(await rowsAsEvpApp(as(w.roA), 'select creche_code from base.absences')).toEqual([{ creche_code: 'beta' }])
  })

  it.each(['absences', 'absence_pieces', 'absence_events', 'notifications', 'closures'])(
    '[rule-evp-rights-db-enforced] global consultation (RH, ADMINISTRATRICE, SUPERADMIN) reads the rows of every crèche in %s',
    async (table) => {
      for (const who of [w.rh, w.adm, w.sup]) expect(await count(as(who, true), table)).toBe(2)
    },
  )

  it('[rule-evp-rights-db-enforced] without any request setting no row is readable: the policy fails closed', async () => {
    for (const table of ['absences', 'absence_pieces', 'absence_events', 'notifications', 'notification_reads', 'closures']) {
      const rows = await rowsAsEvpApp(null, `select 1 from base.${table}`)
      expect(rows === null || rows.length === 0).toBe(true)
    }
  })

  it('[rule-evp-rights-db-enforced] an unknown user with no global scope reads nothing', async () => {
    expect(await count({ userId: '00000000-0000-4000-8000-0000000000aa', scopeAll: false }, 'absences')).toBe(0)
  })

  it('[rule-evp-notif-per-user-read] a user reads only the read marks that are theirs', async () => {
    expect(await count(as(w.dirA), 'notification_reads')).toBe(1)
    expect(await count(as(w.roA), 'notification_reads')).toBe(0)
    expect(await count(as(w.rh, true), 'notification_reads')).toBe(2)
    expect(await rowsAsEvpApp(as(w.dirA), 'select user_id from base.notification_reads')).toEqual([{ user_id: w.dirA.id }])
  })

  it('[rule-evp-rights-db-enforced] [rule-evp-declare-roles] the ADMINISTRATRICE reads everything and writes nothing: update, insert and delete on dossiers are refused', async () => {
    const before = JSON.stringify(await sql('select * from base.absences order by id'))
    await asEvpApp(as(w.adm, true), async (c) => {
      expect((await c.query('select count(*)::int as n from base.absences')).rows[0].n).toBe(2)
      const attempt = async (query: string, params: unknown[] = []) => {
        await c.query('savepoint s')
        try {
          const res = await c.query(query, params)
          await c.query('release savepoint s')
          return res.rowCount ?? 0
        } catch {
          await c.query('rollback to savepoint s')
          return 0
        }
      }
      expect(await attempt("update base.absences set comment = 'piraté'")).toBe(0)
      expect(await attempt('delete from base.absences')).toBe(0)
      expect(
        await attempt(
          `insert into base.absences (creche_code, scope_code, contract_id, type_code, start_date, start_half, end_date, end_half, status, saisie_declaree, payroll_month, blockages, declared_by, declared_at)
           values ('alpha', 'alpha', $1, 'AUTRE', '2020-01-01', 'MATIN', '2020-01-02', 'MATIN', 'A_VALIDER', false, '2020-01', '[]'::jsonb, $2, now())`,
          [w.ctA.id, w.adm.id],
        ),
      ).toBe(0)
      expect(await attempt("update base.notifications set title = 'x'")).toBe(0)
    })
    expect(JSON.stringify(await sql('select * from base.absences order by id'))).toBe(before)
  })

  it('[rule-evp-rights-db-enforced] a directrice writes inside her crèche only: the update of a dossier of another crèche changes no row', async () => {
    await asEvpApp(as(w.dirA), async (c) => {
      const own = await c.query("update base.absences set comment = 'ok' where id = $1", [aAbs])
      expect(own.rowCount).toBe(1)
      await c.query('savepoint s')
      let foreignCount = 0
      try {
        foreignCount = (await c.query("update base.absences set comment = 'non' where id = $1", [bAbs])).rowCount ?? 0
        await c.query('release savepoint s')
      } catch {
        await c.query('rollback to savepoint s')
      }
      expect(foreignCount).toBe(0)
    })
    expect((await sql('select comment from base.absences where id = $1', [bAbs]))[0].comment).toBeNull()
  })

  it('[rule-evp-closure-no-reopen] [rule-evp-payfit-alerts] the application role has no right to update or delete closures, timeline events or PayFit proofs', async () => {
    for (const table of ['closures', 'absence_events', 'payfit_proofs']) {
      const [priv] = await sql(
        `select has_table_privilege('evp_app', 'base.${table}', 'UPDATE') as upd, has_table_privilege('evp_app', 'base.${table}', 'DELETE') as del,
                has_table_privilege('evp_app', 'base.${table}', 'SELECT') as sel`,
      )
      expect(priv).toEqual({ upd: false, del: false, sel: true })
    }
  })

  it('[rule-evp-closure-no-reopen] a closure cannot be updated or deleted, even by a direct statement under the application role', async () => {
    await asEvpApp(as(w.rh, true), async (c) => {
      for (const query of ["update base.closures set closed_by = closed_by", "delete from base.closures", "update base.closures set month = '2021-01'"]) {
        await c.query('savepoint s')
        await expect(c.query(query)).rejects.toThrow()
        await c.query('rollback to savepoint s')
      }
    })
    expect(Number((await sql('select count(*)::int as n from base.closures'))[0].n)).toBe(2)
  })

  it('[rule-evp-audit-atomic] the dossier timeline is append-only: update and delete are refused by the database, even for the connection role', async () => {
    await expect(sql("update base.absence_events set text = 'altéré'")).rejects.toThrow()
    await expect(sql('delete from base.absence_events')).rejects.toThrow()
    await asEvpApp(as(w.rh, true), async (c) => {
      await c.query('savepoint s')
      await expect(c.query("update base.absence_events set text = 'altéré'")).rejects.toThrow()
      await c.query('rollback to savepoint s')
      await c.query('savepoint s2')
      await expect(c.query('delete from base.absence_events')).rejects.toThrow()
      await c.query('rollback to savepoint s2')
    })
    expect(Number((await sql('select count(*)::int as n from base.absence_events'))[0].n)).toBe(2)
    expect((await sql("select count(*)::int as n from base.absence_events where text = 'Dossier créé'"))[0].n).toBe(2)
  })

  it('[rule-evp-rights-db-enforced] the rows of a retired access are no longer reachable: removing the assignments hides the dossiers at database level', async () => {
    expect(await count(as(w.dirA), 'absences')).toBe(1)
    await sql('delete from base.creche_assignments where user_id = $1', [w.dirA.id])
    expect(await count(as(w.dirA), 'absences')).toBe(0)
  })
})
