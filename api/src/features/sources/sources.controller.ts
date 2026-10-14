import { Controller, Get, HttpCode, Post, UseGuards, UseInterceptors } from '@nestjs/common'
import { Access } from '../../platform/access/access.decorators'
import { Audited } from '../../platform/audit/audit.decorators'
import { ApiRoute, ApiTag } from '../../platform/openapi/route-contract'
import { ValidParams, ValidQuery } from '../../platform/validation/zod-validation.interceptor'
import { CapabilityGuard } from '../evp-core/capability.guard'
import { EvpContextInterceptor } from '../evp-core/evp-context.interceptor'
import { Evp } from '../evp-core/evp.decorators'
import type { Capability, EvpAccess, EvpRequest } from '../evp-core/evp.types'
import {
  AnomaliesQuery,
  anomaliesQuerySchema,
  anomaliesResponseSchema,
  runParamsSchema,
  runResponseSchema,
  sourceAqoonaMatchingRatesSchema,
  sourceAqoonaUnlinkedPeopleSchema,
  SourceParams,
  sourceParamsSchema,
  sourcesResponseSchema,
  startAllResponseSchema,
  startRunResponseSchema,
} from './sources.schemas'
import { SourcesService } from './sources.service'

const UNAUTHORIZED = { description: 'Unauthorized' }
const FORBIDDEN = { description: 'Forbidden - capability missing (RH and SUPERADMIN only)' }

/** Capability needed to read a given source: Workspace and unknown keys fall back on the read capability (404 / 400 follow). */
const refreshCapability = (req: EvpRequest): Capability[] => {
  const key = (req.params as { key?: string }).key
  return key === 'sheets' || key === 'payfit' || key === 'aqoona' ? [`sources:refresh:${key}`] : ['sources:read']
}

/** rule-evp-sources-*: readings of the external sources are manual, read-only and traced. */
@Controller('sources')
@ApiTag('Sources')
@UseInterceptors(EvpContextInterceptor)
export class SourcesController {
  constructor(private readonly service: SourcesService) {}

  @Get()
  @UseGuards(CapabilityGuard('sources:read'))
  @Access({ action: 'sources:list', roles: ['user'] })
  @ApiRoute({
    description: 'Use this API action to list the sources with their state, volumes, reading window and anomaly count',
    responses: {
      200: { description: 'Sources', schema: sourcesResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
    },
  })
  list(@Evp() evp: EvpAccess) {
    return this.service.list(evp)
  }

  @Post('refresh-all')
  @HttpCode(202)
  @UseGuards(CapabilityGuard('sources:refresh:sheets'))
  @Access({ action: 'sources:refresh-all', roles: ['user'] })
  @Audited({
    objectType: 'Lecture de source',
    describe: () => ({ objectId: 'all', summary: 'Lancement de la lecture de toutes les sources' }),
  })
  @ApiRoute({
    description: 'Use this API action to read Sheets, then PayFit, then Aqoona (the first failure stops the chain)',
    responses: {
      202: { description: 'Reading started', schema: startAllResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      409: { description: 'A reading is already running (sources.run_in_progress)' },
    },
  })
  refreshAll(@Evp() evp: EvpAccess) {
    return this.service.startAll(evp)
  }

  @Get('runs/:id')
  @UseGuards(CapabilityGuard('sources:read'))
  @Access({ action: 'sources:run', roles: ['user'] })
  @ApiRoute({
    description: 'Use this API action to follow a reading',
    params: runParamsSchema,
    responses: {
      200: { description: 'Reading', schema: runResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: { description: 'Unknown reading' },
    },
  })
  run(@ValidParams() params: { id: string }) {
    return this.service.run(params.id)
  }

  // rule-evp-matching-rates-route, rule-evp-matching-rates-same-rights: same guard as `GET /sources`
  @Get('aqoona/matching-rates')
  @UseGuards(CapabilityGuard('sources:read'))
  @Access({ action: 'sources:matching-rates', roles: ['user'] })
  @ApiRoute({
    description: 'Use this API action to read, for each company, the number and the share of the people linked to PayFit by their NIR and of the people not linked',
    responses: {
      200: { description: 'Rates of attachment per company, in people', schema: sourceAqoonaMatchingRatesSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
    },
  })
  matchingRates() {
    return this.service.matchingRates()
  }

  // rule-evp-unlinked-list-same-rights: same guard as `GET /sources`; declared before the routes with a `:key` segment
  @Get('aqoona/unlinked-people')
  @UseGuards(CapabilityGuard('sources:read'))
  @Access({ action: 'sources:unlinked-people', roles: ['user'] })
  @ApiRoute({
    description: 'Use this API action to list the people of Aqoona not linked to PayFit, with the cause and the crèches where they were read',
    query: anomaliesQuerySchema,
    responses: {
      200: { description: 'People not linked, one entry per person and per cause', schema: sourceAqoonaUnlinkedPeopleSchema },
      400: { description: 'Query parameter out of bounds' },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
    },
  })
  unlinkedPeople(@ValidQuery() query: AnomaliesQuery) {
    return this.service.unlinkedPeople(query)
  }

  @Get(':key/anomalies')
  @UseGuards(CapabilityGuard('sources:read'))
  @Access({ action: 'sources:anomalies', roles: ['user'] })
  @ApiRoute({
    description: 'Use this API action to list the anomalies of the last successful reading of a source',
    params: sourceParamsSchema,
    query: anomaliesQuerySchema,
    responses: {
      200: { description: 'Anomalies', schema: anomaliesResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
    },
  })
  anomalies(@ValidParams() params: SourceParams, @ValidQuery() query: AnomaliesQuery) {
    return this.service.anomalies(params.key, query)
  }

  @Post(':key/refresh')
  @HttpCode(202)
  @UseGuards(CapabilityGuard(refreshCapability))
  @Access({ action: 'sources:refresh', roles: ['user'] })
  @Audited({
    objectType: 'Lecture de source',
    describe: ({ params }) => ({ objectId: params.key, summary: `Lancement de la lecture de la source ${params.key}` }),
  })
  @ApiRoute({
    description: 'Use this API action to read one source (Sheets: SUPERADMIN; PayFit, Aqoona: RH and SUPERADMIN); Workspace is not readable',
    params: sourceParamsSchema,
    responses: {
      202: { description: 'Reading started', schema: startRunResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: { description: 'Workspace cannot be refreshed through the API' },
      409: { description: 'A reading of this source is already running (sources.run_in_progress)' },
    },
  })
  refresh(@ValidParams() params: SourceParams, @Evp() evp: EvpAccess) {
    return this.service.start(evp, params.key)
  }
}
