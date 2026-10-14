import { Controller, Get, HttpCode, Post, UseGuards, UseInterceptors } from '@nestjs/common'
import { Access } from '../../platform/access/access.decorators'
import { AuditExempt } from '../../platform/audit/audit.decorators'
import { ApiRoute, ApiTag } from '../../platform/openapi/route-contract'
import { ValidParams, ValidQuery } from '../../platform/validation/zod-validation.interceptor'
import { CapabilityGuard } from '../evp-core/capability.guard'
import { EvpContextInterceptor } from '../evp-core/evp-context.interceptor'
import { Evp } from '../evp-core/evp.decorators'
import type { EvpAccess } from '../evp-core/evp.types'
import {
  markReadResponseSchema,
  notificationParamsSchema,
  NotificationsQuery,
  notificationsQuerySchema,
  notificationsResponseSchema,
  unreadCountResponseSchema,
} from './notifications.schemas'
import { NotificationsService } from './notifications.service'

const UNAUTHORIZED = { description: 'Unauthorized' }
const FORBIDDEN = { description: 'Forbidden - not an EVP account' }

/** rule-evp-notif-*: events on the dossiers of the perimeter. Notifications are written by the platform, never by a route. */
@Controller('notifications')
@ApiTag('Notifications')
@UseGuards(CapabilityGuard('notifications:read'))
@UseInterceptors(EvpContextInterceptor)
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  @Access({ action: 'notifications:list', roles: ['user'] })
  @ApiRoute({
    description: 'Use this API action to list the notifications of the perimeter, newest first (100 at most)',
    query: notificationsQuerySchema,
    responses: {
      200: { description: 'Notifications', schema: notificationsResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
    },
  })
  list(@ValidQuery() query: NotificationsQuery, @Evp() evp: EvpAccess) {
    return this.service.list(evp, query)
  }

  @Get('unread-count')
  @Access({ action: 'notifications:count', roles: ['user'] })
  @ApiRoute({
    description: 'Use this API action to count the notifications of the perimeter not yet read by the caller',
    responses: {
      200: { description: 'Counter', schema: unreadCountResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
    },
  })
  async unreadCount(@Evp() evp: EvpAccess) {
    return { unreadCount: await this.service.unreadCount(evp) }
  }

  @Post(':id/read')
  @HttpCode(200)
  @Access({ action: 'notifications:read', roles: ['user'] })
  // rule-evp-notif-read-not-journaled: only `notification_reads` is written, never a dossier.
  @AuditExempt('Marking a notification read writes only the read state of the caller: no business data, no dossier')
  @ApiRoute({
    description: 'Use this API action to mark a notification as read for the caller (idempotent)',
    params: notificationParamsSchema,
    responses: {
      200: { description: 'Read mark', schema: markReadResponseSchema },
      401: UNAUTHORIZED,
      403: FORBIDDEN,
      404: { description: 'Unknown notification or outside the perimeter' },
    },
  })
  markRead(@ValidParams() params: { id: string }, @Evp() evp: EvpAccess) {
    return this.service.markRead(evp, params.id)
  }
}
