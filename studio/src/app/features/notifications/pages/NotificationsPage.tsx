import { useState } from 'react'
import { Box, Button, Card, CardContent, Chip, FormControlLabel, Link as MuiLink, Stack, Switch, Typography } from '@mui/material'
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord'
import { Link } from 'react-router-dom'
import { api } from '../../../shared/api'
import { EtatAttente, EtatErreur, EtatVide } from '../../../shared/components/EtatsEcran'
import { PageHeader } from '../../../shared/components/PageHeader'
import { formatDateTime } from '../../../shared/format'
import { failureMessage, useCall } from '../../../shared/useCall'
import { useNotify } from '../../../shared/notify'
import { useLoad } from '../../../shared/useLoad'
import { useTitle } from '../../../shared/useTitle'
import { useProfile } from '../../auth/hooks/useProfile'

const KIND_LABEL: Record<string, string> = {
  CONFIRMATION: 'Confirmation PayFit',
  MODIFICATION: 'Modification PayFit',
  ANNULATION: 'Annulation PayFit',
  DISPARITION: 'Disparition PayFit',
  RESTAURATION: 'Restauration PayFit',
}

/**
 * rule-evp-notif-list, rule-evp-notif-max-100, rule-evp-notif-read-decides-nothing, rule-evp-notif-open-not-read,
 * rule-evp-notif-per-user-read, rule-evp-notif-scope, rule-evp-notif-no-medical, rule-evp-notif-text-from-api
 */
export function NotificationsPage() {
  useTitle('Notifications')
  const call = useCall()
  const notify = useNotify()
  const { setUnreadCount } = useProfile()
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [marking, setMarking] = useState<string | null>(null)
  // Items marked on this screen switch to « Lue » without reloading the list.
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(new Set())

  const { state, reload } = useLoad(
    async () => {
      const outcome = await call(() => api.GET('/notifications', { params: { query: unreadOnly ? { unreadOnly: 'true' } : {} } }))
      if (outcome.ok) setUnreadCount(outcome.data.unreadCount)
      return outcome
    },
    [call, unreadOnly],
  )

  const markRead = async (id: string) => {
    if (marking) return
    setMarking(id)
    const outcome = await call(() => api.POST('/notifications/{id}/read', { params: { path: { id } } }))
    setMarking(null)
    if (!outcome.ok) return notify(failureMessage(outcome.failure), 'error')
    setReadIds((prev) => new Set(prev).add(id))
    const counted = await call(() => api.GET('/notifications/unread-count'))
    if (counted.ok) setUnreadCount(counted.data.unreadCount)
  }

  const data = state.status === 'ready' ? state.data : null
  const unreadCount = data ? Math.max(0, data.unreadCount - readIds.size) : 0

  return (
    <>
      <PageHeader title="Notifications" />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2, justifyContent: 'space-between', alignItems: { sm: 'center' } }}>
        <Typography aria-live="polite" sx={{ fontWeight: 600 }}>
          {data ? (unreadCount === 0 ? 'Aucune notification non lue.' : `${unreadCount} non lue(s)`) : ''}
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={unreadOnly}
              onChange={(e) => {
                setReadIds(new Set())
                setUnreadOnly(e.target.checked)
              }}
            />
          }
          label="Afficher seulement les non lues"
        />
      </Stack>

      {state.status === 'loading' && <EtatAttente />}
      {state.status === 'error' && <EtatErreur failure={state.failure} onRetry={reload} />}
      {data && data.items.length === 0 && (
        <EtatVide>
          <Typography>{unreadOnly ? 'Aucune notification non lue.' : 'Aucune notification pour le moment.'}</Typography>
        </EtatVide>
      )}
      {data && data.items.length > 0 && (
        <Stack spacing={1.5}>
          <Stack component="ul" spacing={1.5} sx={{ listStyle: 'none', p: 0, m: 0 }}>
            {data.items.map((n) => {
              const isUnread = !n.read && !readIds.has(n.id)
              return (
                <Card key={n.id} component="li" variant="outlined" sx={{ borderColor: isUnread ? 'primary.main' : undefined }}>
                  <CardContent>
                    <Stack spacing={1}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
                        {isUnread ? (
                          <Stack direction="row" sx={{ alignItems: 'center' }}>
                            <FiberManualRecordIcon color="primary" fontSize="small" aria-hidden />
                            <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
                              Non lue
                            </Typography>
                          </Stack>
                        ) : (
                          <Typography component="span" variant="body2" color="text.secondary">
                            Lue
                          </Typography>
                        )}
                        <Chip size="small" variant="outlined" label={KIND_LABEL[n.kind] ?? 'Information'} />
                      </Stack>
                      <Typography sx={{ fontWeight: isUnread ? 700 : 400 }}>{n.title}</Typography>
                      <Typography>{n.message}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {n.crecheName} · {formatDateTime(n.createdAt)}
                      </Typography>
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
                        <MuiLink component={Link} to={`/declarations/${n.absenceId}`} aria-label={`Ouvrir le dossier de ${n.employeeName}`}>
                          Ouvrir le dossier
                        </MuiLink>
                        {isUnread && (
                          <Button variant="outlined" size="small" disabled={marking === n.id} onClick={() => void markRead(n.id)} aria-label={`Marquer comme lue la notification : ${n.title}`}>
                            Marquer comme lue
                          </Button>
                        )}
                      </Stack>
                    </Stack>
                  </CardContent>
                </Card>
              )
            })}
          </Stack>
          {data.truncated && <Box role="note">Les 100 notifications les plus récentes sont affichées.</Box>}
        </Stack>
      )}
    </>
  )
}
