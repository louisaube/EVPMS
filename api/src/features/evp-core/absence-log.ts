import type { Database } from '../../platform/database/database.module'
import { absenceEvents } from '../absences/absences.tables'
import { notifications } from '../notifications/notifications.tables'

type Writer = Pick<Database, 'insert'>

/** Kinds of notifications (rule-evp-notif-*): a French title and message, never any medical detail. */
export type NotificationKind = 'CONFIRMATION' | 'MODIFICATION' | 'ANNULATION' | 'DISPARITION' | 'RESTAURATION'

/**
 * rule-evp-audit-atomic: the event of the timeline of a dossier, written in the transaction of the action.
 * `text` never carries the comment nor the new values (rule-evp-declare-no-medical-detail).
 */
export async function recordEvent(
  db: Writer,
  event: { absenceId: string; kind: string; text: string; byUserId?: string | null; payload?: Record<string, unknown> },
): Promise<void> {
  await db.insert(absenceEvents).values({
    absenceId: event.absenceId,
    kind: event.kind,
    text: event.text,
    byUserId: event.byUserId ?? null,
    payload: event.payload ?? {},
  })
}

/** rule-evp-notif-created-with-proof: the notification of a crèche, written with the event that causes it. */
export async function notifyCreche(
  db: Writer,
  notification: { kind: NotificationKind; absenceId: string; crecheCode: string; title: string; message: string },
): Promise<void> {
  await db.insert(notifications).values({
    kind: notification.kind,
    absenceId: notification.absenceId,
    scopeCode: notification.crecheCode,
    title: notification.title,
    message: notification.message,
  })
}
