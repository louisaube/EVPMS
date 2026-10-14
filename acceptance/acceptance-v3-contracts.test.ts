import { resetData, closePool, sql } from './harness'
import {
  GET, qs, seedWorld, seedAccount, seedCreche, seedContract, seedAbsence, createAbsence, World, Account, Contract, closeEvp, refresh,
  writeFixture, clearFixtures, SIRET_A, countRows,
} from './evp-helpers'
import { d } from './v2-helpers'
import { NIR2, NIR3, PayfitOptions, payfitWith } from './v5-helpers'

// Acceptance suite of version v3-evp-acces-contrats-siret: contracts offered when declaring an absence (never the archived
// ones) and crèches that share a SIRET (decision D-0013 and the owner's precision: nobody is visible nowhere).
// Default API variant (fake sources): PayFit data is seeded by SQL, the Aqoona planning is read through the fake pilot.
describe('Contracts offered and crèches sharing a SIRET (v3-evp-acces-contrats-siret)', () => {
  let w: World
  let alpha2: Account
  let camille: Contract

  beforeEach(async () => {
    await resetData()
    clearFixtures()
    w = await seedWorld()
    await sql("update base.payfit_contracts set status = 'ACTIVE'")
  })
  afterAll(async () => {
    await closeEvp()
    await closePool()
  })

  const setStatus = (contractId: string, status: string) => sql('update base.payfit_contracts set status = $2 where id = $1', [contractId, status])
  const names = (res: { body: any }): string[] => res.body.items.map((i: any) => i.employeeName).sort()
  const contracts = (code: string, token: string, query: Record<string, string | number> = {}) => GET(`/creches/${code}/contracts${qs(query)}`, token)

  /** Deuxième crèche sur le SIRET de la société A (Alpha et Alpha Deux partagent la société PayFit `co-a`), avec sa directrice, et une troisième salariée (Camille). */
  async function shareSiret() {
    await seedCreche('alpha2', { name: 'Crèche Alpha Deux', siret: SIRET_A, directriceName: 'Dora Deux', roNames: [] })
    alpha2 = await seedAccount('DIRECTRICE', { name: 'Dora Deux', creches: ['alpha2'] })
    camille = await seedContract('co-a', 'ct-a3', 'Camille', 'Dupont')
    await setStatus(camille.id, 'ACTIVE')
  }

  // v5 (rule-evp-link-nir-only): a row is attached to a collaborator by her NIR alone, so every row carries one and payfit.json
  // gives the same NIR to the collaborator (never the names).
  const fx = (first: string, last: string, creche: string, day = d(-3), nir: string | null = null) => ({ firstName: first, lastName: last, matricule: nir, crecheName: creche, day, start: '08:00', end: '12:00' })
  const camilleFixture = { companyId: 'co-a', id: 'emp-ct-a3', firstName: 'Camille', lastName: 'Dupont' }
  const camilleContract = { companyId: 'co-a', id: 'ct-a3', employeeId: 'emp-ct-a3', startDate: '2020-01-01', endDate: null }
  /** NIR valide (13 chiffres et clé) propre à un rang, pour les personnes en nombre. */
  const nirOf = (n: number): string => {
    const body = `2850575${String(100000 + n)}`
    let r = 0
    for (const c of body) r = (r * 10 + Number(c)) % 97
    return `${body}${String(97 - r).padStart(2, '0')}`
  }
  async function readPlanning(rows: unknown[], nirs: Record<string, string> = { 'emp-ct-a3': NIR3 }, extra: PayfitOptions = { employees: [camilleFixture], contracts: [camilleContract] }) {
    payfitWith(nirs, extra)
    writeFixture('aqoona', { rows })
    const run = await refresh(w.rh.token, 'aqoona')
    expect(run.state).toBe('SUCCEEDED')
  }

  // ───────────────────────────── contrats archivés ─────────────────────────────
  describe('statuses offered', () => {
    it('[rule-evp-declare-contracts-not-archived] [rule-evp-declare-contracts-status] an ARCHIVED contract is not offered, ACTIVE and PENDING ones are', async () => {
      await setStatus(w.ctA.id, 'ARCHIVED')
      await setStatus(w.ctA2.id, 'PENDING')
      const active = await seedContract('co-a', 'ct-a-actif', 'Ida', 'Actif')
      await setStatus(active.id, 'ACTIVE')
      const res = await contracts('alpha', w.dirA.token)
      expect(res.status).toBe(200)
      expect(names(res)).toEqual(['Ida Actif', 'Noé Petit'])
      expect(res.body.items.map((i: any) => i.contractId)).not.toContain(w.ctA.id)
      expect(typeof res.body.planningRestricted).toBe('boolean')
    })

    it('[rule-evp-declare-contracts-not-archived] a person who moved from one crèche to the other (one archived contract, one active) appears once, with her active contract only', async () => {
      await setStatus(w.ctA.id, 'ARCHIVED')
      const [row] = await sql(
        `insert into base.payfit_contracts (company_id, payfit_contract_id, employee_id, start_date, status)
         values ('co-a', 'ct-a1-bis', $1, '2024-01-01', 'ACTIVE') returning id`,
        [`emp-${w.ctA.payfitContractId}`],
      )
      const res = await contracts('alpha', w.rh.token, { search: 'Martin' })
      expect(res.status).toBe(200)
      expect(res.body.items).toHaveLength(1)
      expect(res.body.items[0]).toMatchObject({ contractId: row.id, payfitContractId: 'ct-a1-bis', employeeName: 'Léa Martin' })
    })

    it('[rule-evp-declare-contracts-not-archived] the search never reaches an archived contract', async () => {
      await setStatus(w.ctA.id, 'ARCHIVED')
      const res = await contracts('alpha', w.rh.token, { search: 'Martin' })
      expect(res.status).toBe(200)
      expect(res.body.items).toEqual([])
    })

    it('[rule-evp-declare-contracts-status] the filter applies before the limit of 20 and before the search: 25 archived contracts that sort first do not hide the one active contract', async () => {
      for (let i = 1; i <= 25; i += 1) {
        const c = await seedContract('co-a', `ct-arch-${i}`, `Aa${String(i).padStart(2, '0')}`, 'Dupont')
        await setStatus(c.id, 'ARCHIVED')
      }
      const last = await seedContract('co-a', 'ct-last', 'Zz', 'Dupont', '2025-06-01')
      await setStatus(last.id, 'ACTIVE')
      const searched = await contracts('alpha', w.rh.token, { search: 'Dupont' })
      expect(searched.status).toBe(200)
      expect(names(searched)).toEqual(['Zz Dupont'])
      const listed = await contracts('alpha', w.rh.token, { size: 20 })
      expect(listed.status).toBe(200)
      expect(names(listed)).toContain('Zz Dupont')
      expect(names(listed).filter((n) => n.startsWith('Aa'))).toEqual([])
    })

    it('[rule-evp-declare-contracts-list-only] only the list changes: a declaration on an archived contract is still accepted by POST /absences, and a dossier already on it stays readable', async () => {
      const dossier = await seedAbsence({ contractId: w.ctA2.id, declaredBy: w.dirA.id, startDate: d(-20), endDate: d(-19) })
      await setStatus(w.ctA2.id, 'ARCHIVED')
      expect(names(await contracts('alpha', w.dirA.token))).toEqual(['Léa Martin'])
      const read = await GET(`/absences/${dossier}`, w.dirA.token)
      expect(read.status).toBe(200)
      expect(read.body.id).toBe(dossier)
      const created = await createAbsence(w.dirA.token, { contractId: w.ctA2.id, startDate: d(-10), endDate: d(-9) })
      expect(created.status).toBe(201)
      expect(await countRows('absences')).toBe(2)
    })

    it('[rule-evp-declare-contracts-status] [rule-evp-siret-shared-contracts-flag] a crèche alone on its SIRET gets every active and upcoming contract of its company and planningRestricted false', async () => {
      const res = await contracts('beta', w.dirB.token)
      expect(res.status).toBe(200)
      expect(names(res)).toEqual(['Zoé Durand'])
      expect(res.body.planningRestricted).toBe(false)
      const alpha = await contracts('alpha', w.dirA.token)
      expect(names(alpha)).toEqual(['Léa Martin', 'Noé Petit'])
      expect(alpha.body.planningRestricted).toBe(false)
    })
  })

  // ───────────────────────────── SIRET partagé ─────────────────────────────
  describe('crèches sharing a SIRET', () => {
    it('[rule-evp-siret-shared-contracts][D-0013] code = the second crèche of the SIRET, planning of Camille attached to the first only: 200, items empty for search=Camille', async () => {
      await shareSiret()
      await readPlanning([fx('Camille', 'Dupont', 'Crèche Alpha', d(-3), NIR3)])
      expect(await countRows('aqoona_plannings', 'creche_code = $1 and employee_id is not null', ['alpha'])).toBe(1)
      const res = await GET('/creches/alpha2/contracts?search=Camille', alpha2.token)
      expect(res.status).toBe(200)
      expect(res.body.items).toEqual([])
    })

    it('[rule-evp-siret-shared-contracts] [rule-evp-siret-shared-contracts-flag] a person seen only at the planning of the first crèche is offered there and not at the second; planningRestricted is true on both', async () => {
      await shareSiret()
      await readPlanning([fx('Camille', 'Dupont', 'Crèche Alpha', d(-3), NIR3)])
      const first = await contracts('alpha', w.dirA.token, { search: 'Camille' })
      expect(names(first)).toEqual(['Camille Dupont'])
      expect(first.body.planningRestricted).toBe(true)
      const second = await contracts('alpha2', alpha2.token, { search: 'Camille' })
      expect(second.body.items).toEqual([])
      expect(second.body.planningRestricted).toBe(true)
      const all = await contracts('alpha2', alpha2.token)
      expect(names(all)).not.toContain('Camille Dupont')
    })

    it('[rule-evp-siret-shared-contracts] a person seen at the planning of both crèches is offered to both', async () => {
      await shareSiret()
      await readPlanning([fx('Camille', 'Dupont', 'Crèche Alpha', d(-3), NIR3), fx('Camille', 'Dupont', 'Crèche Alpha Deux', d(-2), NIR3)])
      const first = await contracts('alpha', w.dirA.token, { search: 'Camille' })
      const second = await contracts('alpha2', alpha2.token, { search: 'Camille' })
      expect(names(first)).toEqual(['Camille Dupont'])
      expect(names(second)).toEqual(['Camille Dupont'])
      // new in v3: the crèches of a shared SIRET are flagged (v2 answered without the flag)
      expect([first.body.planningRestricted, second.body.planningRestricted]).toEqual([true, true])
    })

    it('[rule-evp-siret-shared-contracts-visible] a person seen at no planning of the SIRET (long leave, recent hire) is offered to each crèche of the SIRET, never to none', async () => {
      await shareSiret()
      await readPlanning([fx('Camille', 'Dupont', 'Crèche Alpha', d(-3), NIR3)])
      for (const [code, token] of [['alpha', w.dirA.token], ['alpha2', alpha2.token]] as const) {
        const res = await contracts(code, token)
        expect({ code, names: names(res) }).toEqual({ code, names: code === 'alpha' ? ['Camille Dupont', 'Léa Martin', 'Noé Petit'] : ['Léa Martin', 'Noé Petit'] })
      }
    })

    it('[rule-evp-siret-shared-contracts-visible] Aqoona never read: every active and upcoming contract of the company is offered to each of the two crèches, planningRestricted true', async () => {
      await shareSiret()
      expect(await countRows('aqoona_plannings')).toBe(0)
      for (const [code, token] of [['alpha', w.dirA.token], ['alpha2', alpha2.token]] as const) {
        const res = await contracts(code, token)
        expect(res.status).toBe(200)
        expect({ code, names: names(res), restricted: res.body.planningRestricted }).toEqual({ code, names: ['Camille Dupont', 'Léa Martin', 'Noé Petit'], restricted: true })
      }
    })

    it('[rule-evp-siret-shared-contracts] a planning attached to a crèche of another SIRET (another company, homonym) has no effect on the list of the shared crèches', async () => {
      await shareSiret()
      const homonym = await seedContract('co-b', 'ct-b-lea', 'Léa', 'Martin')
      await setStatus(homonym.id, 'ACTIVE')
      // v5: the NIR designates her homonym of company B (emp-ct-b-lea), whatever the names of the row
      await readPlanning(
        [fx('Léa', 'Martin', 'Crèche Beta', d(-3), NIR2)],
        { 'emp-ct-b-lea': NIR2 },
        { employees: [{ companyId: 'co-b', id: 'emp-ct-b-lea', firstName: 'Léa', lastName: 'Martin' }], contracts: [{ companyId: 'co-b', id: 'ct-b-lea', employeeId: 'emp-ct-b-lea', startDate: '2020-01-01', endDate: null }] },
      )
      expect(await countRows('aqoona_plannings', "creche_code = 'beta' and employee_id = 'emp-ct-b-lea'")).toBe(1)
      for (const [code, token] of [['alpha', w.dirA.token], ['alpha2', alpha2.token]] as const) {
        expect(names(await contracts(code, token))).toContain('Léa Martin')
      }
      expect(names(await contracts('beta', w.dirB.token)).sort()).toEqual(['Léa Martin', 'Zoé Durand'])
      // new in v3: the shared crèches are flagged, the lone crèche on its own SIRET is not
      expect((await contracts('alpha', w.dirA.token)).body.planningRestricted).toBe(true)
      expect((await contracts('alpha2', alpha2.token)).body.planningRestricted).toBe(true)
      expect((await contracts('beta', w.dirB.token)).body.planningRestricted).toBe(false)
    })

    it('[rule-evp-siret-shared-contracts] the exclusion applies before the search and before the limit of 20: 20 people seen only elsewhere do not hide the 21st', async () => {
      await shareSiret()
      const rows: unknown[] = []
      const nirs: Record<string, string> = {}
      const employees: Array<{ companyId: string; id: string; firstName: string; lastName: string }> = []
      const contractsFx: Array<{ companyId: string; id: string; employeeId: string; startDate: string; endDate: string | null }> = []
      for (let i = 1; i <= 20; i += 1) {
        const first = `Aa${String(i).padStart(2, '0')}`
        const c = await seedContract('co-a', `ct-ex-${i}`, first, 'Excl')
        await setStatus(c.id, 'ACTIVE')
        nirs[`emp-ct-ex-${i}`] = nirOf(i)
        employees.push({ companyId: 'co-a', id: `emp-ct-ex-${i}`, firstName: first, lastName: 'Excl' })
        contractsFx.push({ companyId: 'co-a', id: `ct-ex-${i}`, employeeId: `emp-ct-ex-${i}`, startDate: '2020-01-01', endDate: null })
        rows.push(fx(first, 'Excl', 'Crèche Alpha Deux', d(-3), nirOf(i)))
      }
      const unseen = await seedContract('co-a', 'ct-ex-last', 'Zz', 'Excl')
      await setStatus(unseen.id, 'ACTIVE')
      await readPlanning(rows, nirs, { employees, contracts: contractsFx })
      const res = await contracts('alpha', w.dirA.token, { search: 'Excl' })
      expect(res.status).toBe(200)
      expect(names(res)).toEqual(['Zz Excl'])
      const open = await contracts('alpha', w.dirA.token, { size: 20 })
      expect(names(open)).toContain('Zz Excl')
    })

    it('[rule-evp-siret-shared-contracts-flag] planningRestricted does not depend on the last Aqoona reading, and a non-verified crèche on the same SIRET does not count as sharing', async () => {
      await seedCreche('alpha-brouillon', { name: 'Brouillon', siret: SIRET_A, verified: false })
      const alone = await contracts('alpha', w.dirA.token)
      expect(alone.body.planningRestricted).toBe(false)
      expect(names(alone)).toEqual(['Léa Martin', 'Noé Petit'])
      await seedCreche('alpha-verifiee', { name: 'Vérifiée', siret: SIRET_A })
      const shared = await contracts('alpha', w.rh.token)
      expect(shared.body.planningRestricted).toBe(true)
    })

    it('[rule-evp-siret-one-company] [rule-evp-siret-shared-contracts-flag] crèches sharing a SIRET without any PayFit company: items empty and planningRestricted present (true); a lone crèche without company: items empty, planningRestricted false', async () => {
      await seedCreche('dup1', { name: 'Dup Un', siret: '55555555555555' })
      await seedCreche('dup2', { name: 'Dup Deux', siret: '55555555555555' })
      await seedCreche('solo', { name: 'Solo', siret: '66666666666666' })
      const dup = await contracts('dup1', w.rh.token)
      expect(dup.status).toBe(200)
      expect(dup.body).toEqual({ items: [], planningRestricted: true })
      const solo = await contracts('solo', w.rh.token)
      expect(solo.status).toBe(200)
      expect(solo.body).toEqual({ items: [], planningRestricted: false })
    })

    it('[rule-evp-siret-shared-creches] GET /creches lists two crèches of the same SIRET as two distinct elements, each with its own code, directrice and ROs; sharing is no anomaly', async () => {
      await shareSiret()
      const res = await GET('/creches', w.rh.token)
      expect(res.status).toBe(200)
      const mine = res.body.items.filter((c: any) => c.siret === SIRET_A)
      expect(mine.map((c: any) => c.code).sort()).toEqual(['alpha', 'alpha2'])
      expect(mine.find((c: any) => c.code === 'alpha')).toMatchObject({ name: 'Crèche Alpha', directriceName: 'Camille Alpha', roNames: ['Rosa Alpha'], verified: true })
      expect(mine.find((c: any) => c.code === 'alpha2')).toMatchObject({ name: 'Crèche Alpha Deux', directriceName: 'Dora Deux', roNames: [], verified: true })
      const own = await GET('/creches', alpha2.token)
      expect(own.body.items.map((c: any) => c.code)).toEqual(['alpha2'])
      // new in v3: the sharing is taken into account by the contracts offered to each of the two crèches
      for (const [code, token] of [['alpha', w.dirA.token], ['alpha2', alpha2.token]] as const) {
        expect({ code, restricted: (await contracts(code, token)).body.planningRestricted }).toEqual({ code, restricted: true })
      }
    })

    it('[rule-evp-siret-shared-creches] the Sheets table can carry two crèches with the same SIRET: reading it keeps both, verified, each with its own code and perimeter, and reports no anomaly about the sharing', async () => {
      const row = (name: string, code: string, directrice: string) => ({ name, code, siret: '77777777777777', loginEmail: `${code}@micro-stars.fr`, directriceName: directrice, ros: [] })
      writeFixture('sheets', { rows: [row('Crèche Delta Un', 'DELTA1', 'Dina Un'), row('Crèche Delta Deux', 'DELTA2', 'Dino Deux')] })
      const run = await refresh(w.sup.token, 'sheets')
      expect(run.state).toBe('SUCCEEDED')
      const rows = await sql("select code, siret, verified, scope_code from base.creches where siret = '77777777777777' order by code")
      expect(rows).toEqual([
        { code: 'delta1', siret: '77777777777777', verified: true, scope_code: 'delta1' },
        { code: 'delta2', siret: '77777777777777', verified: true, scope_code: 'delta2' },
      ])
      const listed = (await GET('/creches', w.rh.token)).body.items.filter((c: any) => c.siret === '77777777777777')
      expect(listed.map((c: any) => c.code).sort()).toEqual(['delta1', 'delta2'])
      const anomalies = await GET('/sources/sheets/anomalies?size=50', w.sup.token)
      expect(anomalies.status).toBe(200)
      expect(JSON.stringify(anomalies.body)).not.toMatch(/SIRET partag|77777777777777/)
      // new in v3: the two crèches read from the table are recognised as sharing their SIRET
      const shared = await contracts('delta1', w.rh.token)
      expect(shared.status).toBe(200)
      expect(shared.body.planningRestricted).toBe(true)
    })
  })

  // ───────────────────────────── contrôle du serveur à la déclaration ─────────────────────────────
  describe('declaring on a crèche of a shared SIRET', () => {
    it('[rule-evp-creche-contract-match] POST /absences accepts a contract of the shared company for each crèche of the SIRET, even for a person the list does not offer there; a contract of another company is 409 absences.creche_contract_mismatch', async () => {
      await shareSiret()
      await readPlanning([fx('Camille', 'Dupont', 'Crèche Alpha', d(-3), NIR3)])
      // the list does not offer her on the second crèche (v2 offered her: the declaration below is the point of the rule)
      expect((await contracts('alpha2', alpha2.token, { search: 'Camille' })).body.items).toEqual([])
      const onSecond = await createAbsence(alpha2.token, { crecheCode: 'alpha2', contractId: camille.id, startDate: d(-12), endDate: d(-11) })
      expect(onSecond.status).toBe(201)
      const onFirst = await createAbsence(w.dirA.token, { crecheCode: 'alpha', contractId: camille.id, startDate: d(-8), endDate: d(-7) })
      expect(onFirst.status).toBe(201)
      const wrong = await createAbsence(alpha2.token, { crecheCode: 'alpha2', contractId: w.ctB.id, startDate: d(-5), endDate: d(-4) })
      expect(wrong.status).toBe(409)
      expect(wrong.body.code).toBe('absences.creche_contract_mismatch')
      expect(await countRows('absences')).toBe(2)
    })
  })

  // ───────────────────────────── accès ─────────────────────────────
  describe('access', () => {
    it('[rule-evp-siret-shared-contracts] the route keeps its guards: 401 anonymous, 403 ADMINISTRATRICE, 404 for a crèche outside the perimeter or unknown (same answer)', async () => {
      await shareSiret()
      expect((await GET('/creches/alpha/contracts')).status).toBe(401)
      expect((await contracts('alpha', w.adm.token)).status).toBe(403)
      const admitted = await contracts('alpha', w.dirA.token)
      expect(admitted.status).toBe(200)
      expect(admitted.body.planningRestricted).toBe(true)
      const foreign = await contracts('alpha2', w.dirA.token)
      const unknown = await contracts('zzz', w.dirA.token)
      expect(foreign.status).toBe(404)
      expect(unknown.status).toBe(404)
      expect(foreign.body).toEqual(unknown.body)
      expect(foreign.text).not.toContain('planningRestricted')
      expect((await contracts('alpha', alpha2.token)).status).toBe(404)
    })
  })
})
