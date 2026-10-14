import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseAqoonaUrls, parseMapping } from '../clients/aqoona.client'
import { parsePayfitKeys } from '../clients/payfit.client'
import { a1Range } from '../clients/sheets.client'
import { halfDays } from '../payfit-half-days'
import { normalisePayfitStatus, NON_BLOCKING_STATUSES } from '../payfit-status'
import { buildTypeMapping, readTypesFile } from '../payfit-types'
import { aqoonaWindow, failureOf, payfitWindow } from '../sources.service'
import { SourceError } from '../source-error'

const SRC = join(__dirname, '..')

describe('Google Sheets range', () => {
  it('[rule-evp-sheets-values-get] the tab name is between apostrophes, an apostrophe in the name is doubled', () => {
    expect(a1Range('Contacts des crèches', 'A:G')).toBe("'Contacts des crèches'!A:G")
    expect(a1Range("L'équipe", 'A:G')).toBe("'L''équipe'!A:G")
  })
})

describe('PayFit status vocabularies', () => {
  it('[rule-evp-payfit-status-admissible] the v1 vocabulary is read as the PayFit one, an unknown status stays raw', () => {
    expect(normalisePayfitStatus('VALIDATED')).toBe('approved')
    expect(normalisePayfitStatus('CANCELED')).toBe('cancelled')
    expect(normalisePayfitStatus('PENDING')).toBe('pending_approval')
    expect(normalisePayfitStatus('approved')).toBe('approved')
    expect(normalisePayfitStatus('whatever')).toBe('whatever')
    expect(normalisePayfitStatus(null)).toBe('')
  })

  it('[rule-evp-payfit-status-admissible] cancelled and declined absences do not block the overlap control', () => {
    expect([...NON_BLOCKING_STATUSES].sort()).toEqual(['CANCELED', 'cancelled', 'declined'])
  })
})

describe('PayFit half days', () => {
  it('[rule-evp-payfit-half-day-mapping] read by position, start and end', () => {
    expect(halfDays('beginning-of-day', 'end-of-day')).toEqual({ startHalf: 'MATIN', endHalf: 'APRES_MIDI' })
    expect(halfDays('middle-of-day', 'middle-of-day')).toEqual({ startHalf: 'APRES_MIDI', endHalf: 'MATIN' })
  })

  it('[rule-evp-payfit-half-day-mapping] a combination that is not interpretable gives null', () => {
    expect(halfDays('end-of-day', 'end-of-day')).toBeNull()
    expect(halfDays('beginning-of-day', 'beginning-of-day')).toBeNull()
    expect(halfDays(null, undefined)).toBeNull()
  })
})

describe('PayFit type mapping', () => {
  const columns = [
    { code: 'cp', payfitCode: 'fr_paid', payfitCompatibleCodes: ['fr_paid_extra'] },
    { code: 'maladie', payfitCode: null, payfitCompatibleCodes: null },
  ]

  it('[rule-evp-payfit-type-mapping] the codes of a type are the union of the file and of the columns', () => {
    const mapping = buildTypeMapping({ cp: ['fr_paid_file'], maladie: ['fr_sick'] }, columns)
    expect(mapping.codesOf('cp').sort()).toEqual(['fr_paid', 'fr_paid_extra', 'fr_paid_file'])
    expect(mapping.typeOf('fr_sick')).toBe('maladie')
    expect(mapping.typeOf('unknown')).toBeNull()
    expect(mapping.firstFileCode('cp')).toBe('fr_paid_file')
    expect(mapping.firstFileCode('absent')).toBeNull()
  })

  it('[rule-evp-payfit-type-mapping] without file (fixtures driver) only the columns count', () => {
    const mapping = buildTypeMapping(null, columns)
    expect(mapping.codesOf('cp')).toEqual(['fr_paid', 'fr_paid_extra'])
    expect(mapping.firstFileCode('cp')).toBeNull()
  })

  it('[rule-evp-payfit-type-mapping] a code designating two types, in the file or against a column, is not configured', () => {
    expect(() => buildTypeMapping({ cp: ['x'], maladie: ['x'] }, [])).toThrow(SourceError)
    expect(() => buildTypeMapping({ maladie: ['fr_paid'] }, columns)).toThrow(/un seul type/)
  })

  it('[rule-evp-payfit-type-mapping] an unreadable or malformed file is not configured and is not quoted', () => {
    expect(() => readTypesFile(join(SRC, 'does-not-exist.json'))).toThrow(SourceError)
    expect(() => readTypesFile(join(SRC, 'sources.module.ts'))).toThrow(SourceError)
  })

  it('[rule-evp-payfit-type-mapping] the file shipped with the application is valid', () => {
    expect(() => readTypesFile(join(SRC, '..', '..', '..', 'config', 'payfit-absence-types.json'))).not.toThrow()
  })
})

