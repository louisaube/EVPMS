import { useMemo, useState } from 'react'
import { Alert, Box, Button, Card, CardActionArea, CardContent, Dialog, DialogActions, DialogContent, DialogTitle, Link as MuiLink, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { Link } from 'react-router-dom'
import { api } from '../../../shared/api'
import { EtatAttente, EtatErreur, EtatVide } from '../../../shared/components/EtatsEcran'
import { PageHeader } from '../../../shared/components/PageHeader'
import { MESSAGE_END_BEFORE_START, formatDateTime } from '../../../shared/format'
import { useNotify } from '../../../shared/notify'
import { failureMessage, useCall } from '../../../shared/useCall'
import { SKIPPED, orNull, useLoad } from '../../../shared/useLoad'
import { useTitle } from '../../../shared/useTitle'
import { useProfile } from '../../auth/hooks/useProfile'
import { useCreches } from '../../creches/hooks/useCreches'
import { AbsenceList, ListCount } from '../../absences/components/AbsenceList'
import type { components } from '@evpms/api-client'

type BatchResult = components['schemas']['AbsenceValidateBatchResponseDto']

const MAX_BATCH = 50

/** Fallback texts of the counters' help, by role (the API normally supplies them). */
const FALLBACK_HINTS = {
  aCompleter: 'Dossiers à compléter.',
  enAttente: 'Dossiers en attente de validation ou de saisie.',
  refusees: 'Dossiers refusés.',
}

/**
 * rule-evp-todo-role-counters, rule-evp-todo-counter-definition, rule-evp-todo-priority-order,
 * rule-evp-batch-validate-rh-only, rule-evp-batch-individual-controls, rule-evp-batch-max-50,
 * rule-evp-validate-is-not-transmit, rule-evp-todo-read-notification-no-effect, rule-evp-todo-empty-state
 */
export function TodoPage() {
  useTitle('À faire')
  const call = useCall()
  const notify = useNotify()
  const { can } = useProfile()
  const creches = useCreches()
  const [creche, setCreche] = useState('')
  const [du, setDu] = useState('')
  const [au, setAu] = useState('')
  const [picked, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [confirm, setConfirm] = useState(false)
  const [sending, setSending] = useState(false)
  const [recap, setRecap] = useState<BatchResult | null>(null)

  const periodInvalid = du !== '' && au !== '' && au < du
  const canBatch = can('absences:decide')

  const { state, reload } = useLoad(
    async () => {
      if (periodInvalid) return SKIPPED
      return orNull(
        await call(() =>
          api.GET('/todo', { params: { query: { ...(creche ? { crecheCode: creche } : {}), ...(du ? { from: du } : {}), ...(au ? { to: au } : {}) } } }),
        ),
      )
    },
    [call, creche, du, au, periodInvalid],
    true,
  )

  // Only dossiers still listed and selectable count: a filter change or a reload never leaves hidden ids in the batch.
  const visible = state.status === 'ready' ? state.data : null
  const selected = useMemo<ReadonlySet<string>>(() => {
    const allowed = new Set((visible?.priority ?? []).filter((a) => a.selectable).map((a) => a.id))
    return new Set([...picked].filter((id) => allowed.has(id)))
  }, [picked, visible])

  const query = new URLSearchParams()
  if (creche) query.set('creche', creche)
  if (du) query.set('du', du)
  if (au) query.set('au', au)
  const filterSuffix = (extra: string[]) => {
    const q = new URLSearchParams(query)
    extra.forEach((e) => q.append('etat', e))
    const s = q.toString()
    return s ? `?${s}` : ''
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const submitBatch = async () => {
    if (sending) return
    setSending(true)
    const outcome = await call(() => api.POST('/absences/validate-batch', { body: { absenceIds: [...selected] } }))
    setSending(false)
    setConfirm(false)
    if (!outcome.ok) {
      notify(outcome.failure.status === 403 ? failureMessage(outcome.failure) : failureMessage(outcome.failure), 'error')
      return
    }
    setRecap(outcome.data)
    setSelected(new Set(outcome.data.blocked.map((b) => b.id)))
    reload()
  }

  const clearFilters = () => {
    setCreche('')
    setDu('')
    setAu('')
  }
  const hasFilters = creche !== '' || du !== '' || au !== ''

  const data = state.status === 'ready' ? state.data : null
  const tooMany = selected.size > MAX_BATCH
  const selection =
    canBatch && data
      ? {
          selected,
          toggle,
          toggleAll: (checked: boolean) =>
            setSelected(checked ? new Set(data.priority.filter((a) => a.selectable).map((a) => a.id)) : new Set()),
        }
      : undefined

  const counters = data
    ? [
        { key: 'aCompleter', label: 'À compléter', count: data.counters.aCompleter.count, hint: data.counters.aCompleter.hint || FALLBACK_HINTS.aCompleter, to: `/declarations${filterSuffix(['A_COMPLETER'])}` },
        { key: 'enAttente', label: 'En attente', count: data.counters.enAttente.count, hint: data.counters.enAttente.hint || FALLBACK_HINTS.enAttente, to: `/declarations${filterSuffix(['A_VALIDER', 'ANTICIPEE', 'A_SAISIR'])}` },
        { key: 'refusees', label: 'Refusées', count: data.counters.refusees.count, hint: data.counters.refusees.hint || FALLBACK_HINTS.refusees, to: `/declarations${filterSuffix(['REJETEE'])}` },
      ]
    : []

  return (
    <>
      <PageHeader title="À faire" />

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 3, alignItems: { md: 'flex-start' } }}>
        {creches.state.status === 'ready' && creches.state.data.items.length > 1 && (
          <TextField select label="Crèche" value={creche} onChange={(e) => setCreche(e.target.value)} sx={{ minWidth: 220 }}>
            <MenuItem value="">Toutes les crèches</MenuItem>
            {creches.state.data.items.map((c) => (
              <MenuItem key={c.code} value={c.code}>
                {c.name}
              </MenuItem>
            ))}
          </TextField>
        )}
        <TextField label="Du" type="date" value={du} onChange={(e) => setDu(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField
          label="Au"
          type="date"
          value={au}
          onChange={(e) => setAu(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
          error={periodInvalid}
          helperText={periodInvalid ? MESSAGE_END_BEFORE_START : undefined}
        />
        <Button variant="outlined" onClick={clearFilters} disabled={!hasFilters}>
          Effacer les filtres
        </Button>
      </Stack>

      {state.status === 'loading' && <EtatAttente />}
      {state.status === 'error' && <EtatErreur failure={state.failure} onRetry={reload} />}

      {state.status === 'ready' && data === null && <Alert severity="warning">{MESSAGE_END_BEFORE_START}</Alert>}

      {data && (
        <Stack spacing={4}>
          <Box component="section" aria-label="Compteurs">
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' } }}>
              {counters.map((c) => (
                <Card key={c.key} variant="outlined">
                  <CardActionArea component={Link} to={c.to} sx={{ p: 2 }}>
                    <CardContent sx={{ p: 0 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                        {c.label}
                      </Typography>
                      <Typography variant="h3" component="p" aria-label={`${c.label} : ${c.count}`}>
                        {c.count}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {c.hint}
                      </Typography>
                    </CardContent>
                  </CardActionArea>
                </Card>
              ))}
            </Box>
          </Box>

          <Box component="section">
            <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
              Dossiers prioritaires
            </Typography>
            {recap && (
              <Alert severity={recap.blocked.length > 0 ? 'warning' : 'success'} role="status" sx={{ mb: 2 }} onClose={() => setRecap(null)} closeText="Fermer">
                <Typography>
                  {recap.validated.length} dossier(s) validé(s). {recap.blocked.length} dossier(s) restent bloqué(s).
                </Typography>
                {recap.blocked.length > 0 && (
                  <Box component="ul" sx={{ m: 0, mt: 1, pl: 2 }}>
                    {recap.blocked.map((b) => (
                      <li key={b.id}>
                        {b.employeeName ?? 'Salariée inconnue'} : {b.blockages.map((x) => x.message).join(' ; ') || 'Contrôles non satisfaits.'}{' '}
                        <MuiLink component={Link} to={`/declarations/${b.id}`}>
                          Ouvrir le dossier
                        </MuiLink>
                      </li>
                    ))}
                  </Box>
                )}
              </Alert>
            )}
            {canBatch && data.priority.length > 0 && (
              <Stack direction="row" spacing={2} sx={{ mb: 2, alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
                <Button variant="contained" disabled={selected.size === 0 || tooMany} onClick={() => setConfirm(true)}>
                  Valider la sélection ({selected.size})
                </Button>
                {tooMany && <Typography color="error">{MAX_BATCH} dossiers au plus par lot.</Typography>}
              </Stack>
            )}
            {data.priority.length === 0 ? (
              <EtatVide>
                <Typography>Rien à faire pour le moment.</Typography>
                {can('absences:create') && (
                  <Button component={Link} to="/declarations/nouvelle" variant="contained">
                    Nouvelle absence
                  </Button>
                )}
              </EtatVide>
            ) : (
              <Stack spacing={1.5}>
                <ListCount count={data.priority.length} />
                <AbsenceList items={data.priority} selection={selection} />
              </Stack>
            )}
            <MuiLink component={Link} to={`/declarations${filterSuffix([])}`} sx={{ display: 'inline-block', mt: 2 }}>
              Voir toutes les déclarations
            </MuiLink>
          </Box>

          <Box component="section">
            <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
              Activité récente
            </Typography>
            {data.recentActivity.length === 0 ? (
              <Typography color="text.secondary">Aucune activité récente.</Typography>
            ) : (
              <Stack component="ul" spacing={1} sx={{ listStyle: 'none', p: 0, m: 0 }}>
                {data.recentActivity.slice(0, 10).map((r, i) => (
                  <Card component="li" key={`${r.absenceId}-${r.at}-${i}`} variant="outlined" sx={{ p: 1.5 }}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'space-between' }}>
                      <Typography>
                        <Typography component="span" color="text.secondary">
                          {formatDateTime(r.at)}
                        </Typography>{' '}
                        {r.text}
                      </Typography>
                      <MuiLink component={Link} to={`/declarations/${r.absenceId}`}>
                        Ouvrir le dossier
                      </MuiLink>
                    </Stack>
                  </Card>
                ))}
              </Stack>
            )}
          </Box>
        </Stack>
      )}

      <Dialog open={confirm} onClose={() => !sending && setConfirm(false)} aria-labelledby="lot-title">
        <DialogTitle id="lot-title">Valider {selected.size} dossier(s) ?</DialogTitle>
        <DialogContent>
          <Typography>
            Chaque dossier est contrôlé individuellement. Un dossier devenu invalide reste bloqué. Valider ne transmet rien à PayFit : la saisie reste à faire.
          </Typography>
          {sending && (
            <Typography role="status" sx={{ mt: 2 }}>
              Validation en cours…
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(false)} disabled={sending}>
            Annuler
          </Button>
          <Button variant="contained" onClick={() => void submitBatch()} disabled={sending}>
            Valider
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
