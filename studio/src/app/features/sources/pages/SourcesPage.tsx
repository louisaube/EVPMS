import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Stack, TableCell, TableRow, Typography } from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import SyncIcon from '@mui/icons-material/Sync'
import BlockIcon from '@mui/icons-material/Block'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import type { components } from '@evpms/api-client'
import { api } from '../../../shared/api'
import { AdminList } from '../../../shared/components/AdminList'
import { EtatAttente, EtatErreur, EtatVide } from '../../../shared/components/EtatsEcran'
import { PageHeader } from '../../../shared/components/PageHeader'
import { formatDate, formatDateTime, formatNumber } from '../../../shared/format'
import { useNotify } from '../../../shared/notify'
import { MESSAGE_FORBIDDEN, failureMessage, useCall } from '../../../shared/useCall'
import { useLoad } from '../../../shared/useLoad'
import { usePagedList } from '../../../shared/usePagedList'
import { useTitle } from '../../../shared/useTitle'
import { AqoonaMatchingRates } from '../components/AqoonaMatchingRates'
import { AqoonaUnlinkedPeople } from '../components/AqoonaUnlinkedPeople'
import { redactNir } from '../components/redactNir'

type Source = components['schemas']['SourceItemDto']
type Key = Source['key']
type Anomaly = components['schemas']['SourceAnomaliesResponseDto']['items'][number]

const TITLES: Record<Key, { title: string; subtitle?: string; short: string }> = {
  workspace: { title: 'Google Workspace', subtitle: 'Identité de connexion', short: 'Google Workspace' },
  sheets: { title: 'Google Sheets : Contacts des crèches', short: 'Contacts des crèches' },
  payfit: { title: 'PayFit', short: 'PayFit' },
  aqoona: { title: 'Aqoona', short: 'Aqoona' },
}

const STATE_LABEL: Record<Source['state'], string> = {
  NEVER_READ: 'Jamais lue',
  UP_TO_DATE: 'À jour',
  RUNNING: 'Lecture en cours…',
  ERROR: 'En erreur',
  UNAVAILABLE: 'Indisponible',
  PARTIAL: 'Lecture partielle',
}

/** rule-evp-aqoona-mask: whatever the API sends, nothing after the first « ? » is ever displayed. */
function maskAddress(masked: string): string {
  const i = masked.indexOf('?')
  return i < 0 ? masked : `${masked.slice(0, i)}?…`
}

function StateChip({ state, workspaceOk }: { state: Source['state']; workspaceOk?: boolean }) {
  const label = workspaceOk !== undefined ? (workspaceOk ? 'Disponible' : 'Indisponible') : STATE_LABEL[state]
  const icon =
    state === 'UP_TO_DATE' ? <CheckCircleIcon /> : state === 'RUNNING' ? <SyncIcon /> : state === 'ERROR' ? <ErrorOutlineIcon /> : state === 'UNAVAILABLE' ? <BlockIcon /> : state === 'PARTIAL' ? <WarningAmberIcon /> : <HelpOutlineIcon />
  return <Chip icon={icon} label={label} variant="outlined" color={state === 'UP_TO_DATE' ? 'success' : state === 'ERROR' ? 'error' : state === 'PARTIAL' ? 'warning' : 'default'} sx={{ alignSelf: 'flex-start' }} />
}

interface ActiveRun {
  runId: string
  steps?: Key[]
}

/**
 * rule-evp-sources-readonly, rule-evp-sources-screen, rule-evp-sources-sheets-superadmin, rule-evp-sources-payfit-aqoona-manual,
 * rule-evp-sources-windows, rule-evp-sources-no-invention, rule-evp-sources-nir-discarded, rule-evp-sources-workspace-scope,
 * rule-evp-sources-no-auto-absence, rule-evp-sources-ro-gaps-not-overwritten, rule-evp-sources-run-polling, rule-evp-sources-guard,
 * rule-evp-sources-refresh-audited, rule-evp-sources-failure-state, rule-evp-secrets-never-exposed, rule-evp-aqoona-mask,
 * rule-evp-sources-partial-failure, rule-evp-matching-rates-screen, rule-evp-nir-key-anomalies-visible,
 * rule-evp-payfit-scope-missing-visible
 */
