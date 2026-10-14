import { useRef, useState, type SyntheticEvent } from 'react'
import { Alert, Box, Checkbox, Chip, FormControl, FormControlLabel, FormHelperText, InputLabel, ListItemText, MenuItem, Select, Switch, TextField, Typography } from '@mui/material'
import type { components } from '@evpms/api-client'
import { api } from '../../../shared/api'
import { FormDialog } from '../../../shared/components/FormDialog'
import { MESSAGE_FORBIDDEN, MESSAGE_INVALID, failureMessage, useCall } from '../../../shared/useCall'
import { useProfile } from '../../auth/hooks/useProfile'
import type { Creche } from '../../creches/hooks/useCreches'

export type AccessAccount = components['schemas']['AccessAccountDto']
type Role = AccessAccount['role']

const DOMAIN = '@micro-stars.fr'
const OWN_ROLE = 'Vous ne pouvez pas modifier votre propre rôle.'

interface Props {
  account?: AccessAccount
  creches: Creche[]
  onClose: () => void
  onSaved: () => void
}

type FieldError = { field: 'email' | 'name' | 'creches' | 'form'; message: string }

function mapFailure(status: number, code?: string): FieldError {
  switch (code) {
    case 'access.email_already_exists':
      return { field: 'email', message: 'Cette adresse est déjà utilisée.' }
    case 'access.invalid_domain':
      return { field: 'email', message: "L'adresse doit appartenir au domaine micro-stars.fr." }
    case 'access.creche_required':
      return { field: 'creches', message: 'Un compte actif doit avoir au moins une crèche.' }
    case 'access.creche_not_verified':
      return { field: 'creches', message: "Une des crèches n'est pas vérifiée par le tableau source." }
    case 'access.directrice_source_mismatch':
      return { field: 'form', message: 'Cette directrice ne correspond pas au tableau source des crèches.' }
    case 'access.privileged_account':
      return { field: 'form', message: "Ce compte est privilégié : il ne se gère pas depuis cet écran." }
    case 'access.role_not_manageable':
      return { field: 'form', message: 'Votre rôle ne permet pas de gérer ce type d’accès.' }
    case 'access.not_found':
      return { field: 'form', message: "Cet accès n'existe plus." }
    case 'access.cannot_change_own_role':
      return { field: 'form', message: OWN_ROLE }
  }
  if (status === 400) return { field: 'form', message: MESSAGE_INVALID }
  if (status === 403) return { field: 'form', message: MESSAGE_FORBIDDEN }
  return { field: 'form', message: failureMessage({ status, code }) }
}

/**
 * rule-evp-access-admin, rule-evp-access-active-needs-creche, rule-evp-access-directrice-source, rule-evp-access-no-self-role,
 * rule-evp-access-no-privileged, rule-evp-access-domain, rule-evp-access-no-password, rule-evp-access-address-edit,
 * rule-evp-access-unlink-who
 */
