import { useMemo, useState } from 'react'
import { Alert, Box, Button, Card, CardActionArea, CardContent, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Link as MuiLink, MenuItem, Stack, TextField, Typography } from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import LockOpenIcon from '@mui/icons-material/LockOpen'
import LockIcon from '@mui/icons-material/Lock'
import { Link } from 'react-router-dom'
import { api } from '../../../shared/api'
import { BandeVigilance, EtatAttente, EtatErreur, EtatVide } from '../../../shared/components/EtatsEcran'
import { PageHeader } from '../../../shared/components/PageHeader'
import { formatDateTime, monthLabel, todayParis } from '../../../shared/format'
import { useNotify } from '../../../shared/notify'
import { MESSAGE_FORBIDDEN, MESSAGE_INVALID, failureMessage, useCall } from '../../../shared/useCall'
import { SKIPPED, orNull, useLoad } from '../../../shared/useLoad'
import { useTitle } from '../../../shared/useTitle'
import { useProfile } from '../../auth/hooks/useProfile'
import { useCreches } from '../hooks/useCreches'

/** Current payroll month (rule-evp-closure-month-choice): after the 25th, the next month; then the five before it. */
function monthOptions(): string[] {
  const [y, m, d] = todayParis().split('-').map(Number)
  let index = y * 12 + (m - 1) + (d > 25 ? 1 : 0)
  const out: string[] = []
  for (let i = 0; i < 6; i++, index--) out.push(`${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`)
  return out
}

function closureError(status: number, code?: string): string {
  if (code === 'closures.open_absences') return 'Des dossiers sont encore ouverts pour ce mois : la clôture est impossible.'
  if (code === 'closures.already_closed') return 'Ce mois est déjà clôturé.'
  if (status === 400) return MESSAGE_INVALID
  if (status === 403) return MESSAGE_FORBIDDEN
  return failureMessage({ status, code })
}

/**
 * rule-evp-closure-visible, rule-evp-closure-attest, rule-evp-closure-open-blocks, rule-evp-closure-payroll-month,
 * rule-evp-closure-api-roles, rule-evp-creche-scope, rule-evp-closure-month-choice, rule-evp-closure-no-reopen, rule-evp-creche-readonly
 */
