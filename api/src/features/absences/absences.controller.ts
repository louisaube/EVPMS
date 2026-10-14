import { Controller, Get, HttpCode, Patch, Post, Res, UseGuards, UseInterceptors } from '@nestjs/common'
import type { Response } from 'express'
import { Access } from '../../platform/access/access.decorators'
import { AuditExempt, Audited } from '../../platform/audit/audit.decorators'
import { fieldNames } from '../../platform/audit/audit-text'
import { ApiRoute, ApiTag } from '../../platform/openapi/route-contract'
import { ValidBody, ValidParams, ValidQuery } from '../../platform/validation/zod-validation.interceptor'
import { CapabilityGuard } from '../evp-core/capability.guard'
import { EvpContextInterceptor } from '../evp-core/evp-context.interceptor'
import { Evp } from '../evp-core/evp.decorators'
import type { EvpAccess } from '../evp-core/evp.types'
import {
  absenceDetailSchema,
  absenceIdParamsSchema,
  absencesListQuerySchema,
  absencesListResponseSchema,
  AbsencesListQuery,
  absenceTypesResponseSchema,
  createAbsenceBodySchema,
  CreateAbsenceBody,
  createAbsenceResponseSchema,
  ReasonBody,
  reasonBodySchema,
  TodoQuery,
  todoQuerySchema,
  todoResponseSchema,
  updateAbsenceBodySchema,
  UpdateAbsenceBody,
  validateBatchBodySchema,
  ValidateBatchBody,
  validateBatchResponseSchema,
} from './absences.schemas'
import { AbsencesService, UPDATE_FIELD_LABELS } from './absences.service'

const UNAUTHORIZED = { description: 'Unauthorized' }
const FORBIDDEN = { description: 'Forbidden - not an EVP account, or capability missing' }
const NOT_FOUND = { description: 'Unknown dossier, or outside the perimeter' }
const NOT_ALLOWED = { description: 'Action not allowed in the current state of the dossier (absences.decision_not_allowed)' }

const objectOf = (response: { id: string; crecheCode: string }) => ({ objectId: response.id, scope: response.crecheCode })

/** rule-evp-declare-*, rule-evp-decision-*, rule-evp-list-*, rule-evp-todo-*: the dossiers of absence. */
@Controller()
@ApiTag('Absences')
@UseInterceptors(EvpContextInterceptor)
export class AbsencesController {
  constructor(private readonly service: AbsencesService) {}

