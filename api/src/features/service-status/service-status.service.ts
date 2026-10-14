import { Injectable } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { Database, InjectDb } from '../../platform/database/database.module'
import { evpConfig } from '../evp-core/evp-config'
import type { ServiceStatusResponse } from './service-status.schemas'

/** rule-evp-login-service-status: can the service be used, and if not why. No HR data, never a 5xx. */
@Injectable()
export class ServiceStatusService {
  constructor(@InjectDb() private readonly db: Database) {}

  async status(): Promise<ServiceStatusResponse> {
    const config = evpConfig()
    if (config.maintenance) {
      return { status: 'unavailable', reason: 'maintenance', message: 'Le service est en maintenance. Réessayez plus tard.' }
    }
    try {
      await this.db.execute(sql`select 1`)
    } catch {
      return {
        status: 'unavailable',
        reason: 'database_unreachable',
        message: "Le service est momentanément indisponible. Réessayez dans quelques minutes.",
      }
    }
    if (!config.google) {
      return {
        status: 'unavailable',
        reason: 'google_not_configured',
        message: "La connexion avec Google n'est pas encore configurée. Contactez l'administrateur.",
      }
    }
    return { status: 'ready', reason: null, message: 'Le service est disponible.' }
  }
}
