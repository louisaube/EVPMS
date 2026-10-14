import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { maskUrl, redactSecrets } from '../../evp-core/redact-secrets'
import { toLoginError } from '../../google-sign-in/google-sign-in.service'
import { normaliseSlotType, UNREADABLE_TYPE } from '../aqoona-slot-types'
import { loadMapping, parseMapping, withWindow, interpretRecord } from '../clients/aqoona.client'
import { parsePayfitKeys } from '../clients/payfit.client'
import { canonicalNir, looksLikeNir, payfitNirKey } from '../nir'

const SRC = join(__dirname, '..')
const NIR = '285057512345623'
const spaced = '2 85 05 75 123 456 23'
const ALIASES = { GARDE: ['garde', 'garde enfant', 'terrain'], PAUSE: ['pause', 'pauses'], MENAGE: ['menage', 'entretien'] }

describe('NIR as a transient key', () => {
  it('[rule-evp-aqoona-nir-format] a complete NIR has 15 characters once spaces, dots and hyphens are removed; Corsica 2A and 2B are accepted', () => {
    expect(canonicalNir(NIR)).toBe(NIR)
    expect(canonicalNir(spaced)).toBe(NIR)
    expect(canonicalNir('2.85-05 75123456 23')).toBe(NIR)
    expect(canonicalNir('190052A12345612')).toBe('190052A12345612')
    expect(canonicalNir('190052b12345612')).toBe('190052B12345612')
  })

  it('[rule-evp-aqoona-nir-format] anything else is absent: 13 characters, 14 digits (a SIRET), another length, text', () => {
    for (const value of ['2850575123456', '28505751234562', '1850575123456789', '12345', 'MAT-00042', '', null, undefined, {}]) {
      expect(canonicalNir(value)).toBeNull()
    }
  })

  it('[rule-evp-aqoona-nir-format] PayFit may give the 13 first characters only', () => {
    expect(payfitNirKey(NIR)).toBe(NIR)
    expect(payfitNirKey('2 85 05 75 123 456')).toBe('2850575123456')
    expect(payfitNirKey('28505751234562')).toBeNull()
  })

  it('[rule-evp-aqoona-nir-no-trace-in-types] looksLikeNir covers 13 and 15 characters, nothing else', () => {
    expect(looksLikeNir(NIR)).toBe(true)
    expect(looksLikeNir(spaced)).toBe(true)
    expect(looksLikeNir('2850575123456')).toBe(true)
    expect(looksLikeNir('Garde')).toBe(false)
    expect(looksLikeNir('28505751234562')).toBe(false)
  })

  it('[rule-evp-secrets-never-exposed] redactSecrets masks any text that looks like a NIR, whatever the separators, and keeps a SIRET', () => {
    const out = redactSecrets(`ligne ${NIR} et ${spaced}, 2.85.05.75.123.456.23, SIRET 28505751234562`)
    expect(out).toBe('ligne [masqué] et [masqué], [masqué], SIRET 28505751234562')
  })
})

describe('slot types', () => {
  it('[rule-evp-aqoona-slot-type-normalised] every alias of the request, ignoring case, accents, spaces and the plural', () => {
    const cases: Array<[string, string]> = [
      ['Garde', 'GARDE'], ['GARDE', 'GARDE'], ['  Garde   enfant ', 'GARDE'], ['Terrain', 'GARDE'], ['gardes', 'GARDE'],
      ['PAUSE', 'PAUSE'], ['pauses', 'PAUSE'],
      ['Menage', 'MENAGE'], ['Ménage', 'MENAGE'], ['ÉNTRETIEN', 'MENAGE'], ['Ménages', 'MENAGE'],
    ]
    for (const [raw, type] of cases) expect({ raw, type: normaliseSlotType(raw, ALIASES).type }).toEqual({ raw, type })
  })

  it('[rule-evp-aqoona-slot-type-normalised] empty or absent is NON_PRECISE, unknown is AUTRE with its normalised label', () => {
    for (const raw of ['', '   ', null, undefined]) expect(normaliseSlotType(raw, ALIASES)).toEqual({ type: 'NON_PRECISE', label: null })
    expect(normaliseSlotType('Réunion', ALIASES)).toEqual({ type: 'AUTRE', label: 'reunion' })
    expect(normaliseSlotType('Formation ', ALIASES)).toEqual({ type: 'AUTRE', label: 'formation' })
  })

  it('[rule-evp-aqoona-slot-type-normalised] without a table of aliases any non empty type is AUTRE', () => {
    expect(normaliseSlotType('Garde', undefined).type).toBe('AUTRE')
  })

  it('[rule-evp-aqoona-nir-no-trace-in-types] a type that looks like a NIR is AUTRE and never quoted', () => {
    for (const raw of [NIR, spaced]) expect(normaliseSlotType(raw, ALIASES)).toEqual({ type: 'AUTRE', label: UNREADABLE_TYPE })
    expect(normaliseSlotType('???', ALIASES)).toEqual({ type: 'AUTRE', label: UNREADABLE_TYPE })
  })
})

