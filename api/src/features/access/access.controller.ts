import { Controller, Get, HttpCode, Patch, Post, UseGuards, UseInterceptors } from '@nestjs/common'
import { Access } from '../../platform/access/access.decorators'
import { fieldNames } from '../../platform/audit/audit-text'
import { Audited } from '../../platform/audit/audit.decorators'
import { ApiRoute, ApiTag } from '../../platform/openapi/route-contract'
import type { IdParams } from '../../platform/validation/common'
import { ValidBody, ValidParams, ValidQuery } from '../../platform/validation/zod-validation.interceptor'
import { CapabilityGuard } from '../evp-core/capability.guard'
import { EvpContextInterceptor } from '../evp-core/evp-context.interceptor'
import { Evp } from '../evp-core/evp.decorators'
import type { EvpAccess } from '../evp-core/evp.types'
import {
  accessAccountSchema,
  accessIdParamsSchema,
  AccessListQuery,
  accessListQuerySchema,
  accessListResponseSchema,
  CreateAccessBody,
  createAccessBodySchema,
  UpdateAccessBody,
  updateAccessBodySchema,
} from './access.schemas'
import { AccessService } from './access.service'

const UNAUTHORIZED = { description: 'Unauthorized' }
const FORBIDDEN = { description: 'Forbidden - capability missing, privileged account or role not manageable' }
const INVALID = { description: 'Invalid domain, missing or unverified crèche, directrice not matching the source table' }
const NOT_FOUND = { description: 'Unknown access account' }

/** rule-evp-access-address-audited: the name of the field only, never the address. */
const ACCESS_FIELDS = { email: 'adresse', name: 'nom', role: 'rôle', active: 'statut', crecheCodes: 'crèches' }

/** rule-evp-access-admin: the RH and the ADMINISTRATRICE manage the ROs, the SUPERADMIN the directrices too. */
@Controller('access-accounts')
@ApiTag('Access')
@UseGuards(CapabilityGuard('access:manage:ro'))
@UseInterceptors(EvpContextInterceptor)
export class AccessController {
  constructor(private readonly service: AccessService) {}

  @Get()
  @Access({ action: 'access:list', roles: ['user'] })
  @ApiRoute({
    description: 'Use this API action to list the access accounts the caller can manage',
    query: accessListQuerySchema,
    responses: {
      200: { description: 'Page of access accounts', schema: accessListResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
    },
  })
  list(@ValidQuery() query: AccessListQuery, @Evp() caller: EvpAccess) {
    return this.service.list(query, caller)
  }

  @Post()
  @Access({ action: 'access:create', roles: ['user'] })
  @Audited({
    objectType: 'Accès',
    describe: ({ response }) => ({
      objectId: response.id,
      summary: `Création d'un accès ${response.role} (${response.creches.length} crèche${response.creches.length > 1 ? 's' : ''})`,
    }),
  })
  @ApiRoute({
    description: 'Use this API action to create an access account (RO, or directrice for the superadmin)',
    body: createAccessBodySchema,
    responses: {
      201: { description: 'Access account created', schema: accessAccountSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      409: { description: 'An account already uses this e-mail' },
      422: INVALID,
    },
  })
  create(@ValidBody() body: CreateAccessBody, @Evp() caller: EvpAccess) {
    return this.service.create(body, caller)
  }

  @Patch(':id')
  @Access({ action: 'access:update', roles: ['user'] })
  @Audited({
    objectType: 'Accès',
    describe: ({ response, sentFields }) => ({
      objectId: response.id,
      summary: `Modification d'un accès ${response.role} (${fieldNames(sentFields, ACCESS_FIELDS)})`,
    }),
  })
  @ApiRoute({
    description: 'Use this API action to change the address, name, role, status or crèches of an access account',
    params: accessIdParamsSchema,
    body: updateAccessBodySchema,
    responses: {
      200: { description: 'Access account updated', schema: accessAccountSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: NOT_FOUND,
      409: { description: 'A caller cannot change their own role, or the address is already used (access.email_already_exists)' },
      422: INVALID,
    },
  })
  update(@ValidParams() params: IdParams, @ValidBody() body: UpdateAccessBody, @Evp() caller: EvpAccess) {
    return this.service.update(params.id, body, caller)
  }

  /** rule-evp-access-google-unlink: audited only when it succeeds (a 403, 404 or 409 writes nothing). */
  @Post(':id/unlink-google')
  @HttpCode(200)
  @Access({ action: 'access:unlink-google', roles: ['user'] })
  @Audited({
    objectType: 'Accès',
    describe: ({ response }) => ({ objectId: response.id, summary: 'Liaison Google levée' }),
  })
  @ApiRoute({
    description:
      'Use this API action to unbind an access from its Google account (recreated account): its open sessions are cut and the next valid sign-in of the address binds the new Google account',
    params: accessIdParamsSchema,
    responses: {
      200: { description: 'Access account unbound', schema: accessAccountSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: NOT_FOUND,
      409: { description: 'The access is not linked to a Google account (access.google_not_linked)' },
    },
  })
  unlinkGoogle(@ValidParams() params: IdParams, @Evp() caller: EvpAccess) {
    return this.service.unlinkGoogle(params.id, caller)
  }

  @Post(':id/remove')
  @HttpCode(200)
  @Access({ action: 'access:remove', roles: ['user'] })
  @Audited({
    objectType: 'Accès',
    describe: ({ response }) => ({ objectId: response.id, summary: `Retrait d'un accès ${response.role}` }),
  })
  @ApiRoute({
    description: 'Use this API action to remove an access: the account is deactivated, its crèches released, its history kept',
    params: accessIdParamsSchema,
    responses: {
      200: { description: 'Access account removed', schema: accessAccountSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: NOT_FOUND,
    },
  })
  remove(@ValidParams() params: IdParams, @Evp() caller: EvpAccess) {
    return this.service.remove(params.id, caller)
  }
}
