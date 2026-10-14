import { useState, type ReactNode } from 'react'
import { Alert, Box, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { Link, useParams } from 'react-router-dom'
import type { components } from '@evpms/api-client'
import { api } from '../../../shared/api'
import { BandeVigilance, EtatAttente, EtatErreur } from '../../../shared/components/EtatsEcran'
import { JustificatifUploader } from '../../../shared/components/JustificatifUploader'
import { StatutAbsence } from '../../../shared/components/StatutAbsence'
import { formatDate, formatDateTime, formatDateTimeSeconds, formatSize, monthLabel, periodSentence } from '../../../shared/format'
import { useNotify } from '../../../shared/notify'
import { MESSAGE_FORBIDDEN, failureMessage, useCall } from '../../../shared/useCall'
import { SKIPPED, orNull, useLoad } from '../../../shared/useLoad'
import { useTitle } from '../../../shared/useTitle'
import { useProfile } from '../../auth/hooks/useProfile'

type Detail = components['schemas']['AbsenceDetailDto']
type Action = Detail['allowedActions'][number]
type ReasonAction = 'RETURN' | 'REJECT' | 'CANCEL'

const STEPS = ['Déclarée', 'Contrôlée', 'Validée', 'Saisie dans PayFit', 'Présente dans PayFit']
const MAX_REASON = 500

const ACTION_LABEL: Record<Exclude<Action, 'ATTACH'>, string> = {
  SUBMIT: 'Soumettre à nouveau',
  VALIDATE: 'Valider',
  RETURN: 'Retourner pour complément',
  REJECT: 'Refuser',
  CANCEL: 'Annuler la déclaration',
  MARK_ENTERED: 'Saisie effectuée',
}

const REASON_TITLE: Record<ReasonAction, string> = {
  RETURN: 'Retourner le dossier pour complément',
  REJECT: 'Refuser le dossier',
  CANCEL: 'Annuler la déclaration',
}

const REASON_PATH = { RETURN: '/absences/{id}/return', REJECT: '/absences/{id}/reject', CANCEL: '/absences/{id}/cancel' } as const

const ALERT_TITLE: Record<string, string> = {
  MODIFIEE: 'Absence modifiée dans PayFit',
  ANNULEE: 'Absence annulée dans PayFit',
  DISPARUE: 'Absence non retrouvée dans PayFit',
}

const DECISION_VERB: Record<string, string> = { return: 'Retourné', reject: 'Refusé', cancel: 'Annulé' }

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card component="section">
      <CardContent>
        <Typography variant="h6" component="h2" sx={{ mb: 1.5 }}>
          {title}
        </Typography>
        {children}
      </CardContent>
    </Card>
  )
}

function Progress({ a }: { a: Detail }) {
  if (a.status === 'REJETEE') return <Typography>Ce dossier est terminé : « Rejetée ».</Typography>
  if (a.status === 'ANNULEE') return <Typography>Ce dossier est terminé : « Annulée ».</Typography>
  const step = Math.min(Math.max(a.progress.step, 1), STEPS.length)
  return (
    <Stack spacing={1.5}>
      <Typography sx={{ fontWeight: 600 }}>
        Étape {step} sur {STEPS.length} : {STEPS[step - 1]}
      </Typography>
      <Stack component="ol" direction={{ xs: 'column', sm: 'row' }} spacing={1} useFlexGap sx={{ listStyle: 'none', p: 0, m: 0, flexWrap: 'wrap' }}>
        {STEPS.map((label, i) => {
          const n = i + 1
          const current = n === step
          return (
            <Box
              component="li"
              key={label}
              aria-current={current ? 'step' : undefined}
              sx={{
                px: 1.5,
                py: 0.75,
                borderRadius: 4,
                border: '1px solid',
                borderColor: current ? 'primary.main' : '#C5D1F5',
                bgcolor: current ? 'primary.main' : n < step ? '#E3EAFF' : '#fff',
                color: current ? '#fff' : 'text.primary',
                fontWeight: current ? 600 : 400,
              }}
            >
              {n}. {label}
              {n < step ? ' (fait)' : ''}
            </Box>
          )
        })}
      </Stack>
    </Stack>
  )
}

