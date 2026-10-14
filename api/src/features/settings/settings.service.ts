import { Injectable } from '@nestjs/common'
import { asc } from 'drizzle-orm'
import { Database, InjectDb } from '../../platform/database/database.module'
import { absenceTypes } from '../absences/absences.tables'
import { evpConfig } from '../evp-core/evp-config'
import { readTypesFile } from '../sources/payfit-types'
import type { SettingsResponse } from './settings.schemas'

/** rule-evp-settings-no-secret: only the visible configuration; no key, no identifier of a service. */
@Injectable()
export class SettingsService {
  constructor(@InjectDb() private readonly db: Database) {}

  /** The configuration file of the PayFit types, only with the real sources; unreadable → no code (never an error here). */
  private fileCodes(): Record<string, string[]> {
    const config = evpConfig()
    if (config.sourcesDriver !== 'real') return {}
    try {
      return readTypesFile(config.sources.payfit.typesFile)
    } catch {
      return {}
    }
  }

  async read(): Promise<SettingsResponse> {
    const types = await this.db
      .select({
        code: absenceTypes.code,
        label: absenceTypes.label,
        expectedPiece: absenceTypes.expectedPiece,
        privatePiece: absenceTypes.privatePiece,
        hrReview: absenceTypes.hrReview,
        payfitCode: absenceTypes.payfitCode,
      })
      .from(absenceTypes)
      .orderBy(asc(absenceTypes.label), asc(absenceTypes.code))
    const file = this.fileCodes()
    return {
      // rule-evp-payfit-type-mapping: the code set on the type, else the first code of the configuration file
      absenceTypes: types.map((type) => ({ ...type, payfitCode: type.payfitCode ?? file[type.code]?.[0] ?? null })),
      limits: { sessionHours: 8, uploadLinkMinutes: 5, readLinkSeconds: 60, maxFileBytes: 10485760, formats: ['PDF', 'JPEG', 'PNG'] },
      windows: {
        payfit: 'Du premier jour du mois M-2 au dernier jour du mois M+2',
        aqoona: 'De J-28 à J+35',
      },
      // rule-evp-settings-payfit-disabled
      payfitWritesEnabled: false,
    }
  }
}