describe('« Pros » address and mapping', () => {
  const window = { from: '2026-09-14', to: '2026-11-16' }

  it('[rule-evp-aqoona-window-params] dateBegin and dateEnd are added or replaced, every other parameter is kept as it is', () => {
    const added = new URL(withWindow('https://aqoona.example/generate.php?securityCheck=abc123&lang=fr', window))
    expect([...added.searchParams.keys()].sort()).toEqual(['dateBegin', 'dateEnd', 'lang', 'securityCheck'])
    expect(added.searchParams.get('dateBegin')).toBe(window.from)
    expect(added.searchParams.get('dateEnd')).toBe(window.to)
    const replaced = new URL(withWindow('https://aqoona.example/g.php?dateBegin=2000-01-01&securityCheck=abc123&dateEnd=1999-12-31', window))
    expect(replaced.searchParams.getAll('dateBegin')).toEqual([window.from])
    expect(replaced.searchParams.getAll('dateEnd')).toEqual([window.to])
    expect(replaced.searchParams.get('securityCheck')).toBe('abc123')
  })

  it('[rule-evp-aqoona-mask] the completed address is shown masked from the ? on', () => {
    const completed = withWindow('https://aqoona.example/g.php?securityCheck=abc123', window)
    expect(maskUrl(completed)).toBe('https://aqoona.example/g.php?…')
  })

  it('[rule-evp-aqoona-mapping-final] the delivered mapping file follows the « Pros » format and its schema', () => {
    const mapping = loadMapping(join(SRC, '..', '..', '..', 'config', 'aqoona-mapping.json'))
    expect(mapping.fields).toEqual({
      matricule: 'user_matricule',
      prenom: 'user_firstname',
      nom: 'user_lastname',
      creche: 'etablissement_name',
      jour: 'planning_days_date',
      debut: 'planning_days_heure_debut',
      fin: 'planning_days_heure_fin',
      type: 'planning_days_type_creneau',
    })
    expect(mapping.records).toBe('')
    expect(mapping.slotTypes).toEqual(ALIASES)
  })

  it('[rule-evp-aqoona-mapping-final] « type » and « slotTypes » are optional, a mapping without the other fields is refused', () => {
    const base = {
      records: '',
      fields: { matricule: 'm', prenom: 'p', nom: 'n', creche: 'c', jour: 'j', debut: 'd', fin: 'f' },
      dayFormat: 'YYYY-MM-DD',
      timeFormat: 'HH:mm',
    }
    expect(() => parseMapping(base)).not.toThrow()
    expect(() => parseMapping({ ...base, fields: { matricule: 'm' } })).toThrow()
  })

  it('[rule-evp-aqoona-slots] a row gives its type when the mapping has the field, and no type at all when it has not', () => {
    const record = { user_firstname: 'Léa', user_lastname: 'Martin', user_matricule: NIR, etablissement_name: 'Crèche Alpha', planning_days_date: '2026-10-01', planning_days_heure_debut: '08:00', planning_days_heure_fin: '09:00', planning_days_type_creneau: 'Pause' }
    const withType = loadMapping(join(SRC, '..', '..', '..', 'config', 'aqoona-mapping.json'))
    expect(interpretRecord(record, withType)).toMatchObject({ type: 'Pause', start: '08:00', end: '09:00' })
    const { type: _type, ...fields } = withType.fields
    expect(interpretRecord(record, { ...withType, fields })).not.toHaveProperty('type')
    expect(interpretRecord({ ...record, planning_days_type_creneau: '' }, withType)).toMatchObject({ type: null })
  })
})

describe('PayFit keys', () => {
  const entries = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ siret: String(10000000000000 + i), apiKey: `key-${i}` })))

  it('[rule-evp-payfit-many-keys] 100 keys are accepted, 101 are refused, one company at a time and without a limit of volume of its own', () => {
    expect(parsePayfitKeys(entries(100))).toHaveLength(100)
    expect(() => parsePayfitKeys(entries(101))).toThrow()
  })
})

describe('Google sign-in refusals', () => {
  it('[rule-evp-google-sub-email-mismatch] [rule-evp-google-sub-recreated] the two new causes have their own value, the others are unchanged', () => {
    expect(toLoginError('address_changed')).toBe('adresse_modifiee')
    expect(toLoginError('account_recreated')).toBe('compte_recree')
    expect(toLoginError('account')).toBe('non_autorise')
    expect(toLoginError('hosted_domain')).toBe('domaine')
    expect(toLoginError('google_error')).toBe('annule')
    expect(toLoginError('token')).toBe('echec')
  })
})

describe('no value of a row in a log', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return name === 'tests' ? [] : files(path)
      return path.endsWith('.ts') ? [path] : []
    })

  it('[rule-evp-aqoona-nir-pii-logging] the code of sources/ writes no console.* and no logger.* call that could carry a value of Aqoona or PayFit', () => {
    // the only log is the fixed line of a failed reading, which carries the code of the error and no value
    const allowed = 'this.logger.warn(`Reading of ${key} failed (${failure.code})`)'
    for (const file of files(SRC)) {
      const calls = readFileSync(file, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /\bconsole\s*\.|\blogger\s*\./i.test(line) && line !== allowed && !line.startsWith('private readonly logger'))
      expect({ file: file.replace(SRC, ''), calls }).toEqual({ file: file.replace(SRC, ''), calls: [] })
    }
  })
})
