import { useCallback, useEffect, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, Chip, Stack, Typography } from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import { Navigate, useSearchParams } from 'react-router-dom'
import type { components } from '@evpms/api-client'
import { API_URL, api } from '../../../shared/api'
import { EtatAttente } from '../../../shared/components/EtatsEcran'
import { FullScreenLoading } from '../../../shared/FullScreenLoading'
import { safeRedirect } from '../../../shared/safeRedirect'
import { COLORS } from '../../../shared/theme/theme'
import { useTitle } from '../../../shared/useTitle'
import { useSession } from '../hooks/useSession'

type ServiceStatus = components['schemas']['ServiceStatusResponseDto']

type Service = { status: 'loading' } | { status: 'ready' } | { status: 'unavailable'; message: string }

const UNREACHABLE = 'Impossible de joindre le service. Réessayez dans quelques instants.'

/** Messages of the `erreur` parameter: never a technical message (rule-evp-login-single-denial). */
function errorMessage(code: string): string {
  switch (code) {
    case 'domaine':
      return "Ce compte Google n'appartient pas au domaine micro-stars.fr. Choisissez votre compte professionnel."
    case 'non_autorise':
      return "Ce compte n'est pas autorisé à utiliser EVP. Demandez l'ouverture d'un accès à la RH."
    // rule-evp-google-sub-email-mismatch, rule-evp-login-howto-who, rule-evp-login-mismatch-no-address
    case 'adresse_modifiee':
      return "L'adresse de votre compte Google n'est plus celle de votre accès EVP. Demandez à la personne qui gère les accès (la RH, l'administratrice ou, si vous êtes directrice, le superadmin) de mettre à jour l'adresse de votre accès, puis reconnectez-vous."
    // rule-evp-google-sub-recreated
    case 'compte_recree':
      return "Votre compte Google n'est plus celui qui est lié à votre accès EVP : il a sans doute été recréé. Demandez à la personne qui gère les accès (la RH, l'administratrice ou, si vous êtes directrice, le superadmin) de délier votre accès de l'ancien compte Google depuis l'écran Accès, puis reconnectez-vous : votre compte actuel sera alors relié."
    case 'annule':
      return 'La connexion a été annulée.'
    default:
      return 'La connexion a échoué. Veuillez réessayer.'
  }
}

function infoMessage(motif: string | null): string | null {
  if (motif === 'session-expiree') return 'Votre session a expiré. Reconnectez-vous.'
  if (motif === 'acces-retire') return 'Votre accès a été retiré ou désactivé. Contactez la RH.'
  return null
}

/**
 * rule-evp-login-google-only, rule-evp-login-domain-not-enough, rule-evp-login-service-status,
 * rule-evp-login-public-no-hr-data, rule-evp-login-single-denial, rule-evp-login-safe-redirect,
 * rule-evp-login-already-connected, rule-evp-login-no-secret-in-studio, rule-evp-login-unknown-error
 */
export function LoginPage() {
  useTitle('Connexion')
  const { state } = useSession()
  const [params] = useSearchParams()
  const [service, setService] = useState<Service>({ status: 'loading' })
  const [redirecting, setRedirecting] = useState(false)

  const destination = safeRedirect(params.get('redirection'))
  const erreur = params.get('erreur')
  const info = infoMessage(params.get('motif'))

  const readStatus = useCallback(async () => {
    setService({ status: 'loading' })
    try {
      const { data, response } = await api.GET('/service-status')
      if (!response.ok || !data) return setService({ status: 'unavailable', message: UNREACHABLE })
      const body: ServiceStatus = data
      setService(body.status === 'ready' ? { status: 'ready' } : { status: 'unavailable', message: body.message || UNREACHABLE })
    } catch {
      setService({ status: 'unavailable', message: UNREACHABLE })
    }
  }, [])

  useEffect(() => {
    void readStatus()
  }, [readStatus])

  if (state.status === 'loading') return <FullScreenLoading />
  if (state.status === 'authenticated') return <Navigate to={destination} replace />

  const signIn = () => {
    setRedirecting(true)
    window.location.assign(`${API_URL}/google-sign-in/start?redirection=${encodeURIComponent(destination)}`)
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', bgcolor: COLORS.light, p: 2, gap: 2 }}>
      <Card sx={{ width: '100%', maxWidth: 480 }}>
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 3 }}>
          <Typography sx={{ fontFamily: '"Fredoka", sans-serif', fontSize: '1.5rem', fontWeight: 600, color: COLORS.title }}>EVP</Typography>
          <Typography variant="h5" component="h1">
            Préparation et suivi des absences
          </Typography>

          {service.status === 'loading' && <EtatAttente text="Vérification de l'état du service…" />}

          {service.status === 'ready' && (
            <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
              <Chip icon={<CheckCircleIcon />} label="Service prêt" color="success" variant="outlined" />
              <Typography component="h2" variant="h6">
                Le service est prêt
              </Typography>
            </Stack>
          )}

          {service.status === 'unavailable' && (
            <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
              <Chip icon={<ErrorOutlineIcon />} label="Service indisponible" color="warning" variant="outlined" />
              <Typography component="h2" variant="h6">
                Le service est momentanément indisponible
              </Typography>
              <Typography>{service.message}</Typography>
              <Button variant="outlined" onClick={() => void readStatus()}>
                Réessayer
              </Button>
            </Stack>
          )}

          {info && <Alert severity="info" role="status">{info}</Alert>}
          {erreur && <Alert severity="error" role="alert">{errorMessage(erreur)}</Alert>}

          {service.status === 'ready' && (
            <Button variant="contained" onClick={signIn} disabled={redirecting}>
              {redirecting ? 'Redirection vers Google…' : 'Se connecter avec Google'}
            </Button>
          )}

          <Typography variant="body2" color="text.secondary">
            La connexion se fait avec votre compte Google Workspace micro-stars.fr. EVP ne demande aucun mot de passe et n'accède ni à votre messagerie, ni à votre agenda, ni à votre Drive.
          </Typography>
        </CardContent>
      </Card>
      <Box role="note" sx={{ bgcolor: COLORS.vigilance, border: '1px solid #E6D96B', borderRadius: 2, p: 1.25, maxWidth: 480, fontSize: '0.875rem' }}>
        Les écritures dans PayFit sont désactivées.
      </Box>
    </Box>
  )
}
