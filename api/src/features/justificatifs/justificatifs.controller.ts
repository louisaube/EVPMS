import { Controller, HttpCode, Post, UseGuards, UseInterceptors } from '@nestjs/common'
import { Access } from '../../platform/access/access.decorators'
import { AuditExempt, Audited } from '../../platform/audit/audit.decorators'
import { ambientTransaction } from '../../platform/database/transaction-context'
import { ApiRoute, ApiTag } from '../../platform/openapi/route-contract'
import { ValidBody, ValidParams } from '../../platform/validation/zod-validation.interceptor'
import { CapabilityGuard } from '../evp-core/capability.guard'
import { EvpContextInterceptor } from '../evp-core/evp-context.interceptor'
import { Evp } from '../evp-core/evp.decorators'
import type { EvpAccess } from '../evp-core/evp.types'
import {
  AuthorizeUploadBody,
  authorizeUploadBodySchema,
  authorizeUploadResponseSchema,
  confirmResponseSchema,
  pieceParamsSchema,
  readLinkResponseSchema,
} from './justificatifs.schemas'
import { JustificatifsService } from './justificatifs.service'

const UNAUTHORIZED = { description: 'Unauthorized' }
const FORBIDDEN = { description: 'Forbidden - not an EVP account, or capability missing' }
const NOT_FOUND = { description: 'Unknown piece, or outside the perimeter' }

/** rule-evp-attach-*, rule-evp-piece-*: supporting documents. No route lists, downloads or deletes a piece. */
@Controller('justificatifs')
@ApiTag('Justificatifs')
@UseInterceptors(EvpContextInterceptor)
export class JustificatifsController {
  constructor(private readonly service: JustificatifsService) {}

  @Post('authorize-upload')
  @UseGuards(CapabilityGuard('absences:create'))
  @Access({ action: 'justificatifs:authorize', roles: ['user'] })
  @Audited({
    objectType: 'Justificatif',
    describe: ({ body, response }) => ({
      objectId: response.id,
      summary: `Autorisation de dépôt d'un justificatif pour la crèche ${body.crecheCode}`,
      scope: body.crecheCode,
    }),
  })
  @ApiRoute({
    description: 'Use this API action to get a 5-minute signed URL to deposit a supporting document (PDF, JPEG or PNG, 10 MiB at most)',
    body: authorizeUploadBodySchema,
    responses: {
      201: { description: 'Signed deposit URL', schema: authorizeUploadResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: { description: 'Dossier unknown or outside the perimeter' },
    },
  })
  async authorize(@ValidBody() body: AuthorizeUploadBody, @Evp() evp: EvpAccess) {
    const result = await this.service.authorize(evp, body)
    // rule-evp-piece-unattached-cleanup: outside the transaction of the request, as the connection role
    await ambientTransaction.exit(() => this.service.cleanup())
    return result
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @UseGuards(CapabilityGuard('absences:create'))
  @Access({ action: 'justificatifs:confirm', roles: ['user'] })
  @Audited({
    objectType: 'Justificatif',
    describe: ({ params }) => ({ objectId: params.id, summary: 'Confirmation du dépôt d’un justificatif' }),
  })
  @ApiRoute({
    description: 'Use this API action to confirm a deposited document: size and signature are checked, the bytes are copied out of the deposit zone',
    params: pieceParamsSchema,
    responses: {
      200: { description: 'Piece confirmed', schema: confirmResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: NOT_FOUND,
      409: { description: 'upload_expired, not_uploaded, size_mismatch, signature_mismatch or too_many' },
    },
  })
  confirm(@ValidParams() params: { id: string }, @Evp() evp: EvpAccess) {
    return this.service.confirm(evp, params.id)
  }

  @Post(':id/read-link')
  @HttpCode(200)
  @UseGuards(CapabilityGuard())
  @Access({ action: 'justificatifs:read-link', roles: ['user'] })
  @AuditExempt('The service writes the journal entry of the opening (justificatifs:read-link) itself, with the dossier as object')
  @ApiRoute({
    description: 'Use this API action to get a 60-second link to open a confirmed document; each opening is traced',
    params: pieceParamsSchema,
    responses: {
      200: { description: 'Short-lived link', schema: readLinkResponseSchema },
      401: UNAUTHORIZED,
      403: { description: 'Not an EVP account, or private piece (justificatifs.private_piece)' },
      404: NOT_FOUND,
      409: { description: 'Piece not confirmed (justificatifs.not_confirmed)' },
    },
  })
  readLink(@ValidParams() params: { id: string }, @Evp() evp: EvpAccess) {
    return this.service.readLink(evp, params.id)
  }
}