export function CrechesPage() {
  useTitle('Les crèches')
  const call = useCall()
  const notify = useNotify()
  const { can } = useProfile()
  const creches = useCreches()
  const months = useMemo(monthOptions, [])
  const [chosen, setChosen] = useState<string | null>(null)
  const [month, setMonth] = useState(months[0])
  const [attested, setAttested] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const items = creches.state.status === 'ready' ? creches.state.data.items : []
  const code = chosen ?? items[0]?.code ?? ''
  const creche = items.find((c) => c.code === code)

  const closures = useLoad(
    async () => (code ? orNull(await call(() => api.GET('/creches/{code}/closures', { params: { path: { code } } }))) : SKIPPED),
    // No `keepData`: the previous crèche's counts must never enable the attestation of the one being loaded.
    [call, code],
  )
  const closure = closures.state.status === 'ready' ? closures.state.data?.items.find((c) => c.month === month) : undefined
  const closed = closure?.status === 'CLOTURE'
  const open = closure?.openCount ?? 0
  const canAttest = can('closures:attest')

  const attest = async () => {
    if (sending || !creche) return
    setSending(true)
    setError(null)
    const outcome = await call(() => api.POST('/creches/{code}/closures/{month}', { params: { path: { code, month } }, body: { attested: true } }))
    setSending(false)
    setConfirm(false)
    if (!outcome.ok) {
      setError(closureError(outcome.failure.status, outcome.failure.code))
      if (outcome.failure.code === 'closures.open_absences' || outcome.failure.code === 'closures.already_closed') closures.reload()
      return
    }
    setAttested(false)
    notify(`Le mois ${monthLabel(month)} est clôturé pour ${creche.name}.`)
    closures.reload()
  }

  return (
    <>
      <PageHeader title="Les crèches" />
      {creches.state.status === 'loading' && <EtatAttente />}
      {creches.state.status === 'error' && <EtatErreur failure={creches.state.failure} onRetry={creches.reload} />}
      {creches.state.status === 'ready' && items.length === 0 && (
        <EtatVide>
          <Typography>Aucune crèche n'est visible pour votre compte. Contactez la RH.</Typography>
        </EtatVide>
      )}
      {creches.state.status === 'ready' && items.length > 0 && (
        <Stack spacing={3}>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(auto-fill, minmax(300px, 1fr))' } }}>
            {items.map((c) => (
              <Card key={c.code} variant="outlined" sx={{ borderColor: c.code === code ? 'primary.main' : undefined, borderWidth: c.code === code ? 2 : 1 }}>
                <CardActionArea
                  component="div"
                  role="button"
                  tabIndex={0}
                  aria-pressed={c.code === code}
                  onClick={() => {
                    setChosen(c.code)
                    setAttested(false)
                    setError(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setChosen(c.code)
                      setAttested(false)
                      setError(null)
                    }
                  }}
                  sx={{ height: '100%' }}
                >
                  <CardContent>
                    <Typography variant="h6" component="h2">
                      {c.name}
                    </Typography>
                    <Typography>Code : {c.code}</Typography>
                    <Typography>SIRET : {c.siret}</Typography>
                    <Typography>Directrice : {c.directriceName ?? 'Non renseignée'}</Typography>
                    <Typography>RO : {c.roNames.length > 0 ? c.roNames.join(', ') : 'Aucune RO affectée'}</Typography>
                    <Chip
                      sx={{ mt: 1 }}
                      size="small"
                      icon={c.verified ? <CheckCircleIcon /> : <ErrorOutlineIcon />}
                      color={c.verified ? 'success' : 'default'}
                      variant="outlined"
                      label={c.verified ? 'Crèche vérifiée' : 'Non vérifiée'}
                    />
                  </CardContent>
                </CardActionArea>
              </Card>
            ))}
          </Box>

          {creche && (
            <Card component="section" aria-labelledby="cloture-titre">
              <CardContent>
                <Stack spacing={2} sx={{ maxWidth: 640 }}>
                  <Typography id="cloture-titre" variant="h5" component="h2">
                    Clôture mensuelle · {creche.name}
                  </Typography>
                  <TextField
                    select
                    label="Mois de paie"
                    value={month}
                    onChange={(e) => {
                      setMonth(e.target.value)
                      setAttested(false)
                      setError(null)
                    }}
                    sx={{ maxWidth: 280 }}
                  >
                    {months.map((m) => (
                      <MenuItem key={m} value={m}>
                        {monthLabel(m)}
                      </MenuItem>
                    ))}
                  </TextField>

                  {closures.state.status === 'loading' && <EtatAttente />}
                  {closures.state.status === 'error' && <EtatErreur failure={closures.state.failure} onRetry={closures.reload} />}
                  {closures.state.status === 'ready' && (
                    <>
                      <Chip
                        sx={{ alignSelf: 'flex-start' }}
                        icon={closed ? <LockIcon /> : <LockOpenIcon />}
                        color={closed ? 'success' : 'default'}
                        variant="outlined"
                        label={closed ? 'Clôturé' : `Ouvert · ${open} dossier(s) ouvert(s)`}
                      />
                      {closed && closure?.closedAt && (
                        <Typography>
                          Clôturé le {formatDateTime(closure.closedAt)} par {closure.closedByName}.
                        </Typography>
                      )}
                      {!closed && open > 0 && (
                        <BandeVigilance>
                          <Typography>La clôture est impossible : {open} dossier(s) ouvert(s) pour ce mois de paie, y compris ceux « à saisir ».</Typography>
                          <MuiLink component={Link} to={`/declarations?creche=${encodeURIComponent(code)}&mois=${month}&ouvertes=1`}>
                            Voir les dossiers ouverts
                          </MuiLink>
                        </BandeVigilance>
                      )}
                      {canAttest ? (
                        !closed && (
                          <>
                            <FormControlLabel
                              control={<Checkbox checked={attested} disabled={open > 0 || sending} onChange={(e) => setAttested(e.target.checked)} />}
                              label="J'atteste avoir vérifié les absences de ce mois."
                            />
                            {error && <Alert severity="error" role="alert">{error}</Alert>}
                            <Button variant="contained" disabled={!attested || open > 0 || sending} onClick={() => setConfirm(true)} sx={{ alignSelf: 'flex-start' }}>
                              {sending ? 'Clôture en cours…' : 'Clôturer le mois'}
                            </Button>
                          </>
                        )
                      ) : (
                        <Typography color="text.secondary">La clôture est attestée par la directrice de la crèche.</Typography>
                      )}
                    </>
                  )}
                </Stack>
              </CardContent>
            </Card>
          )}
        </Stack>
      )}

      <Dialog open={confirm} onClose={() => !sending && setConfirm(false)} aria-labelledby="cloture-dialog">
        <DialogTitle id="cloture-dialog">
          Clôturer {monthLabel(month)} pour {creche?.name} ?
        </DialogTitle>
        <DialogContent>
          <Typography>Vous attestez avoir vérifié les absences. Cette action est tracée au journal.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(false)} disabled={sending}>
            Annuler
          </Button>
          <Button variant="contained" onClick={() => void attest()} disabled={sending}>
            Clôturer
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