export function AccessDialog({ account, creches, onClose, onSaved }: Props) {
  const call = useCall()
  const { profile, can } = useProfile()
  const editing = account !== undefined
  const isSelf = account !== undefined && account.id === profile.id
  const verified = creches.filter((c) => c.verified)

  const [email, setEmail] = useState(account?.email ?? '')
  const [name, setName] = useState(account?.name ?? '')
  const [role, setRole] = useState<Role>(account?.role ?? 'RO')
  const [active, setActive] = useState(account?.active ?? true)
  const [codes, setCodes] = useState<string[]>(account?.creches.map((c) => c.code) ?? [])
  const [attempted, setAttempted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<FieldError | null>(null)
  const menuClosedAt = useRef(0)
  const menuClosed = (event: SyntheticEvent) => {
    if (event.type !== 'keydown') menuClosedAt.current = Date.now()
  }

  const trimmedEmail = email.trim()
  const trimmedName = name.trim()
  // rule-evp-access-address-edit: an unchanged address is not re-checked, so that an access whose stored address predates the
  // domain check can still have its name, status or crèches edited; only a new address is validated.
  const emailChanged = account !== undefined && trimmedEmail.toLowerCase() !== account.email.toLowerCase()
  const emailError =
    editing && !emailChanged
      ? null
      : trimmedEmail === ''
      ? "L'adresse Workspace est obligatoire."
      : trimmedEmail.length > 254
        ? "L'adresse ne doit pas dépasser 254 caractères."
        : !trimmedEmail.toLowerCase().endsWith(DOMAIN) || trimmedEmail.length === DOMAIN.length
          ? "L'adresse doit appartenir au domaine micro-stars.fr."
          : null
  const nameError = trimmedName === '' ? 'Le nom est obligatoire.' : trimmedName.length > 120 ? 'Le nom ne doit pas dépasser 120 caractères.' : null
  const crecheError = active && codes.length === 0 ? 'Un compte actif doit avoir au moins une crèche.' : null

  const nameOfCreche = (code: string) => creches.find((c) => c.code === code)?.name ?? account?.creches.find((c) => c.code === code)?.name ?? code
  const options = verified
  // A crèche already assigned stays selectable even if it is no longer verified.
  const extra = (account?.creches ?? []).filter((c) => !verified.some((v) => v.code === c.code))

  const submit = async () => {
    setAttempted(true)
    setServerError(null)
    if (emailError || nameError || crecheError) return
    setSubmitting(true)
    // rule-evp-access-address-edit: `email` is only sent when the value changed.
    const outcome = account
      ? await call(() =>
          api.PATCH('/access-accounts/{id}', {
            params: { path: { id: account.id } },
            body: { ...(emailChanged ? { email: trimmedEmail } : {}), name: trimmedName, ...(isSelf ? {} : { role }), active, crecheCodes: codes },
          }),
        )
      : await call(() => api.POST('/access-accounts', { body: { email: trimmedEmail, name: trimmedName, role, active, crecheCodes: codes } }))
    setSubmitting(false)
    if (outcome.ok) return onSaved()
    if (outcome.failure.status === 401) return
    setServerError(mapFailure(outcome.failure.status, outcome.failure.code))
  }

  const showEmail = attempted || serverError?.field === 'email'
  const emailMessage = serverError?.field === 'email' ? serverError.message : showEmail ? emailError : null
  const nameMessage = attempted ? nameError : null
  const crecheMessage = serverError?.field === 'creches' ? serverError.message : attempted ? crecheError : null

  return (
    <FormDialog
      title={editing ? "Modifier l'accès" : 'Nouvel accès'}
      submitting={submitting}
      onClose={onClose}
      ignoreEscape={() => Date.now() - menuClosedAt.current < 1000}
      onSubmit={submit}
    >
      {serverError?.field === 'form' && <Alert severity="error" role="alert">{serverError.message}</Alert>}
      <TextField
        label="Adresse Workspace"
        type="email"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value)
          if (serverError?.field === 'email') setServerError(null)
        }}
        autoFocus={!editing}
        error={Boolean(emailMessage)}
        helperText={emailMessage ?? (editing ? "Modifiez l'adresse si l'adresse du compte Google de la personne a changé. Son accès et sa liaison Google sont conservés." : undefined)}
        slotProps={{ htmlInput: { maxLength: 254, autoComplete: 'off' } }}
      />
      <TextField
        label="Nom"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={Boolean(nameMessage)}
        helperText={nameMessage ?? undefined}
        slotProps={{ htmlInput: { maxLength: 120 } }}
      />
      <FormControl disabled={isSelf}>
        <InputLabel id="access-role-label">Rôle</InputLabel>
        <Select labelId="access-role-label" label="Rôle" value={role} onChange={(e) => setRole(e.target.value as Role)} onClose={menuClosed}>
          <MenuItem value="RO">RO</MenuItem>
          {(can('access:manage:directrice') || role === 'DIRECTRICE') && <MenuItem value="DIRECTRICE" disabled={!can('access:manage:directrice')}>Directrice</MenuItem>}
        </Select>
        {isSelf && <FormHelperText>{OWN_ROLE}</FormHelperText>}
        {role === 'DIRECTRICE' && <FormHelperText>Une directrice doit correspondre au tableau source des crèches.</FormHelperText>}
      </FormControl>
      <FormControlLabel control={<Switch checked={active} onChange={(e) => setActive(e.target.checked)} />} label="Actif" />
      <FormControl error={Boolean(crecheMessage)}>
        <InputLabel id="access-creches-label">Crèches</InputLabel>
        <Select
          labelId="access-creches-label"
          label="Crèches"
          multiple
          value={codes}
          onChange={(e) => setCodes(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)}
          onClose={menuClosed}
          renderValue={(selected) => (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {selected.map((c) => (
                <Chip key={c} label={nameOfCreche(c)} size="small" />
              ))}
            </Box>
          )}
        >
          {[...options, ...extra.map((c) => ({ ...c, siret: '', directriceName: null, roNames: [], verified: false }))].map((c) => (
            <MenuItem key={c.code} value={c.code}>
              <Checkbox checked={codes.includes(c.code)} />
              <ListItemText primary={c.name} />
            </MenuItem>
          ))}
        </Select>
        <FormHelperText>{crecheMessage ?? "Un compte actif a au moins une crèche. Seules les crèches vérifiées par le tableau « Contacts des crèches » sont proposées."}</FormHelperText>
      </FormControl>
      <Typography variant="body2" color="text.secondary">
        Chaque modification est tracée au journal.
      </Typography>
    </FormDialog>
  )
}
