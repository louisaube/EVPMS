import { readFileSync } from 'node:fs'
import { z } from 'zod'
import type { Database } from '../../platform/database/database.module'
import { absenceTypes } from '../absences/absences.tables'
import { evpConfig } from '../evp-core/evp-config'
import { SourceError } from './source-error'

const fileSchema = z.record(z.string().min(1), z.array(z.string().min(1).max(100)).max(100))

const invalid = (): SourceError =>
  new SourceError(
    'sources.not_configured',
    "Le fichier de correspondance des types d'absence PayFit est invalide : un code PayFit ne peut désigner qu'un seul type.",
  )

export interface TypeMapping {
  /** Every PayFit code configured for an EVP type (file and columns of the type). */
  codesOf(typeCode: string): string[]
  /** The EVP type a PayFit code designates, or null when the code is not configured. */
  typeOf(payfitCode: string): string | null
  /** The first code of the configuration file for a type (shown by the settings when the type has none). */
  firstFileCode(typeCode: string): string | null
}

export interface TypeColumns {
  code: string
  payfitCode: string | null
  payfitCompatibleCodes: string[] | null
}

/**
 * rule-evp-payfit-type-mapping: the codes of an EVP type are the union of the configuration file and of the columns
 * `payfit_code` / `payfit_compatible_codes` set on the type; a PayFit code never designates two types (otherwise the
 * configuration is invalid, which fails the reading). `file` is null when no file counts (fixtures driver).
 */
export function buildTypeMapping(file: Record<string, string[]> | null, columns: TypeColumns[]): TypeMapping {
  const byCode = new Map<string, string>()
  const byType = new Map<string, string[]>()
  const add = (typeCode: string, code: string): void => {
    const owner = byCode.get(code)
    if (owner !== undefined && owner !== typeCode) throw invalid()
    if (owner === undefined) {
      byCode.set(code, typeCode)
      byType.set(typeCode, [...(byType.get(typeCode) ?? []), code])
    }
  }
  for (const [typeCode, codes] of Object.entries(file ?? {})) for (const code of codes) add(typeCode, code)
  for (const column of columns) {
    for (const code of [column.payfitCode, ...(column.payfitCompatibleCodes ?? [])]) if (code) add(column.code, code)
  }
  return {
    codesOf: (typeCode) => byType.get(typeCode) ?? [],
    typeOf: (code) => byCode.get(code) ?? null,
    firstFileCode: (typeCode) => (file?.[typeCode] ?? [])[0] ?? null,
  }
}

/** rule-evp-payfit-type-mapping: the file is validated at each reading (never frozen at import). */
export function readTypesFile(path: string): Record<string, string[]> {
  try {
    return fileSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    throw invalid()
  }
}

export async function loadTypeMapping(db: Database): Promise<TypeMapping> {
  const config = evpConfig()
  const file = config.sourcesDriver === 'real' ? readTypesFile(config.sources.payfit.typesFile) : null
  const columns = await db
    .select({ code: absenceTypes.code, payfitCode: absenceTypes.payfitCode, payfitCompatibleCodes: absenceTypes.payfitCompatibleCodes })
    .from(absenceTypes)
  return buildTypeMapping(file, columns)
}
