import { z } from 'zod'
import { uuidFormat, uuidRefinement } from '../../platform/validation/common'
import { queryBoolean } from '../evp-core/evp-query'

/** rule-evp-notif-list: `unreadOnly` keeps the notifications the caller has not read. */
export const notificationsQuerySchema = z.object({
  unreadOnly: queryBoolean('Only the notifications not yet read by the caller when true'),
})
export type NotificationsQuery = z.infer<typeof notificationsQuerySchema>

export const notificationParamsSchema = z.object({ id: uuidRefinement() })

export const notificationItemSchema = z
  .object({
    id: uuidFormat(),
    kind: z.enum(['CONFIRMATION', 'MODIFICATION', 'ANNULATION', 'DISPARITION', 'RESTAURATION']),
    absenceId: uuidFormat(),
    title: z.string().max(120),
    message: z.string().max(500),
    crecheName: z.string(),
    employeeName: z.string(),
    createdAt: z.string().meta({ format: 'date-time' }),
    read: z.boolean(),
  })
  .meta({ id: 'NotificationItemDto' })

export const notificationsResponseSchema = z
  .object({
    items: z.array(notificationItemSchema).max(100),
    truncated: z.boolean(),
    unreadCount: z.number().int().min(0),
  })
  .meta({ id: 'NotificationsResponseDto' })

export const unreadCountResponseSchema = z
  .object({ unreadCount: z.number().int().min(0) })
  .meta({ id: 'NotificationsUnreadCountDto' })

export const markReadResponseSchema = z
  .object({ id: uuidFormat(), read: z.literal(true) })
  .meta({ id: 'NotificationMarkReadDto' })
