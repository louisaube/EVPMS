import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Alert, Autocomplete, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel, FormLabel, MenuItem, Radio, RadioGroup, Stack, TextField, Typography } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import type { components } from '@evpms/api-client'
import { api } from '../../../shared/api'
import { EtatAttente, EtatErreur } from '../../../shared/components/EtatsEcran'
import { JustificatifUploader, type ConfirmedPiece } from '../../../shared/components/JustificatifUploader'
import { PageHeader } from '../../../shared/components/PageHeader'
import { MESSAGE_END_BEFORE_START, formatDate, halfLabel, todayParis } from '../../../shared/format'
import { TYPE_LABELS } from '../../../shared/labels'
import { useNotify } from '../../../shared/notify'
import { MESSAGE_FORBIDDEN, MESSAGE_INVALID, failureMessage, useCall } from '../../../shared/useCall'
import { useLoad } from '../../../shared/useLoad'
import { useTitle } from '../../../shared/useTitle'
import { useCreches } from '../../creches/hooks/useCreches'

type Contract = components['schemas']['CrecheContractDto']
type Half = 'MATIN' | 'APRES_MIDI'
type TypeCode = components['schemas']['AbsenceCreateParamsDto']['typeCode']

const REQUIRED = 'Ce champ est obligatoire.'
const MAX_COMMENT = 500

function contractText(c: Contract): string {
  const end = c.endDate ? formatDate(c.endDate) : null
  return `${c.employeeName} — contrat du ${formatDate(c.startDate)} ${end ? `au ${end}` : 'en cours'}`
}

function createErrorMessage(status: number, code?: string): string {
  if (status === 400) return MESSAGE_INVALID
  if (status === 403) return MESSAGE_FORBIDDEN
  if (code === 'absences.contract_not_found') return "Ce contrat n'existe plus pour cette crèche. Rechargez la liste."
  if (code === 'absences.creche_contract_mismatch') return "Ce contrat n'appartient pas à la crèche choisie."
  if (code === 'absences.piece_not_attachable') return "Un justificatif n'est plus utilisable. Retirez-le et déposez-le à nouveau."
  return failureMessage({ status, code })
}

