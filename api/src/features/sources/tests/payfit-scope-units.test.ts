import { hasNirScope, PayfitClient } from '../clients/payfit.client'
import type { HttpAnswer, SourceHttp } from '../clients/http-client'

const SCOPE = 'collaborators:social-security:read'
const SIRET = '11111111111111'
const KEY = 'unit-test-payfit-key-0001'
// fictitious NIR: right key, wrong key (same 13 digits), 13 characters without key
const RIGHT = '184127645108946'
const WRONG = '184127645108947'

const answer = (status: number, body: unknown): HttpAnswer => ({ status, headers: new Headers(), text: JSON.stringify(body) })

describe('scope of the PayFit key', () => {
  it('[rule-evp-payfit-scope-format] a string of scopes, an array of strings; empty, absent or neighbouring scopes are « missing »', () => {
    expect(hasNirScope({ scope: `collaborators:read ${SCOPE}` })).toBe(true)
    expect(hasNirScope({ scope: [SCOPE] })).toBe(true)
    expect(hasNirScope({ scope: '' })).toBe(false)
    expect(hasNirScope({})).toBe(false)
    expect(hasNirScope(null)).toBe(false)
    expect(hasNirScope({ scope: 'collaborators:social-security:read:extra' })).toBe(false)
    expect(hasNirScope({ scope: SCOPE.toUpperCase() })).toBe(false)
    expect(hasNirScope({ scope: [1, null] })).toBe(false)
  })
})

describe('PayfitClient.readNirs (the whole network)', () => {
  const collaborators = [
    { id: 'e1', socialSecurityNumber: RIGHT },
    { id: 'e2', socialSecurityNumber: WRONG },
    { id: 'e3', socialSecurityNumber: '2850575123456' },
    { id: 'e4' },
  ]

  function setup(introspection: HttpAnswer, collaboratorsAnswer: HttpAnswer = answer(200, { collaborators, meta: { nextPageToken: null } })) {
    const posts: string[] = []
    const gets: string[] = []
    const http = {
      postJson: async (url: string) => {
        posts.push(url)
        return introspection
      },
      get: async (url: string) => {
        gets.push(url)
        return collaboratorsAnswer
      },
    } as unknown as SourceHttp
    return { client: new PayfitClient(http), posts, gets }
  }

  beforeEach(() => {
    process.env.PAYFIT_API_KEYS = JSON.stringify([{ siret: SIRET, apiKey: KEY }])
  })
  afterAll(() => {
    delete process.env.PAYFIT_API_KEYS
  })

  it('[rule-evp-payfit-scope-every-read] [rule-evp-link-network-read] one introspection per key and per call, the scope granted: the collaborators are read', async () => {
    const { client, posts, gets } = setup(answer(200, { active: true, company_id: 'co1', scope: SCOPE }))
    const first = await client.readNirs()
    await client.readNirs()
    expect(posts).toHaveLength(2)
    expect(gets).toHaveLength(2)
    expect(first.get(SIRET)?.status).toBe('ok')
  })

  it('[rule-evp-nir-key-invalid-unused] [rule-evp-nir-key-absent-ok] a wrong key leaves the table and is listed by company and identifier; 13 characters stay used', async () => {
    const { client } = setup(answer(200, { active: true, company_id: 'co1', scope: [SCOPE] }))
    const result = (await client.readNirs()).get(SIRET)
    if (result?.status !== 'ok') throw new Error('expected ok')
    expect(result.invalid).toEqual([{ companyId: 'co1', employeeId: 'e2' }])
    expect([...result.table.keys()].sort()).toEqual(['2850575123456', RIGHT].sort())
    expect(result.table.get(RIGHT)).toEqual([{ companyId: 'co1', employeeId: 'e1' }])
    expect(JSON.stringify(result.invalid)).not.toContain(WRONG)
  })

  it('[rule-evp-payfit-scope-every-read] scope missing: no GET of the collaborators', async () => {
    const { client, gets } = setup(answer(200, { active: true, company_id: 'co1', scope: 'collaborators:read' }))
    expect((await client.readNirs()).get(SIRET)).toEqual({ status: 'scope-missing' })
    expect(gets).toEqual([])
  })

  it.each([
    ['inactive token', answer(200, { active: false, company_id: 'co1', scope: SCOPE })],
    ['401', answer(401, {})],
    ['403', answer(403, {})],
    ['no company', answer(200, { active: true, scope: SCOPE })],
    ['unexpected format', { status: 200, headers: new Headers(), text: 'not json' } as HttpAnswer],
  ])('[rule-evp-payfit-scope-introspection-failed] %s: the company is unreadable, not « scope missing »', async (_name, introspection) => {
    const { client, gets } = setup(introspection)
    expect((await client.readNirs()).get(SIRET)).toEqual({ status: 'unavailable' })
    expect(gets).toEqual([])
  })

  it('[rule-evp-payfit-scope-format] the collaborators refused after the introspection: unavailable', async () => {
    const { client } = setup(answer(200, { active: true, company_id: 'co1', scope: SCOPE }), answer(403, {}))
    expect((await client.readNirs()).get(SIRET)).toEqual({ status: 'unavailable' })
  })

  it('[rule-evp-link-network-read] every key of the configuration is a company of the network, and nothing is asked when no key is configured', async () => {
    process.env.PAYFIT_API_KEYS = JSON.stringify([
      { siret: SIRET, apiKey: KEY },
      { siret: '22222222222222', apiKey: 'unit-test-payfit-key-0002' },
    ])
    const { client, posts } = setup(answer(200, { active: true, company_id: 'co1', scope: SCOPE }))
    expect([...(await client.readNirs()).keys()]).toEqual([SIRET, '22222222222222'])
    expect(posts).toHaveLength(2)
    delete process.env.PAYFIT_API_KEYS
    expect((await client.readNirs()).size).toBe(0)
    expect(posts).toHaveLength(2)
  })
})