  @Get('absence-types')
  @UseGuards(CapabilityGuard())
  @Access({ action: 'absences:types', roles: ['user'] })
  @ApiRoute({
    description: 'Use this API action to list the types of absence with their expected piece',
    responses: {
      200: { description: 'Types of absence', schema: absenceTypesResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
    },
  })
  types() {
    return this.service.types()
  }

  @Get('todo')
  @UseGuards(CapabilityGuard())
  @Access({ action: 'todo:read', roles: ['user'] })
  @ApiRoute({
    description: 'Use this API action to get the counters, the priority dossiers and the recent activity of the caller',
    query: todoQuerySchema,
    responses: {
      200: { description: 'The to-do board', schema: todoResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: { description: 'Unknown crèche or outside the perimeter' },
    },
  })
  todo(@ValidQuery() query: TodoQuery, @Evp() evp: EvpAccess) {
    return this.service.todo(evp, query)
  }

  @Get('absences')
  @UseGuards(CapabilityGuard())
  @Access({ action: 'absences:list', roles: ['user'] })
  @ApiRoute({
    description: 'Use this API action to list the dossiers of absence of the perimeter, newest first (200 at most)',
    query: absencesListQuerySchema,
    responses: {
      200: { description: 'Dossiers', schema: absencesListResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: { description: 'Unknown crèche or outside the perimeter' },
    },
  })
  list(@ValidQuery() query: AbsencesListQuery, @Evp() evp: EvpAccess) {
    return this.service.list(evp, query)
  }

  @Get('absences/:id')
  @UseGuards(CapabilityGuard())
  @Access({ action: 'absences:get', roles: ['user'] })
  @ApiRoute({
    description: 'Use this API action to read a dossier of absence with its pieces, timeline and allowed actions',
    params: absenceIdParamsSchema,
    responses: {
      200: { description: 'The dossier', schema: absenceDetailSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: NOT_FOUND,
    },
  })
  get(@ValidParams() params: { id: string }, @Evp() evp: EvpAccess) {
    return this.service.get(evp, params.id)
  }

  @Post('absences')
  @UseGuards(CapabilityGuard('absences:create'))
  @Access({ action: 'absences:create', roles: ['user'] })
  @Audited({
    objectType: 'Absence',
    describe: ({ response }) => {
      const absence = 'duplicate' in response ? response.absence : response
      return { ...objectOf(absence), summary: `Déclaration d'une absence pour la crèche ${absence.crecheCode}` }
    },
  })
  @ApiRoute({
    description: 'Use this API action to declare an absence; an exact active duplicate answers 200 with the existing dossier',
    body: createAbsenceBodySchema,
    responses: {
      200: { description: 'Exact active duplicate: the existing dossier', schema: createAbsenceResponseSchema },
      201: { description: 'Dossier created', schema: absenceDetailSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: { description: 'Unknown contract (absences.contract_not_found)' },
      409: { description: 'Contract of another company, or piece not attachable' },
    },
  })
  async create(
    @ValidBody() body: CreateAbsenceBody,
    @Evp() evp: EvpAccess,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { duplicate, absence } = await this.service.create(evp, body)
    res.status(duplicate ? 200 : 201)
    return duplicate ? { duplicate: true as const, absence } : absence
  }

  @Patch('absences/:id')
  @UseGuards(CapabilityGuard('absences:create'))
  @Access({ action: 'absences:update', roles: ['user'] })
  @Audited({
    objectType: 'Absence',
    describe: ({ response, sentFields }) => ({
      ...objectOf(response),
      summary: `Modification d'un dossier d'absence (${fieldNames(sentFields, UPDATE_FIELD_LABELS)})`,
    }),
  })
  @ApiRoute({
    description: 'Use this API action to modify a dossier of absence; the state and the controls are recomputed',
    params: absenceIdParamsSchema,
    body: updateAbsenceBodySchema,
    responses: {
      200: { description: 'The modified dossier', schema: absenceDetailSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: NOT_FOUND,
      409: { description: 'Not editable in this state, or duplicate of another active dossier' },
    },
  })
  update(@ValidParams() params: { id: string }, @ValidBody() body: UpdateAbsenceBody, @Evp() evp: EvpAccess) {
    return this.service.update(evp, params.id, body)
  }

  @Post('absences/validate-batch')
  @HttpCode(200)
  @UseGuards(CapabilityGuard('absences:decide'))
  @Access({ action: 'absences:validate-batch', roles: ['user'] })
  @AuditExempt('The service writes ONE journal entry (absences:validate) for the whole batch, in the transaction of the request')
  @ApiRoute({
    description: 'Use this API action to validate up to 50 dossiers; a blocked dossier is reported and does not stop the others',
    body: validateBatchBodySchema,
    responses: {
      200: { description: 'Validated and blocked dossiers', schema: validateBatchResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
    },
  })
  validateBatch(@ValidBody() body: ValidateBatchBody, @Evp() evp: EvpAccess) {
    return this.service.validateBatch(evp, body.absenceIds)
  }

  @Post('absences/:id/submit')
  @HttpCode(200)
  @UseGuards(CapabilityGuard('absences:create'))
  @Access({ action: 'absences:submit', roles: ['user'] })
  @Audited({
    objectType: 'Absence',
    describe: ({ response }) => ({ ...objectOf(response), summary: `Soumission d'un dossier d'absence de la crèche ${response.crecheCode}` }),
  })
  @ApiRoute({
    description: 'Use this API action to submit a dossier of absence; the controls are replayed',
    params: absenceIdParamsSchema,
    responses: {
      200: { description: 'The dossier', schema: absenceDetailSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: NOT_FOUND,
      409: NOT_ALLOWED,
    },
  })
  submit(@ValidParams() params: { id: string }, @Evp() evp: EvpAccess) {
    return this.service.decide(evp, params.id, 'submit')
  }

  @Post('absences/:id/cancel')
  @HttpCode(200)
  @UseGuards(CapabilityGuard('absences:create'))
  @Access({ action: 'absences:cancel', roles: ['user'] })
  @Audited({
    objectType: 'Absence',
    describe: ({ response }) => ({ ...objectOf(response), summary: `Annulation d'un dossier d'absence de la crèche ${response.crecheCode}` }),
  })
  @ApiRoute({
    description: 'Use this API action to cancel a dossier of absence with an administrative reason',
    params: absenceIdParamsSchema,
    body: reasonBodySchema,
    responses: {
      200: { description: 'The dossier', schema: absenceDetailSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: NOT_FOUND,
      409: NOT_ALLOWED,
    },
  })
  cancel(@ValidParams() params: { id: string }, @ValidBody() body: ReasonBody, @Evp() evp: EvpAccess) {
    return this.service.decide(evp, params.id, 'cancel', body.reason)
  }

  @Post('absences/:id/validate')
  @HttpCode(200)
  @UseGuards(CapabilityGuard('absences:decide'))
  @Access({ action: 'absences:validate', roles: ['user'] })
  @Audited({
    objectType: 'Absence',
    describe: ({ response }) => ({ ...objectOf(response), summary: `Validation d'un dossier d'absence de la crèche ${response.crecheCode}` }),
  })
  @ApiRoute({
    description: 'Use this API action to validate a dossier of absence; the controls are replayed',
    params: absenceIdParamsSchema,
    responses: {
      200: { description: 'The dossier', schema: absenceDetailSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: NOT_FOUND,
      409: { description: 'Not allowed in this state, or blocked by the controls (details.blockages)' },
    },
  })
  validate(@ValidParams() params: { id: string }, @Evp() evp: EvpAccess) {
    return this.service.decide(evp, params.id, 'validate')
  }

  @Post('absences/:id/return')
  @HttpCode(200)
  @UseGuards(CapabilityGuard('absences:decide'))
  @Access({ action: 'absences:return', roles: ['user'] })
  @Audited({
    objectType: 'Absence',
    describe: ({ response }) => ({ ...objectOf(response), summary: `Renvoi pour complément d'un dossier d'absence de la crèche ${response.crecheCode}` }),
  })
  @ApiRoute({
    description: 'Use this API action to return a dossier of absence to the crèche with an administrative reason',
    params: absenceIdParamsSchema,
    body: reasonBodySchema,
    responses: {
      200: { description: 'The dossier', schema: absenceDetailSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: NOT_FOUND,
      409: NOT_ALLOWED,
    },
  })
  returnToCreche(@ValidParams() params: { id: string }, @ValidBody() body: ReasonBody, @Evp() evp: EvpAccess) {
    return this.service.decide(evp, params.id, 'return', body.reason)
  }

  @Post('absences/:id/reject')
  @HttpCode(200)
  @UseGuards(CapabilityGuard('absences:decide'))
  @Access({ action: 'absences:reject', roles: ['user'] })
  @Audited({
    objectType: 'Absence',
    describe: ({ response }) => ({ ...objectOf(response), summary: `Rejet d'un dossier d'absence de la crèche ${response.crecheCode}` }),
  })
  @ApiRoute({
    description: 'Use this API action to reject a dossier of absence with an administrative reason',
    params: absenceIdParamsSchema,
    body: reasonBodySchema,
    responses: {
      200: { description: 'The dossier', schema: absenceDetailSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: NOT_FOUND,
      409: NOT_ALLOWED,
    },
  })
  reject(@ValidParams() params: { id: string }, @ValidBody() body: ReasonBody, @Evp() evp: EvpAccess) {
    return this.service.decide(evp, params.id, 'reject', body.reason)
  }

  @Post('absences/:id/mark-entered')
  @HttpCode(200)
  @UseGuards(CapabilityGuard('absences:decide'))
  @Access({ action: 'absences:mark-entered', roles: ['user'] })
  @Audited({
    objectType: 'Absence',
    describe: ({ response }) => ({ ...objectOf(response), summary: `Saisie déclarée dans PayFit pour un dossier de la crèche ${response.crecheCode}` }),
  })
  @ApiRoute({
    description: 'Use this API action to declare that a dossier has been entered in PayFit (idempotent)',
    params: absenceIdParamsSchema,
    responses: {
      200: { description: 'The dossier', schema: absenceDetailSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: NOT_FOUND,
      409: NOT_ALLOWED,
    },
  })
  markEntered(@ValidParams() params: { id: string }, @Evp() evp: EvpAccess) {
    return this.service.decide(evp, params.id, 'mark-entered')
  }
}