/**
 * rule-evp-layout-four-questions, rule-evp-detail-four-questions, rule-evp-detail-content, rule-evp-detail-no-general-edit, rule-evp-decision-marine-only,
 * rule-evp-decision-states, rule-evp-decision-reason-required, rule-evp-decision-replay-controls, rule-evp-validated-is-to-enter,
 * rule-evp-mark-entered-no-proof, rule-evp-payfit-no-manual-confirm, rule-evp-payfit-alerts, rule-evp-arbitrage-rh,
 * rule-evp-notification-read-no-effect, rule-evp-piece-read-link, rule-evp-piece-no-medical-in-logs,
 * rule-evp-detail-actions-from-api, rule-evp-detail-conflict-refresh, rule-evp-detail-404-indistinct, rule-evp-detail-private-piece
 */
export function DetailAbsencePage() {
  const { id = '' } = useParams()
  // One instance per dossier: `keepData` must never keep showing dossier A, with actions bound to B, while B loads.
  return <DetailAbsence key={id} id={id} />
}

function DetailAbsence({ id }: { id: string }) {
  const call = useCall()
  const notify = useNotify()
  const { can } = useProfile()
  const detail = useLoad(() => call(() => api.GET('/absences/{id}', { params: { path: { id } } })), [call, id], true)
  const audit = useLoad(
    async () => (can('journal:read') ? orNull(await call(() => api.GET('/absences/{id}/audit', { params: { path: { id } } }))) : SKIPPED),
    [call, id, can],
    true,
  )

  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reasonAction, setReasonAction] = useState<ReasonAction | null>(null)
  const [reason, setReason] = useState('')
  const [reasonTouched, setReasonTouched] = useState(false)
  const [confirmValidate, setConfirmValidate] = useState(false)
  const [confirmEntered, setConfirmEntered] = useState(false)
  const [showUploader, setShowUploader] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)

  const a = detail.state.status === 'ready' ? detail.state.data : null
  useTitle(a ? `${a.employeeName} · ${a.typeLabel}` : 'Dossier')

  const refresh = () => {
    detail.reload()
    audit.reload()
  }

  const handleFailure = (failure: { status: number; code?: string; details?: unknown }) => {
    if (failure.code === 'absences.decision_not_allowed') {
      // The action may no longer exist on the reloaded dossier: close its dialog instead of letting the user replay a 409.
      closeReason()
      setConfirmValidate(false)
      setConfirmEntered(false)
      notify('Le dossier a changé. Il vient d’être rechargé.', 'error')
      refresh()
      return null
    }
    if (failure.code === 'absences.validation_blocked') {
      const blockages = (failure.details as { blockages?: { message: string }[] } | undefined)?.blockages ?? []
      refresh()
      return `La validation est impossible : ${blockages.map((b) => b.message).join(' ; ') || 'les contrôles bloquent ce dossier.'}`
    }
    if (failure.status === 403) return MESSAGE_FORBIDDEN
    return failureMessage(failure)
  }

  const run = async (action: () => Promise<{ ok: true } | { ok: false; failure: { status: number; code?: string; details?: unknown } }>, success: string): Promise<boolean> => {
    if (sending) return false
    setSending(true)
    setError(null)
    const outcome = await action()
    setSending(false)
    if (!outcome.ok) {
      const message = handleFailure(outcome.failure)
      if (message) setError(message)
      return false
    }
    notify(success)
    refresh()
    return true
  }

  const simple = async (kind: 'SUBMIT' | 'VALIDATE' | 'MARK_ENTERED') => {
    const ok = await run(
      () => {
        const path = kind === 'SUBMIT' ? '/absences/{id}/submit' : kind === 'VALIDATE' ? '/absences/{id}/validate' : '/absences/{id}/mark-entered'
        return call(() => api.POST(path, { params: { path: { id } } }))
      },
      kind === 'SUBMIT' ? 'Dossier soumis.' : kind === 'VALIDATE' ? 'Dossier validé : la saisie dans PayFit reste à faire.' : 'Saisie déclarée.',
    )
    if (kind === 'VALIDATE') setConfirmValidate(false)
    if (kind === 'MARK_ENTERED') setConfirmEntered(false)
    return ok
  }

  const submitReason = async () => {
    if (!reasonAction) return
    setReasonTouched(true)
    const text = reason.trim()
    if (!text) return
    const action = reasonAction
    const ok = await run(
      () => call(() => api.POST(REASON_PATH[action], { params: { path: { id } }, body: { reason: text } })),
      action === 'RETURN' ? 'Dossier retourné pour complément.' : action === 'REJECT' ? 'Dossier refusé.' : 'Déclaration annulée.',
    )
    if (ok) closeReason()
  }
  const closeReason = () => {
    setError(null)
    setReasonAction(null)
    setReason('')
    setReasonTouched(false)
  }

  const openPiece = async (pieceId: string) => {
    if (opening) return
    setOpening(pieceId)
    // The tab is opened synchronously so that the pop-up blocker lets it through; the link is never kept or shown.
    const tab = window.open('', '_blank')
    const outcome = await call(() => api.POST('/justificatifs/{id}/read-link', { params: { path: { id: pieceId } } }))
    setOpening(null)
    if (!outcome.ok) {
      tab?.close()
      return setError(outcome.failure.status === 403 ? MESSAGE_FORBIDDEN : failureMessage(outcome.failure))
    }
    if (tab) {
      tab.opener = null
      tab.location.href = outcome.data.url
    }
  }

  const back = (
    <Button component={Link} to="/declarations" startIcon={<ArrowBackIcon />} sx={{ mb: 2, alignSelf: 'flex-start' }}>
      Les déclarations
    </Button>
  )

  if (detail.state.status === 'loading') return <EtatAttente />
  if (detail.state.status === 'error') {
    if (detail.state.failure.status === 404) {
      return (
        <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
          <Typography variant="h4" component="h1">
            Dossier introuvable
          </Typography>
          <Typography>Ce dossier n'existe pas ou n'est pas accessible avec votre compte.</Typography>
          <Button component={Link} to="/declarations" variant="contained">
            Retour aux déclarations
          </Button>
        </Stack>
      )
    }
    return <EtatErreur failure={detail.state.failure} onRetry={detail.reload} />
  }
  const d = detail.state.data
  const actions = d.allowedActions
  const decisionButtons = (['SUBMIT', 'VALIDATE', 'MARK_ENTERED', 'RETURN', 'REJECT', 'CANCEL'] as const).filter((x) => actions.includes(x))
  const restoration = d.payfitAlert ? undefined : [...d.timeline].find((t) => t.kind === 'RESTAURATION')
  const decisionVerb = d.lastDecision ? DECISION_VERB[d.lastDecision.kind] : undefined
  const showDecision = d.lastDecision && decisionVerb && ['A_COMPLETER', 'REJETEE', 'ANNULEE'].includes(d.status)

  const onAction = (kind: (typeof decisionButtons)[number]) => {
    if (kind === 'SUBMIT') return void simple('SUBMIT')
    if (kind === 'VALIDATE') return setConfirmValidate(true)
    if (kind === 'MARK_ENTERED') return setConfirmEntered(true)
    setReasonAction(kind)
  }

  return (
    <Stack spacing={3}>
      {back}
      <Box>
        <Typography variant="h4" component="h1">
          {d.employeeName} · {d.typeLabel}
        </Typography>
        <Typography color="text.secondary">
          {d.crecheName} · Contrat PayFit {d.employee.payfitContractId} · Mois de paie : {monthLabel(d.payrollMonth)}
        </Typography>
        <Box sx={{ mt: 1.5 }}>
          <StatutAbsence status={d.status} saisieDeclaree={d.saisieDeclaree} />
        </Box>
      </Box>

      {error && <Alert severity="error" role="alert">{error}</Alert>}

      <Section title="Où en est le dossier">
        <Stack spacing={2}>
          <Progress a={d} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 1, sm: 6 }}>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Qui doit agir
              </Typography>
              <Typography sx={{ fontWeight: 600 }}>{d.nextAction.actorLabel}</Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Prochaine action
              </Typography>
              <Typography sx={{ fontWeight: 600 }}>{d.nextAction.label}</Typography>
            </Box>
          </Stack>
        </Stack>
      </Section>

      {d.blockages.length > 0 && (
        <BandeVigilance title="Pourquoi ce dossier est bloqué">
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {d.blockages.map((b, i) => (
              <li key={`${b.code}-${i}`}>{b.message}</li>
            ))}
          </Box>
        </BandeVigilance>
      )}

      {showDecision && d.lastDecision && (
        <Alert severity="info" icon={false}>
          {decisionVerb} par {d.lastDecision.byName} le {formatDate(d.lastDecision.at)}
          {d.lastDecision.reason ? ` : ${d.lastDecision.reason}` : ''}
        </Alert>
      )}

      {d.payfitAlert && (
        <Box component="section" sx={{ bgcolor: '#FFFBE0', border: '1px solid #E6D96B', borderRadius: 3, p: 2.5 }}>
          <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
            Alerte PayFit
          </Typography>
          <Typography sx={{ fontWeight: 600 }}>{ALERT_TITLE[d.payfitAlert.kind] ?? d.payfitAlert.kind}</Typography>
          <Typography>
            Observée le {formatDateTime(d.payfitAlert.observedAt)}. {d.payfitAlert.change}
          </Typography>
          <Typography>
            La preuve antérieure est conservée : {formatDateTime(d.payfitAlert.priorProof.observedAt)}, code {d.payfitAlert.priorProof.code}.
          </Typography>
          <Typography sx={{ fontWeight: 600, mt: 1 }}>À arbitrer par la RH.</Typography>
        </Box>
      )}

      {restoration && <Alert severity="success">Absence retrouvée à l'identique dans PayFit le {formatDate(restoration.at)}.</Alert>}

      {(decisionButtons.length > 0 || actions.includes('ATTACH')) && (
        <Stack spacing={1}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
            {decisionButtons.map((kind, i) => (
              <Button key={kind} variant={i === 0 ? 'contained' : 'outlined'} color={kind === 'REJECT' || kind === 'CANCEL' ? 'error' : 'primary'} disabled={sending} onClick={() => onAction(kind)}>
                {ACTION_LABEL[kind]}
              </Button>
            ))}
            {actions.includes('ATTACH') && (
              <Button variant="outlined" onClick={() => setShowUploader((v) => !v)} aria-expanded={showUploader}>
                Ajouter un justificatif
              </Button>
            )}
          </Stack>
          {actions.includes('VALIDATE') && <Typography variant="body2">Valider ne transmet rien à PayFit : la saisie reste une action humaine.</Typography>}
        </Stack>
      )}

      <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, alignItems: 'start' }}>
        <Section title="Dates">
          <Stack spacing={0.5}>
            <Typography>{periodSentence(d)}</Typography>
            <Typography>Type : {d.typeLabel}</Typography>
            <Typography>Code PayFit attendu : {d.payfitCode ?? 'Non configuré'}</Typography>
            <Typography>
              Déclarée le {formatDateTime(d.declaredAt)} par {d.declaredBy}
            </Typography>
            {d.comment && <Typography sx={{ overflowWrap: 'anywhere' }}>Commentaire : {d.comment}</Typography>}
          </Stack>
        </Section>

        <Section title="Pièces">
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              {d.expectedPiece ? `Pièce attendue : ${d.expectedPiece}` : 'Aucun justificatif requis.'}
            </Typography>
            {d.pieces.length === 0 && <Typography>Aucune pièce jointe.</Typography>}
            {d.pieces.map((p) => (
              <Stack key={p.id} direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ overflowWrap: 'anywhere' }}>
                    {p.canOpen ? p.name : 'Pièce privée'} — {formatSize(p.sizeBytes)} {p.confirmed ? '— Confirmée' : '— Non confirmée'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Ajoutée par {p.addedByName}
                    {p.privatePiece ? ' · Pièce privée' : ''}
                  </Typography>
                </Box>
                {p.canOpen ? (
                  <Button variant="outlined" size="small" disabled={opening === p.id} onClick={() => void openPiece(p.id)} aria-label={`Ouvrir ${p.name}`}>
                    Ouvrir
                  </Button>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Réservée à la RH
                  </Typography>
                )}
              </Stack>
            ))}
            {actions.includes('ATTACH') && showUploader && (
              <JustificatifUploader
                title="Justificatif"
                crecheCode={d.crecheCode}
                absenceId={d.id}
                maxPieces={Math.max(0, 5 - d.pieces.length)}
                onConfirmed={() => {
                  notify('Justificatif ajouté.')
                  setShowUploader(false)
                  refresh()
                }}
              />
            )}
          </Stack>
        </Section>
      </Box>

      {d.status === 'DANS_PAYFIT' && d.payfitProof && (
        <Section title="Observation PayFit">
          <Stack spacing={0.5}>
            <Typography>Observée le {formatDateTime(d.payfitProof.observedAt)}</Typography>
            <Typography>Société : {d.payfitProof.company}</Typography>
            <Typography>Code : {d.payfitProof.code}</Typography>
            <Typography>Statut source : {d.payfitProof.sourceStatus}</Typography>
            <Typography variant="body2" color="text.secondary">
              Confirmée automatiquement par rapprochement, jamais manuellement.
            </Typography>
          </Stack>
        </Section>
      )}

      <Section title="Chronologie">
        <Stack component="ol" spacing={1} sx={{ listStyle: 'none', p: 0, m: 0 }}>
          {[...d.timeline]
            .sort((x, y) => (x.at < y.at ? 1 : -1))
            .map((t, i) => (
              <li key={`${t.at}-${i}`}>
                <Typography component="span" color="text.secondary">
                  {formatDateTime(t.at)}
                </Typography>{' '}
                {t.text}
                {t.byName ? ` — ${t.byName}` : ''}
              </li>
            ))}
        </Stack>
      </Section>

      {can('journal:read') && audit.state.status === 'ready' && audit.state.data && (
        <Section title="Audit">
          {audit.state.data.items.length === 0 ? (
            <Typography>Aucune entrée.</Typography>
          ) : (
            <Stack component="ul" spacing={1} sx={{ listStyle: 'none', p: 0, m: 0 }}>
              {audit.state.data.items.map((e) => (
                <li key={e.id}>
                  <Typography component="span" color="text.secondary">
                    {formatDateTimeSeconds(e.occurredAt)}
                  </Typography>{' '}
                  <strong>{e.operationLabel}</strong> — {e.actorName} : {e.summary}
                </li>
              ))}
            </Stack>
          )}
        </Section>
      )}

      <Dialog open={reasonAction !== null} onClose={() => !sending && closeReason()} fullWidth maxWidth="sm" aria-labelledby="motif-title">
        <DialogTitle id="motif-title">{reasonAction ? REASON_TITLE[reasonAction] : ''}</DialogTitle>
        <DialogContent>
          <TextField
            label="Motif administratif"
            required
            multiline
            minRows={3}
            fullWidth
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, MAX_REASON))}
            error={reasonTouched && reason.trim() === ''}
            helperText={reasonTouched && reason.trim() === '' ? 'Le motif est obligatoire.' : `Sans détail médical. ${reason.length}/${MAX_REASON}`}
            sx={{ mt: 1 }}
          />
          {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeReason} disabled={sending}>
            Annuler
          </Button>
          <Button variant="contained" onClick={() => void submitReason()} disabled={sending}>
            Confirmer
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmValidate} onClose={() => !sending && setConfirmValidate(false)} aria-labelledby="valider-title">
        <DialogTitle id="valider-title">Valider ce dossier ?</DialogTitle>
        <DialogContent>
          <Typography>Valider ne transmet rien à PayFit : la saisie reste une action humaine.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmValidate(false)} disabled={sending}>
            Annuler
          </Button>
          <Button variant="contained" onClick={() => void simple('VALIDATE')} disabled={sending}>
            Confirmer
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmEntered} onClose={() => !sending && setConfirmEntered(false)} aria-labelledby="saisie-title">
        <DialogTitle id="saisie-title">Saisie effectuée</DialogTitle>
        <DialogContent>
          <Typography>Confirmer que la saisie a été faite dans PayFit ? Le dossier restera « à vérifier » tant que PayFit n'aura pas apporté de preuve.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmEntered(false)} disabled={sending}>
            Annuler
          </Button>
          <Button variant="contained" onClick={() => void simple('MARK_ENTERED')} disabled={sending}>
            Confirmer
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
