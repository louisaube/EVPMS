import { eq } from 'drizzle-orm'
import type { Database } from '../../platform/database/database.module'
import { creches } from '../creches/creches.tables'
import { crecheNotFound } from './evp-errors'
import type { EvpAccess } from './evp.types'

/** rule-evp-creche-scope: the crèche exists and belongs to the perimeter of the caller, else 404 (never 403). */
export async function assertCrecheInPerimeter(
  db: Pick<Database, 'select'>,
  evp: EvpAccess,
  code: string,
): Promise<{ code: string; name: string; siret: string }> {
  if (evp.scope === 'ASSIGNED' && !evp.creches.some((creche) => creche.code === code)) throw crecheNotFound()
  const [creche] = await db
    .select({ code: creches.code, name: creches.name, siret: creches.siret })
    .from(creches)
    .where(eq(creches.code, code))
  if (!creche) throw crecheNotFound()
  return creche
}