describe('PayfitClient.read (the scope of every key, at every reading)', () => {
  const WINDOW = { from: '2026-09-01', to: '2026-12-31' }

  function setup(introspection: HttpAnswer) {
    const posts: string[] = []
    const http = {
      postJson: async (url: string) => {
        posts.push(url)
        return introspection
      },
      get: async (url: string) => {
        const path = new URL(url).pathname
        if (path.startsWith('/companies-fr/')) return answer(200, { identificationNumber: SIRET, name: 'Un' })
        if (path.endsWith('/collaborators')) return answer(200, { collaborators: [{ id: 'e1', firstName: 'Léa', lastName: 'Martin' }], meta: { nextPageToken: null } })
        if (path.endsWith('/contracts-fr')) return answer(200, { contracts: [], meta: { nextPageToken: null } })
        return answer(200, { absences: [], meta: { nextPageToken: null } })
      },
    } as unknown as SourceHttp
    return { client: new PayfitClient(http), posts }
  }

  beforeEach(() => {
    process.env.PAYFIT_API_KEYS = JSON.stringify([{ siret: SIRET, apiKey: KEY }])
  })
  afterAll(() => {
    delete process.env.PAYFIT_API_KEYS
  })

  it('[rule-evp-payfit-scope-every-read] [rule-evp-payfit-scope-one-per-key] one introspection per key and per reading, even with the identifier in the cache, and the scope is never read from the cache', async () => {
    const { client, posts } = setup(answer(200, { active: true, company_id: 'co1', scope: SCOPE }))
    const cached = async () => 'co1'
    expect((await client.read(WINDOW, async () => null)).scopeChecks).toEqual([{ siret: SIRET, status: 'ok' }])
    expect((await client.read(WINDOW, cached)).scopeChecks).toEqual([{ siret: SIRET, status: 'ok' }])
    expect(posts).toHaveLength(2)
  })

  it('[rule-evp-payfit-scope-every-read] a key without the scope is reported and the company is read all the same', async () => {
    const { client } = setup(answer(200, { active: true, company_id: 'co1', scope: 'collaborators:read' }))
    const data = await client.read(WINDOW, async () => null)
    expect(data.scopeChecks).toEqual([{ siret: SIRET, status: 'scope-missing' }])
    expect(data.employees).toHaveLength(1)
  })

  it.each([
    ['401', answer(401, {}), 'clé refusée'],
    ['403', answer(403, {}), 'clé refusée'],
    ['429', answer(429, {}), 'limite de débit'],
    ['500', answer(500, {}), 'PayFit injoignable'],
    ['inactive', answer(200, { active: false, company_id: 'co1', scope: SCOPE }), 'clé inactive'],
    ['unexpected', answer(200, ['x']), 'réponse inattendue'],
  ])('[rule-evp-payfit-scope-introspection-failed] %s: reported with the cause in words, nothing is guessed; the cached identifier keeps the company readable', async (_name, introspection, cause) => {
    const { client } = setup(introspection)
    const data = await client.read(WINDOW, async () => 'co1')
    expect(data.scopeChecks).toEqual([{ siret: SIRET, status: 'failed', cause }])
    expect(JSON.stringify(data.scopeChecks)).not.toContain(KEY)
    expect(data.employees).toHaveLength(1)
  })

  it('[rule-evp-payfit-scope-introspection-failed] without a cached identifier a failed introspection makes the company unreachable (the reading of the only company fails)', async () => {
    const { client } = setup(answer(401, {}))
    await expect(client.read(WINDOW, async () => null)).rejects.toThrow()
  })
})
