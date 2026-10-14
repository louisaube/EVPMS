import { Controller, Get, HttpCode, Post, UseGuards, UseInterceptors } from '@nestjs/common'
import { Access } from '../../platform/access/access.decorators'
import { Audited } from '../../platform/audit/audit.decorators'
import { ApiRoute, ApiTag } from '../../platform/openapi/route-contract'
import { ValidBody, ValidParams } from '../../platform/validation/zod-validation.interceptor'
import { CapabilityGuard } from '../evp-core/capability.guard'
import { EvpContextInterceptor } from '../evp-core/evp-context.interceptor'
import { Evp } from '../evp-core/evp.decorators'
import type { EvpAccess } from '../evp-core/evp.types'
import {
  attestBodySchema,
  attestResponseSchema,
  ClosureListParams,
  closureListParamsSchema,
  ClosureParams,
  closureParamsSchema,
  closuresListResponseSchema,
} from './closures.schemas'
import { ClosuresService } from './closures.service'

const UNAUTHORIZED = { description: 'Unauthorized' }
const FORBIDDEN = { description: 'Forbidden - not an EVP account, or capability missing' }
const NOT_FOUND = { description: 'Unknown crèche or outside the perimeter' }

/** rule-evp-closure-*: monthly closure of a crèche. No route reopens or deletes a closure. */
@Controller('creches')
@ApiTag('Closures')
@UseInterceptors(EvpContextInterceptor)
export class ClosuresController {
  constructor(private readonly service: ClosuresService) {}

  @Get(':code/closures')
  @UseGuards(CapabilityGuard())
  @Access({ action: 'closures:list', roles: ['user'] })
  @ApiRoute({
    description: 'Use this API action to list the monthly closures of a crèche (current payroll month and five previous ones)',
    params: closureListParamsSchema,
    responses: {
      200: { description: 'Months of the crèche with their closure state', schema: closuresListResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: NOT_FOUND,
    },
  })
  list(@ValidParams() params: ClosureListParams, @Evp() evp: EvpAccess) {
    return this.service.list(evp, params.code)
  }

  @Post(':code/closures/:month')
  @HttpCode(200)
  @UseGuards(CapabilityGuard('absences:create'))
  @Access({ action: 'closures:attest', roles: ['user'] })
  // rule-evp-closure-audited: the attestation is journaled in the transaction of the request.
  @Audited({
    objectType: 'Clôture',
    describe: ({ params, response }) => ({
      objectId: `${params.code}:${response.month}`,
      summary: `Clôture du mois de paie ${response.month} de la crèche ${params.code}`,
      scope: params.code,
    }),
  })
  @ApiRoute({
    description: 'Use this API action to attest and close a month of a crèche; an open dossier blocks the closure',
    params: closureParamsSchema,
    body: attestBodySchema,
    responses: {
      200: { description: 'Month closed', schema: attestResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: NOT_FOUND,
      409: { description: 'Open dossiers (details.openCount), or month already closed' },
    },
  })
  attest(@ValidParams() params: ClosureParams, @ValidBody() _body: unknown, @Evp() evp: EvpAccess) {
    return this.service.attest(evp, params.code, params.month)
  }
}