export function SourcesPage() {
  useTitle('Sources')
  const call = useCall()
  const notify = useNotify()
  const sources = useLoad(() => call(() => api.GET('/sources')), [call], true)
  const [confirm, setConfirm] = useState<Key | 'all' | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [run, setRun] = useState<ActiveRun | null>(null)
  const [step, setStep] = useState<string | null>(null)
  const [anomaliesOf, setAnomaliesOf] = useState<Source | null>(null)

  const items = sources.state.status === 'ready' ? sources.state.data.items : []
  // rule-evp-matching-rates-screen: the matching-rates section is read again whenever the cards are.
  const [ratesToken, setRatesToken] = useState(0)
  const { reload: reloadCards } = sources
  const reloadSources = useCallback(() => {
    reloadCards()
    setRatesToken((n) => n + 1)
  }, [reloadCards])

  // A run already in progress when the screen opens is followed too.
  // Runs that ended here: the cards still show them as RUNNING until the reload lands, they must not be followed again
  // (a second « Lecture terminée. » and a polling of a finished run).
  // A « toutes les sources » run also leaves its step runs on the cards: they are ignored with it.
  const finished = useRef(new Set<string>())
  const itemsRef = useRef(items)
  itemsRef.current = items
  const markFinished = useCallback((runId: string) => {
    finished.current.add(runId)
    for (const s of itemsRef.current) if (s.currentRunId) finished.current.add(s.currentRunId)
  }, [])
  useEffect(() => {
    if (run) return
    const running = items.find((s) => s.state === 'RUNNING' && s.currentRunId && !finished.current.has(s.currentRunId))
    if (running?.currentRunId) setRun({ runId: running.currentRunId })
  }, [items, run])

  // rule-evp-sources-run-polling: every 2 s while the run is going; stops when leaving the page.
  useEffect(() => {
    if (!run) return
    let cancelled = false
    const timer = setInterval(async () => {
      const outcome = await call(() => api.GET('/sources/runs/{id}', { params: { path: { id: run.runId } } }))
      if (cancelled) return
      if (!outcome.ok) {
        // A transient failure is retried at the next tick; a run that is unknown or no longer readable is dropped.
        if (outcome.failure.status !== 404 && outcome.failure.status !== 403) return
        clearInterval(timer)
        markFinished(run.runId)
        setRun(null)
        setStep(null)
        reloadSources()
        return
      }
      setStep(outcome.data.step)
      if (outcome.data.state === 'RUNNING') return
      clearInterval(timer)
      markFinished(run.runId)
      setRun(null)
      setStep(null)
      const startedAt = outcome.data.startedAt
      const succeeded = outcome.data.state === 'SUCCEEDED'
      if (!succeeded) notify('La lecture a échoué. Consultez les anomalies et réessayez.', 'error')
      reloadSources()
      if (succeeded) {
        // rule-evp-sources-partial-failure: a read that ended with the state PARTIAL is announced as such.
        const reloaded = await call(() => api.GET('/sources'))
        if (cancelled) return
        const partial = reloaded.ok && reloaded.data.items.some((s) => s.state === 'PARTIAL' && s.lastReadAt !== null && s.lastReadAt >= startedAt)
        if (partial) notify('La lecture est partielle. Consultez les anomalies.', 'warning')
        else notify('Lecture terminée.')
      }
    }, 2000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [run, call, notify, reloadSources, markFinished])

  const start = async (key: Key | 'all') => {
    if (starting) return
    setStarting(true)
    setError(null)
    if (key === 'all') {
      const outcome = await call(() => api.POST('/sources/refresh-all'))
      setStarting(false)
      setConfirm(null)
      if (!outcome.ok) return fail(outcome.failure)
      setRun({ runId: outcome.data.runId, steps: outcome.data.steps })
    } else {
      const outcome = await call(() => api.POST('/sources/{key}/refresh', { params: { path: { key } } }))
      setStarting(false)
      setConfirm(null)
      if (!outcome.ok) return fail(outcome.failure)
      setRun({ runId: outcome.data.runId })
    }
    reloadSources()
  }
  const fail = (failure: { status: number; code?: string }) => {
    if (failure.code === 'sources.run_in_progress') {
      // someone else started it: the cards are reloaded so that the run in progress is shown and followed
      reloadSources()
      return setError('Une lecture est déjà en cours.')
    }
    setError(failure.status === 403 ? MESSAGE_FORBIDDEN : failureMessage(failure))
  }

  const busy = run !== null || items.some((s) => s.state === 'RUNNING')
  const global = items.some((s) => s.key === 'sheets' && s.canRefresh)

  const stepText = (() => {
    if (!run?.steps || !step) return null
    const i = run.steps.findIndex((k) => k === step || TITLES[k].short.toLowerCase() === step.toLowerCase())
    return i >= 0 ? `Étape ${i + 1} sur ${run.steps.length} : ${TITLES[run.steps[i]].short}` : step
  })()

  return (
    <>
      <PageHeader title="Sources">
        {global && (
          <Button variant="contained" disabled={busy || starting} onClick={() => setConfirm('all')}>
            Actualiser toutes les sources
          </Button>
        )}
      </PageHeader>
      <Alert severity="info" icon={false} sx={{ mb: 2 }}>
        Les sources sont en lecture seule : EVP les contrôle puis les copie. Aucune écriture dans PayFit ni dans les autres sources.
      </Alert>
      {error && <Alert severity="error" role="alert" sx={{ mb: 2 }}>{error}</Alert>}
      {run && (
        <Stack role="status" spacing={1} sx={{ mb: 2 }}>
          <Typography>{stepText ?? 'Lecture en cours…'}</Typography>
          <LinearProgress />
        </Stack>
      )}

      {sources.state.status === 'loading' && <EtatAttente />}
      {sources.state.status === 'error' && <EtatErreur failure={sources.state.failure} onRetry={sources.reload} />}
      {sources.state.status === 'ready' && items.length === 0 && (
        <EtatVide>
          <Typography>Aucune source à afficher.</Typography>
        </EtatVide>
      )}
      {sources.state.status === 'ready' && items.length > 0 && (
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' } }}>
          {items.map((s) => {
            const t = TITLES[s.key] ?? { title: s.label, short: s.label }
            return (
              <Card key={s.key} component="section" aria-labelledby={`source-${s.key}`}>
                <CardContent>
                  <Stack spacing={1.25}>
                    <Box>
                      <Typography id={`source-${s.key}`} variant="h6" component="h2">
                        {t.title}
                      </Typography>
                      {t.subtitle && <Typography color="text.secondary">{t.subtitle}</Typography>}
                    </Box>
                    {s.key === 'workspace' ? (
                      <>
                        <StateChip state={s.state} workspaceOk={s.state !== 'UNAVAILABLE' && s.state !== 'ERROR'} />
                        <Typography variant="body2">Adresse vérifiée, domaine et profil seulement : aucun accès à Gmail, à l'agenda ni au Drive personnel.</Typography>
                      </>
                    ) : (
                      <>
                        <StateChip state={s.state} />
                        {/* a source not configured says so before any reading; the reading itself then names what is missing */}
                        {s.state === 'UNAVAILABLE' && !s.lastError && (
                          <Typography role="status">Source non configurée : lancez une actualisation pour connaître ce qu'il faut renseigner.</Typography>
                        )}
                        {/* rule-evp-sources-failure-state: the cause is the API's message, never built here. */}
                        {s.lastError && (
                          <Typography role="status" color="error">
                            Dernière tentative en échec le {formatDateTime(s.lastError.at)} : {redactNir(s.lastError.message)}
                          </Typography>
                        )}
                        <Typography>{s.lastReadAt ? `Dernière lecture : ${formatDateTime(s.lastReadAt)}` : 'Jamais lue'}</Typography>
                        {s.windowFrom && s.windowTo && (
                          <Typography>
                            Fenêtre : du {formatDate(s.windowFrom)} au {formatDate(s.windowTo)}
                          </Typography>
                        )}
                        {s.addresses.map((a, i) => (
                          <Typography key={`${a.label}-${i}`}>
                            Adresse lue : {a.label || `Adresse ${i + 1}`} : {maskAddress(a.masked)}
                          </Typography>
                        ))}
                        {s.volumes.length > 0 && (
                          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                            {s.volumes.map((v) => (
                              <li key={v.label}>
                                {redactNir(v.label)} : {formatNumber(v.count)}
                              </li>
                            ))}
                          </Box>
                        )}
                        <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                          <Typography>{s.anomalyCount === 0 ? 'Aucune anomalie' : `${formatNumber(s.anomalyCount)} anomalie(s)`}</Typography>
                          {s.anomalyCount > 0 && (
                            <Button variant="outlined" size="small" onClick={() => setAnomaliesOf(s)}>
                              Voir les anomalies de {t.short}
                            </Button>
                          )}
                        </Stack>
                        {s.canRefresh && (
                          <Button variant="contained" sx={{ alignSelf: 'flex-start' }} disabled={busy || starting} onClick={() => setConfirm(s.key)}>
                            Actualiser {t.short}
                          </Button>
                        )}
                      </>
                    )}
                  </Stack>
                </CardContent>
              </Card>
            )
          })}
        </Box>
      )}

      <AqoonaMatchingRates reloadToken={ratesToken} />
      <AqoonaUnlinkedPeople reloadToken={ratesToken} />

      <Dialog open={confirm !== null} onClose={() => !starting && setConfirm(null)} aria-labelledby="lecture-title">
        <DialogTitle id="lecture-title">
          {confirm === 'all' ? 'Lancer la lecture de toutes les sources ?' : `Lancer la lecture de ${confirm ? TITLES[confirm].short : ''} ?`}
        </DialogTitle>
        <DialogContent>
          <Typography>
            {confirm === 'all'
              ? "Les sources sont lues dans l'ordre : Contacts des crèches, PayFit, Aqoona. La lecture est en lecture seule et n'écrit rien dans les sources."
              : "La lecture est en lecture seule et n'écrit rien dans la source."}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)} disabled={starting}>
            Annuler
          </Button>
          <Button variant="contained" onClick={() => confirm && void start(confirm)} disabled={starting}>
            Lancer la lecture
          </Button>
        </DialogActions>
      </Dialog>

      {anomaliesOf && <AnomaliesDialog source={anomaliesOf} onClose={() => setAnomaliesOf(null)} />}
    </>
  )
}

