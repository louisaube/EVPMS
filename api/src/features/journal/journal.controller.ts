import { Controller, Get, UseGuards, UseInterceptors } from '@nestjs/common'
import { Access } from '../../platform/access/access.decorators'
import { ApiRoute, ApiTag } from '../../platform/openapi/route-contract'
import { ValidParams, ValidQuery } from '../../platform/validation/zod-validation.interceptor'
import { CapabilityGuard } from '../evp-core/capability.guard'
import { EvpContextInterceptor } from '../evp-core/evp-context.interceptor'
import {
  absenceAuditParamsSchema,
  absenceAuditResponseSchema,
  JournalQuery,
  journalFiltersResponseSchema,
  journalQuerySchema,
  journalResponseSchema,
} from './journal.schemas'
import { JournalService } from './journal.service'

const UNAUTHORIZED = { description: 'Unauthorized' }
const FORBIDDEN = { description: 'Forbidden - journal capability missing (RH and SUPERADMIN only)' }

/** rule-evp-journal-*: read-only view of the audit trail restricted to the EVP actions. No route writes or deletes. */
@Controller()
@ApiTag('Journal')
@UseGuards(CapabilityGuard('journal:read'))
@UseInterceptors(EvpContextInterceptor)
export class JournalController {
  constructor(private readonly service: JournalService) {}

  @Get('journal-entries')
  @Access({ action: 'journal:list', roles: ['user'] })
  @ApiRoute({
    description: 'Use this API action to list the entries of the EVP journal, newest first',
    query: journalQuerySchema,
    responses: {
      200: { description: 'Journal page', schema: journalResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
    },
  })
  list(@ValidQuery() query: JournalQuery) {
    return this.service.list(query)
  }

  @Get('journal-entries/filters')
  @Access({ action: 'journal:filters', roles: ['user'] })
  @ApiRoute({
    description: 'Use this API action to list the operations and the authors that can filter the journal',
    responses: {
      200: { description: 'Filters', schema: journalFiltersResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
    },
  })
  filters() {
    return this.service.filters()
  }

  @Get('absences/:id/audit')
  @Access({ action: 'absences:audit', roles: ['user'] })
  @ApiRoute({
    description: 'Use this API action to read the audit entries of a dossier of absence',
    params: absenceAuditParamsSchema,
    responses: {
      200: { description: 'Entries of the dossier', schema: absenceAuditResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: { description: 'Unknown dossier' },
    },
  })
  ofAbsence(@ValidParams() params: { id: string }) {
    return this.service.ofAbsence(params.id)
  }
}