describe('Aqoona mapping and addresses', () => {
  const valid = {
    records: 'planning.items',
    fields: { matricule: 'a.b', prenom: 'p', nom: 'n', creche: 'c', jour: 'd', debut: 's', fin: 'e' },
    dayFormat: 'YYYY-MM-DD',
    timeFormat: 'HH:mm',
  }

  it('[rule-evp-aqoona-field-mapping] a valid mapping is accepted, an incomplete or unknown one is not configured', () => {
    expect(parseMapping(valid).records).toBe('planning.items')
    expect(() => parseMapping({ ...valid, dayFormat: 'MM/DD/YYYY' })).toThrow(SourceError)
    expect(() => parseMapping({ ...valid, fields: { matricule: 'x' } })).toThrow(SourceError)
    expect(() => parseMapping('nope')).toThrow(SourceError)
  })

  it('[rule-evp-aqoona-addresses] the second address without label is named « Adresse 2 »', () => {
    const list = parseAqoonaUrls(
      JSON.stringify([{ label: 'Alpha', url: 'https://a.example/x?t=1' }, { url: 'https://b.example/y?t=2' }]),
    )
    expect(list.map((a) => a.label)).toEqual(['Alpha', 'Adresse 2'])
  })

  it('[rule-evp-aqoona-addresses] an unreadable value is not configured and its content is not quoted', () => {
    for (const raw of [undefined, '', 'not json', '{"a":1}', '[{"url":"ftp://x"}]', '[]']) {
      let message = ''
      try {
        parseAqoonaUrls(raw)
      } catch (error) {
        message = (error as Error).message
        expect(error).toBeInstanceOf(SourceError)
      }
      expect(message).not.toContain('not json')
      expect(message).not.toBe('')
    }
  })
})

describe('PayFit keys', () => {
  it('[rule-evp-payfit-bearer] a valid list is read, an unreadable one is not configured without being quoted', () => {
    expect(parsePayfitKeys('[{"siret":"11111111111111","apiKey":"secret-key-1"}]')).toHaveLength(1)
    for (const raw of [undefined, 'secret-key-1', '[{"siret":"1","apiKey":"secret-key-1"}]', '[]']) {
      expect(() => parsePayfitKeys(raw)).toThrow(SourceError)
      try {
        parsePayfitKeys(raw)
      } catch (error) {
        expect((error as Error).message).not.toContain('secret-key-1')
      }
    }
  })
})

describe('reading windows', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-11T10:00:00Z'))
  })
  afterAll(() => {
    jest.useRealTimers()
  })

  it('[rule-evp-payfit-window] from the first day of M-2 to the last day of M+2', () => {
    expect(payfitWindow()).toEqual({ from: '2026-08-01', to: '2026-12-31' })
  })

  it('[rule-evp-aqoona-window] from D-28 to D+35', () => {
    expect(aqoonaWindow()).toEqual({ from: '2026-09-13', to: '2026-11-15' })
  })
})

describe('failures', () => {
  it('[rule-evp-sources-error-codes] [rule-evp-secrets-never-exposed] an unknown exception gives a generic message of 1..200 characters', () => {
    const failure = failureOf(new Error('select * from base.users where password = $1 /home/app/secret.ts'))
    expect(failure.code).toBe('sources.unreachable')
    expect(failure.message.length).toBeGreaterThan(0)
    expect(failure.message.length).toBeLessThanOrEqual(200)
    expect(failure.message).not.toMatch(/select|home\/app/i)
  })
})

describe('read-only readers', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'tests' ? [] : files(join(dir, e.name))) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []))

  it('[rule-evp-sources-manual] nothing is scheduled: no @Cron, no setInterval, no timer started by the module', () => {
    for (const file of [...files(SRC), ...files(join(SRC, '..', 'google-sign-in'))]) {
      const code = readFileSync(file, 'utf8')
      expect({ file, cron: /@Cron|@Interval|node-cron|setInterval/.test(code) }).toEqual({ file, cron: false })
    }
  })

  it('[rule-evp-sources-readonly] [rule-evp-payfit-scopes] the clients ask for no write: no time:write, no PUT/PATCH/DELETE', () => {
    for (const file of files(join(SRC, 'clients'))) {
      const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
      expect({ file, write: /time:write|method:\s*['"](PUT|PATCH|DELETE)['"]|spreadsheets['"]\s*[,}]/.test(code) }).toEqual({ file, write: false })
    }
    expect(readFileSync(join(SRC, 'clients', 'sheets.client.ts'), 'utf8')).toContain('spreadsheets.readonly')
  })
})