function AnomaliesDialog({ source, onClose }: { source: Source; onClose: () => void }) {
  const call = useCall()
  const list = usePagedList<Anomaly>(async (from, size) => {
    const outcome = await call(() => api.GET('/sources/{key}/anomalies', { params: { path: { key: source.key }, query: { from, size: size as 10 | 25 | 50 } } }))
    return outcome
  })
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md" aria-labelledby="anomalies-title">
      <DialogTitle id="anomalies-title">Anomalies : {TITLES[source.key].short}</DialogTitle>
      <DialogContent>
        <AdminList
          list={list}
          columns={[{ label: 'Type' }, { label: 'Élément concerné' }, { label: 'Détail' }]}
          emptyText="Aucune anomalie."
          renderRow={(a) => (
            <TableRow key={`${a.type}-${a.subject}-${a.detail}`}>
              <TableCell>{a.label}</TableCell>
              <TableCell sx={{ overflowWrap: 'anywhere' }}>{redactNir(a.subject)}</TableCell>
              <TableCell sx={{ overflowWrap: 'anywhere' }}>{redactNir(a.detail)}</TableCell>
            </TableRow>
          )}
          renderCard={(a) => (
            <Stack spacing={0.5}>
              <Typography sx={{ fontWeight: 600 }}>{a.label}</Typography>
              <Typography variant="body2">{redactNir(a.subject)}</Typography>
              <Typography variant="body2" color="text.secondary">
                {redactNir(a.detail)}
              </Typography>
            </Stack>
          )}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fermer</Button>
      </DialogActions>
    </Dialog>
  )
}
