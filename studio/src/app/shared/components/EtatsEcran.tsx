import type { ReactNode } from 'react'
import { Alert, Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material'
import { Link } from 'react-router-dom'
import { COLORS } from '../theme/theme'
import { failureMessage, type Failure } from '../useCall'

/** rule-evp-layout-six-states: attente */
export function EtatAttente({ text = 'Chargement…' }: { text?: string }) {
  return (
    <Box role="status" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, p: 4 }}>
      <CircularProgress aria-hidden size={28} />
      <Typography>{text}</Typography>
    </Box>
  )
}

/** rule-evp-layout-six-states: vide */
export function EtatVide({ children }: { children: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
        {children}
      </Stack>
    </Paper>
  )
}

/** rule-evp-layout-six-states: erreur, rule-foundation-api-failure-handling */
export function EtatErreur({ failure, onRetry, message }: { failure?: Failure; onRetry?: () => void; message?: string }) {
  return (
    <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
      <Alert severity="error" sx={{ alignSelf: 'stretch' }}>
        {message ?? failureMessage(failure ?? { status: 0 }, false)}
      </Alert>
      {onRetry && (
        <Button variant="outlined" onClick={onRetry}>
          Réessayer
        </Button>
      )}
    </Stack>
  )
}

/** rule-evp-layout-six-states: interdit */
export function EtatInterdit() {
  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
        <Typography variant="h4" component="h1">
          Accès refusé
        </Typography>
        <Typography>Vous n'avez pas les droits nécessaires pour consulter cette page.</Typography>
        <Button component={Link} to="/" variant="contained">
          Retour à l'accueil
        </Button>
      </Stack>
    </Paper>
  )
}

/** rule-evp-layout-six-states: blocage métier */
export function BandeVigilance({ title, children, role = 'status' }: { title?: string; children: ReactNode; role?: 'status' | 'note' }) {
  return (
    <Box role={role} sx={{ bgcolor: COLORS.vigilance, border: '1px solid #E6D96B', borderRadius: 2, p: 2 }}>
      {title && (
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600, mb: 0.5 }}>
          {title}
        </Typography>
      )}
      {children}
    </Box>
  )
}