function useContractOptions(crecheCode: string, query: string) {
  const call = useCall()
  const [state, setState] = useState<{ loading: boolean; items: Contract[]; failed: boolean; restricted: boolean }>({ loading: false, items: [], failed: false, restricted: false })
  const search = query.trim().length >= 3 ? query.trim() : ''
  useEffect(() => {
    if (!crecheCode) return setState({ loading: false, items: [], failed: false, restricted: false })
    let current = true
    setState((s) => ({ ...s, loading: true }))
    const timer = setTimeout(
      () => {
        void call(() => api.GET('/creches/{code}/contracts', { params: { path: { code: crecheCode }, query: { ...(search ? { search } : {}), size: 20 } } })).then((outcome) => {
          if (!current) return
          setState(outcome.ok ? { loading: false, items: outcome.data.items, failed: false, restricted: outcome.data.planningRestricted } : { loading: false, items: [], failed: true, restricted: false })
        })
      },
      search ? 300 : 0,
    )
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [call, crecheCode, search])
  return { ...state, search }
}

/**
 * rule-evp-declare-steps, rule-evp-declare-roles, rule-evp-declare-result-status, rule-evp-declare-duplicate,
 * rule-evp-declare-no-medical-detail, rule-evp-declare-employee-key, rule-evp-declare-half-day-order,
 * rule-evp-declare-types-defaults, rule-evp-declare-max-pieces, rule-evp-declare-validation-local,
 * rule-evp-declare-contracts-not-archived, rule-evp-siret-shared-contracts (the API filters; the studio reads items and planningRestricted)
 */
export function NouvelleAbsencePage() {
  useTitle('Nouvelle absence')
  const call = useCall()
  const notify = useNotify()
  const navigate = useNavigate()
  const creches = useCreches()
  const types = useLoad(() => call(() => api.GET('/absence-types')), [call])

  const [crecheCode, setCrecheCode] = useState('')
  const [contract, setContract] = useState<Contract | null>(null)
  // Text shown in the field (the chosen contract once selected) and text typed to search: they differ after a selection.
  const [contractInput, setContractInput] = useState('')
  const [contractQuery, setContractQuery] = useState('')
  const [typeCode, setTypeCode] = useState<TypeCode | ''>('')
  const [startDate, setStartDate] = useState('')
  const [startHalf, setStartHalf] = useState<Half>('MATIN')
  const [endDate, setEndDate] = useState('')
  const [endHalf, setEndHalf] = useState<Half>('APRES_MIDI')
  const [pieces, setPieces] = useState<ConfirmedPiece[]>([])
  const [comment, setComment] = useState('')
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const [pendingCreche, setPendingCreche] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)

  const crecheItems = creches.state.status === 'ready' ? creches.state.data.items : []
  // Single crèche of the perimeter: chosen for the user.
  useEffect(() => {
    if (creches.state.status === 'ready' && creches.state.data.items.length === 1) setCrecheCode(creches.state.data.items[0].code)
  }, [creches.state])

  const options = useContractOptions(crecheCode, contractQuery)
  const type = types.state.status === 'ready' ? types.state.data.items.find((t) => t.code === typeCode) : undefined
  const needsPiece = Boolean(type?.expectedPiece)
  const dirty = (crecheItems.length > 1 && crecheCode !== '') || contract !== null || typeCode !== '' || startDate !== '' || endDate !== '' || comment !== '' || pieces.length > 0

  const sameDayOrderBroken = startDate !== '' && startDate === endDate && startHalf === 'APRES_MIDI' && endHalf === 'MATIN'
  const periodBroken = startDate !== '' && endDate !== '' && endDate < startDate
  const isFuture = startDate !== '' && startDate > todayParis()

  const summary = useMemo(
    () => (startDate && endDate ? `Du ${formatDate(startDate)} (${halfLabel(startHalf)}) au ${formatDate(endDate)} (${halfLabel(endHalf)})` : ''),
    [startDate, startHalf, endDate, endHalf],
  )

  const requiredError = (empty: boolean) => (touched && empty ? REQUIRED : undefined)

  const changeCreche = (code: string) => {
    if (code === crecheCode) return
    if (pieces.length > 0) return setPendingCreche(code)
    applyCreche(code)
  }
  const applyCreche = (code: string) => {
    setCrecheCode(code)
    setContract(null)
    setContractInput('')
    setContractQuery('')
    setPieces([])
    setPendingCreche(null)
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting || uploading) return
    setTouched(true)
    setError(null)
    if (!crecheCode || !contract || !typeCode || !startDate || !endDate || periodBroken || sameDayOrderBroken) return
    setSubmitting(true)
    const outcome = await call(() =>
      api.POST('/absences', {
        body: {
          crecheCode,
          contractId: contract.contractId,
          typeCode,
          startDate,
          startHalf,
          endDate,
          endHalf,
          ...(comment.trim() ? { comment: comment.trim() } : {}),
          // Pieces dropped for a type that expected one stay out of the dossier once the chosen type asks for none.
          ...(needsPiece && pieces.length > 0 ? { justificatifIds: pieces.map((p) => p.id) } : {}),
        },
      }),
    )
    if (!outcome.ok) {
      setSubmitting(false)
      return setError(createErrorMessage(outcome.failure.status, outcome.failure.code))
    }
    const data = outcome.data
    if ('duplicate' in data && data.duplicate) {
      notify('Cette absence existe déjà : voici le dossier.')
      return navigate(`/declarations/${data.absence.id}`)
    }
    const created = data as components['schemas']['AbsenceDetailDto']
    const state =
      created.status === 'ANTICIPEE'
        ? 'Le dossier est « Anticipée ».'
        : created.status === 'A_COMPLETER'
          ? 'Le dossier est « À compléter » : voir les motifs.'
          : 'Le dossier est « À valider ».'
    notify(`Absence enregistrée. ${state}`)
    navigate(`/declarations/${created.id}`)
  }

  const cancel = () => (dirty ? setLeaving(true) : navigate('/declarations'))

  if (creches.state.status === 'loading' || types.state.status === 'loading') {
    return (
      <>
        <PageHeader title="Nouvelle absence" />
        <EtatAttente />
      </>
    )
  }
  if (creches.state.status === 'error') return <EtatErreur failure={creches.state.failure} onRetry={creches.reload} />
  if (types.state.status === 'error') return <EtatErreur failure={types.state.failure} onRetry={types.reload} />

  return (
    <>
      <PageHeader title="Nouvelle absence" />
      <Card>
        <CardContent>
          <Stack component="form" spacing={3} onSubmit={onSubmit} noValidate sx={{ maxWidth: 720 }}>
            <TextField select label="Crèche" required value={crecheCode} onChange={(e) => changeCreche(e.target.value)} error={touched && !crecheCode} helperText={requiredError(!crecheCode)}>
              {crecheItems.map((c) => (
                <MenuItem key={c.code} value={c.code}>
                  {c.name}
                </MenuItem>
              ))}
            </TextField>

            <Autocomplete
              options={options.items}
              value={contract}
              onChange={(_, value) => setContract(value)}
              inputValue={contractInput}
              onInputChange={(_, value, reason) => {
                setContractInput(value)
                if (reason === 'input') setContractQuery(value)
                else if (value === '') setContractQuery('')
              }}
              disabled={!crecheCode}
              loading={options.loading}
              filterOptions={(o) => o}
              getOptionLabel={contractText}
              getOptionKey={(o) => o.contractId}
              isOptionEqualToValue={(a, b) => a.contractId === b.contractId}
              noOptionsText={options.failed ? 'Une erreur est survenue. Veuillez réessayer.' : options.search ? 'Aucun contrat ne correspond à cette recherche.' : options.restricted ? "Aucun contrat actif ou à venir à proposer pour cette crèche. Elle partage son SIRET : les salariées vues au planning Aqoona d'une autre crèche du même SIRET ne lui sont pas proposées." : 'Aucun contrat actif ou à venir importé pour cette crèche. Demandez une lecture PayFit à la RH.'}
              loadingText="Chargement…"
              renderOption={(props, o) => (
                <li {...props} key={o.contractId}>
                  <Stack>
                    <Typography>{contractText(o)}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Contrat PayFit : {o.payfitContractId}
                    </Typography>
                  </Stack>
                </li>
              )}
              renderInput={(params) => (
                <TextField {...params} label="Salariée et contrat" required error={touched && !contract} helperText={requiredError(!contract) ?? 'Seuls les contrats actifs et à venir importés de PayFit sont proposés.'} />
              )}
            />

            <Stack spacing={0.5}>
              <TextField select label="Type d'absence" required value={typeCode} onChange={(e) => setTypeCode(e.target.value as TypeCode)} error={touched && !typeCode} helperText={requiredError(!typeCode)}>
                {types.state.data.items.map((t) => (
                  <MenuItem key={t.code} value={t.code}>
                    {t.label || TYPE_LABELS[t.code] || t.code}
                  </MenuItem>
                ))}
              </TextField>
              {type && (
                <Typography variant="body2" color="text.secondary">
                  {type.expectedPiece ? `Pièce attendue : ${type.expectedPiece}${type.privatePiece ? ' (pièce privée)' : ''}` : 'Aucun justificatif requis.'}
                  {type.hrReview ? ' · Examen RH' : ''}
                </Typography>
              )}
            </Stack>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Date de début" type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} error={touched && !startDate} helperText={requiredError(!startDate)} />
              <FormControl>
                <FormLabel id="debut-moitie">Début :</FormLabel>
                <RadioGroup row aria-labelledby="debut-moitie" value={startHalf} onChange={(e) => setStartHalf(e.target.value as Half)}>
                  <FormControlLabel value="MATIN" control={<Radio />} label="Matin" />
                  <FormControlLabel value="APRES_MIDI" control={<Radio />} label="Après-midi" />
                </RadioGroup>
              </FormControl>
            </Stack>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Date de fin"
                type="date"
                required
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: startDate || undefined } }}
                error={(touched && !endDate) || periodBroken}
                helperText={periodBroken ? MESSAGE_END_BEFORE_START : requiredError(!endDate)}
              />
              <FormControl error={sameDayOrderBroken}>
                <FormLabel id="fin-moitie">Fin :</FormLabel>
                <RadioGroup row aria-labelledby="fin-moitie" value={endHalf} onChange={(e) => setEndHalf(e.target.value as Half)}>
                  <FormControlLabel value="MATIN" control={<Radio />} label="Matin" />
                  <FormControlLabel value="APRES_MIDI" control={<Radio />} label="Après-midi" />
                </RadioGroup>
                {sameDayOrderBroken && <Typography variant="body2" color="error">La fin ne peut pas précéder le début le même jour.</Typography>}
              </FormControl>
            </Stack>

            <Typography aria-live="polite" sx={{ minHeight: '1.6em' }}>
              {summary}
            </Typography>
            {isFuture && <Alert severity="info">Cette absence débute dans le futur : elle sera enregistrée comme « Anticipée ».</Alert>}

            {needsPiece && (
              <JustificatifUploader
                title="Justificatif"
                crecheCode={crecheCode || undefined}
                pieces={pieces}
                disabled={!crecheCode || submitting}
                onConfirmed={(p) => setPieces((prev) => [...prev, p])}
                onRemove={(id) => setPieces((prev) => prev.filter((p) => p.id !== id))}
                onBusyChange={setUploading}
              />
            )}

            <TextField
              label="Commentaire administratif (facultatif)"
              multiline
              minRows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value.slice(0, MAX_COMMENT))}
              helperText={`N'indiquez aucun détail médical (diagnostic, symptômes, pathologie). ${comment.length}/${MAX_COMMENT}`}
              slotProps={{ htmlInput: { maxLength: MAX_COMMENT } }}
            />

            {error && <Alert severity="error" role="alert">{error}</Alert>}

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <Button type="submit" variant="contained" disabled={submitting || uploading}>
                {submitting ? 'Enregistrement en cours…' : 'Enregistrer'}
              </Button>
              <Button onClick={cancel} disabled={submitting}>
                Annuler
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Dialog open={pendingCreche !== null} onClose={() => setPendingCreche(null)} aria-labelledby="creche-change-title">
        <DialogTitle id="creche-change-title">Changer de crèche ?</DialogTitle>
        <DialogContent>
          <Typography>Les justificatifs déposés pour la crèche actuelle seront retirés du formulaire.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingCreche(null)}>Annuler</Button>
          <Button variant="contained" onClick={() => pendingCreche !== null && applyCreche(pendingCreche)}>
            Changer de crèche
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={leaving} onClose={() => setLeaving(false)} aria-labelledby="leave-title">
        <DialogTitle id="leave-title">Abandonner la saisie ?</DialogTitle>
        <DialogActions>
          <Button onClick={() => setLeaving(false)}>Continuer la saisie</Button>
          <Button variant="contained" onClick={() => navigate('/declarations')}>
            Abandonner
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
