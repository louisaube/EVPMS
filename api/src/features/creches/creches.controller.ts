import { Controller, Get, UseGuards, UseInterceptors } from '@nestjs/common'
import { Access } from '../../platform/access/access.decorators'
import { ApiRoute, ApiTag } from '../../platform/openapi/route-contract'
import { ValidParams, ValidQuery } from '../../platform/validation/zod-validation.interceptor'
import { CapabilityGuard } from '../evp-core/capability.guard'
import { EvpContextInterceptor } from '../evp-core/evp-context.interceptor'
import { Evp } from '../evp-core/evp.decorators'
import type { EvpAccess } from '../evp-core/evp.types'
import {
  ContractsQuery,
  contractsQuerySchema,
  contractsResponseSchema,
  CrecheParams,
  crecheParamsSchema,
  crechesListResponseSchema,
} from './creches.schemas'
import { CrechesService } from './creches.service'

const UNAUTHORIZED = { description: 'Unauthorized' }
const FORBIDDEN = { description: 'Forbidden - not an EVP account, or capability missing' }

/** rule-evp-creche-readonly: reads only, the referential comes from the Sheets read. */
@Controller('creches')
@ApiTag('Creches')
@UseInterceptors(EvpContextInterceptor)
export class CrechesController {
  constructor(private readonly service: CrechesService) {}

  @Get()
  @UseGuards(CapabilityGuard())
  @Access({ action: 'creches:list', roles: ['user'] })
  @ApiRoute({
    description: 'Use this API action to list the crèches visible to the caller',
    responses: {
      200: { description: 'Crèches of the perimeter', schema: crechesListResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
    },
  })
  list(@Evp() evp: EvpAccess) {
    return this.service.list(evp)
  }

  @Get(':code/contracts')
  @UseGuards(CapabilityGuard('absences:create'))
  @Access({ action: 'creches:contracts', roles: ['user'] })
  @ApiRoute({
    description: 'Use this API action to list the imported PayFit contracts of a crèche',
    params: crecheParamsSchema,
    query: contractsQuerySchema,
    responses: {
      200: { description: 'Contracts of the company linked to the crèche by SIRET', schema: contractsResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: { description: 'Unknown crèche or outside the perimeter' },
    },
  })
  contracts(@ValidParams() params: CrecheParams, @ValidQuery() query: ContractsQuery, @Evp() evp: EvpAccess) {
    return this.service.contracts(evp, params.code, query)
  }
}
