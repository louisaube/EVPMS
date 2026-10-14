import { Alert, Box, Button, Checkbox, FormControl, IconButton, InputLabel, ListItemText, MenuItem, Select, Stack, TextField, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../../../shared/api'
import { EtatAttente, EtatErreur, EtatVide } from '../../../shared/components/EtatsEcran'
import { PageHeader } from '../../../shared/components/PageHeader'
import { STATUT_ORDER, statutLabel, type StatutCode } from '../../../shared/components/StatutAbsence'
import { MESSAGE_END_BEFORE_START, monthLabel } from '../../../shared/format'
import { useCall } from '../../../shared/useCall'
import { SKIPPED, orNull, useLoad } from '../../../shared/useLoad'
import { useTitle } from '../../../shared/useTitle'
import { useProfile } from '../../auth/hooks/useProfile'
import { useCreches } from '../../creches/hooks/useCreches'
import { AbsenceList, ListCount } from '../components/AbsenceList'

const STATE_OPTIONS = STATUT_ORDER.map((code) => ({
  code,
  label: code === 'A_SAISIR' ? 'Validée, à saisir dans PayFit' : statutLabel(code),
}))

function FilterPill({ label, removeName, onRemove }: { label: string; removeName: string; onRemove: () => void }) {
  return (
    <Stack direction="row" sx={{ alignItems: 'center', bgcolor: '#fff', border: '1px solid #C5D1F5', borderRadius: 6, pl: 1.5 }}>
      <Typography variant="body2">{label}</Typography>
      <IconButton size="small" aria-label={`Retirer le filtre ${removeName}`} onClick={onRemove}>
        <CloseIcon fontSize="small" />
      </IconButton>
    </Stack>
  )
}

/**
 * rule-evp-list-filters, rule-evp-list-max-200, rule-evp-list-create-by-role, rule-evp-list-scope,
 * rule-evp-list-status-labelled, rule-evp-list-url-state, rule-evp-list-empty, rule-evp-list-employee-key
 */
export function DeclarationsPage() {
  useTitle('Les déclarations')
  const call = useCall()
  const { can } = useProfile()
  const [params, setParams] = useSearchParams()
  const creches = useCreches()

  const etats = params.getAll('etat').filter((e): e is StatutCode => (STATUT_ORDER as string[]).includes(e))
  // A malformed value of a hand-edited link is ignored rather than sent to the API (400).
  const only = (value: string | null, pattern: RegExp) => (value && pattern.test(value) ? value : '')
  const du = only(params.get('du'), /^\d{4}-\d{2}-\d{2}$/)
  const au = only(params.get('au'), /^\d{4}-\d{2}-\d{2}$/)
  const creche = only(params.get('creche'), /^[a-z0-9][a-z0-9_-]{0,49}$/)
  const mois = only(params.get('mois'), /^\d{4}-(0[1-9]|1[0-2])$/)
  const ouvertes = params.get('ouvertes') === '1'
  const periodInvalid = du !== '' && au !== '' && au < du

  const hasFilters = etats.length > 0 || du !== '' || au !== '' || creche !== '' || mois !== '' || ouvertes

  const update = (mutate: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(params)
    mutate(next)
    setParams(next, { replace: true })
  }
  const setOrDelete = (next: URLSearchParams, key: string, value: string) => (value ? next.set(key, value) : next.delete(key))

  const { state, reload } = useLoad(
    async () => {
      if (periodInvalid) return SKIPPED
      const outcome = await call(() =>
        api.GET('/absences', {
          params: {
            query: {
              ...(etats.length > 0 ? { status: etats } : {}),
              ...(du ? { from: du } : {}),
              ...(au ? { to: au } : {}),
              ...(creche ? { crecheCode: creche } : {}),
              ...(mois ? { payrollMonth: mois } : {}),
              ...(ouvertes ? { open: 'true' as const } : {}),
            },
          },
        }),
      )
      return orNull(outcome)
    },
    [call, etats.join(','), du, au, creche, mois, ouvertes, periodInvalid],
  )

  const clear = () => setParams(new URLSearchParams(), { replace: true })
  const multiCreche = creches.state.status === 'ready' && creches.state.data.items.length > 1

  return (
    <>
      <PageHeader title="Les déclarations">
        {can('absences:create') && (
          <Button component={Link} to="/declarations/nouvelle" variant="contained">
            Nouvelle absence
          </Button>
        )}
      </PageHeader>

      <Stack spacing={2} sx={{ mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: { md: 'flex-start' } }}>
          <FormControl sx={{ minWidth: 260 }}>
            <InputLabel id="filtre-etat">État</InputLabel>
            <Select
              labelId="filtre-etat"
              label="État"
              multiple
              value={etats}
              onChange={(e) => {
                const value = e.target.value
                const list = typeof value === 'string' ? value.split(',') : value
                update((next) => {
                  next.delete('etat')
                  list.forEach((v) => next.append('etat', v))
                })
              }}
              renderValue={(selected) => (selected.length === 0 ? 'Tous' : selected.map((s) => STATE_OPTIONS.find((o) => o.code === s)?.label ?? s).join(', '))}
              displayEmpty
            >
              {STATE_OPTIONS.map((o) => (
                <MenuItem key={o.code} value={o.code}>
                  <Checkbox checked={etats.includes(o.code)} />
                  <ListItemText primary={o.label} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            label="Du"
            type="date"
            value={du}
            onChange={(e) => update((n) => setOrDelete(n, 'du', e.target.value))}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            label="Au"
            type="date"
            value={au}
            onChange={(e) => update((n) => setOrDelete(n, 'au', e.target.value))}
            slotProps={{ inputLabel: { shrink: true } }}
            error={periodInvalid}
            helperText={periodInvalid ? MESSAGE_END_BEFORE_START : undefined}
          />
          {multiCreche && creches.state.status === 'ready' && (
            <TextField select label="Crèche" value={creche} onChange={(e) => update((n) => setOrDelete(n, 'creche', e.target.value))} sx={{ minWidth: 220 }}>
              <MenuItem value="">Toutes les crèches</MenuItem>
              {creches.state.data.items.map((c) => (
                <MenuItem key={c.code} value={c.code}>
                  {c.name}
                </MenuItem>
              ))}
            </TextField>
          )}
          <Button variant="outlined" onClick={clear} disabled={!hasFilters}>
            Effacer les filtres
          </Button>
        </Stack>
        {(mois || ouvertes) && (
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            {mois && <FilterPill label={`Mois de paie : ${monthLabel(mois)}`} removeName="Mois de paie" onRemove={() => update((n) => n.delete('mois'))} />}
            {ouvertes && <FilterPill label="Dossiers ouverts seulement" removeName="Dossiers ouverts seulement" onRemove={() => update((n) => n.delete('ouvertes'))} />}
          </Stack>
        )}
      </Stack>

      {state.status === 'loading' && <EtatAttente />}
      {state.status === 'error' && <EtatErreur failure={state.failure} onRetry={reload} />}
      {state.status === 'ready' && state.data === null && <Alert severity="warning">{MESSAGE_END_BEFORE_START}</Alert>}
      {state.status === 'ready' && state.data !== null && (
        <Stack spacing={2}>
          <ListCount count={state.data.items.length} />
          {state.data.items.length === 0 ? (
            <EtatVide>
              <Typography>{hasFilters ? 'Aucune déclaration ne correspond à ces filtres.' : 'Aucune déclaration pour le moment.'}</Typography>
              {hasFilters ? (
                <Button variant="outlined" onClick={clear}>
                  Effacer les filtres
                </Button>
              ) : (
                can('absences:create') && (
                  <Button component={Link} to="/declarations/nouvelle" variant="contained">
                    Nouvelle absence
                  </Button>
                )
              )}
            </EtatVide>
          ) : (
            <AbsenceList items={state.data.items} />
          )}
          {state.data.truncated && <Box role="note">Les 200 dossiers les plus récents sont affichés. Affinez les filtres pour voir les autres.</Box>}
        </Stack>
      )}
    </>
  )
}
