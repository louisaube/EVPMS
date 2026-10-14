import { useEffect, useState, type ReactNode } from 'react'
import { Badge, Box, Button, Chip, Divider, Link as MuiLink, List, ListItemButton, ListItemIcon, ListItemText, Stack, Tooltip, Typography, useMediaQuery, useTheme } from '@mui/material'
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline'
import ChecklistIcon from '@mui/icons-material/Checklist'
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined'
import DownloadIcon from '@mui/icons-material/Download'
import HistoryIcon from '@mui/icons-material/History'
import LockPersonOutlinedIcon from '@mui/icons-material/LockPersonOutlined'
import LogoutIcon from '@mui/icons-material/Logout'
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import StorefrontOutlinedIcon from '@mui/icons-material/StorefrontOutlined'
import SyncAltIcon from '@mui/icons-material/SyncAlt'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useProfile, type Capability } from '../../features/auth/hooks/useProfile'
import { useSession } from '../../features/auth/hooks/useSession'
import { evpRoleLabel } from '../labels'
import { COLORS } from '../theme/theme'

const SIDEBAR_WIDTH = 264
const PAYFIT_WARNING = 'Les écritures dans PayFit sont désactivées. EVP ne transmet rien à PayFit : la saisie de paie reste une action humaine.'

interface Entry {
  label: string
  to: string
  icon: ReactNode
  capability?: Capability
  exact?: boolean
}

const MAIN: Entry[] = [
  { label: 'À faire', to: '/', icon: <ChecklistIcon />, exact: true },
  { label: 'Les déclarations', to: '/declarations', icon: <DescriptionOutlinedIcon /> },
  { label: 'Nouvelle absence', to: '/declarations/nouvelle', icon: <AddCircleOutlineIcon />, capability: 'absences:create' },
  { label: 'Notifications', to: '/notifications', icon: <NotificationsNoneIcon /> },
  { label: 'Les crèches', to: '/creches', icon: <StorefrontOutlinedIcon /> },
]

const ADMIN: Entry[] = [
  { label: 'Accès', to: '/acces', icon: <LockPersonOutlinedIcon />, capability: 'access:manage:ro' },
  { label: 'Sources', to: '/sources', icon: <SyncAltIcon />, capability: 'sources:read' },
  { label: 'Export paie', to: '/export-paie', icon: <DownloadIcon />, capability: 'export:run' },
  { label: 'Journal', to: '/journal', icon: <HistoryIcon />, capability: 'journal:read' },
]

const SETTINGS: Entry = { label: 'Paramètres', to: '/parametres', icon: <SettingsOutlinedIcon /> }

interface InstallEvent extends Event {
  prompt: () => Promise<void>
}

function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

function useInstallPrompt() {
  const [event, setEvent] = useState<InstallEvent | null>(null)
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setEvent(e as InstallEvent)
    }
    const onInstalled = () => setEvent(null)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])
  return {
    available: event !== null,
    install: async () => {
      if (!event) return
      await event.prompt()
      setEvent(null)
    },
  }
}

/**
 * rule-evp-layout-sidebar, rule-evp-layout-account-visible, rule-evp-layout-payfit-warning, rule-evp-layout-nav-by-capability,
 * rule-evp-foundation-admin-hidden, rule-evp-pwa-installable, rule-evp-pwa-no-offline-data (offline banner, caches emptied at logout)
 */
export function EvpLayout() {
  const theme = useTheme()
  const desktop = useMediaQuery(theme.breakpoints.up('md'))
  const { logout } = useSession()
  const { profile, can, unreadCount } = useProfile()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const online = useOnline()
  const pwa = useInstallPrompt()

  const visible = (entries: Entry[]) => entries.filter((e) => !e.capability || can(e.capability))
  const main = visible(MAIN)
  const admin = visible(ADMIN)

  const isActive = (e: Entry) => {
    if (e.exact) return pathname === e.to
    if (e.to === '/declarations') return pathname === '/declarations' || (pathname.startsWith('/declarations/') && pathname !== '/declarations/nouvelle')
    return pathname === e.to || pathname.startsWith(`${e.to}/`)
  }

  const onLogout = async () => {
    // Precaution: empty any runtime cache of the worker (it only keeps the static shell).
    navigator.serviceWorker?.controller?.postMessage('clear-caches')
    await logout(() => navigate('/connexion', { replace: true }))
  }

  const item = (e: Entry) => {
    const active = isActive(e)
    const badge = e.to === '/notifications' ? unreadCount : 0
    const name = badge > 0 ? `${e.label}, ${badge} non lue${badge > 1 ? 's' : ''}` : e.label
    const badgeText = badge > 99 ? '99+' : String(badge)
    return (
      <ListItemButton
        key={e.to}
        component={Link}
        to={e.to}
        selected={active}
        aria-current={active ? 'page' : undefined}
        aria-label={name}
        sx={{
          borderRadius: 3,
          minHeight: 44,
          minWidth: 44,
          flexShrink: 0,
          color: COLORS.title,
          '&.Mui-selected': { bgcolor: '#fff', fontWeight: 600 },
          ...(desktop ? {} : { width: 'auto', whiteSpace: 'nowrap' }),
        }}
      >
        <ListItemIcon sx={{ minWidth: 36, color: 'inherit' }}>
          {badge > 0 ? (
            <Badge badgeContent={badgeText} color="primary" aria-hidden>
              {e.icon}
            </Badge>
          ) : (
            e.icon
          )}
        </ListItemIcon>
        <ListItemText primary={e.label} slotProps={{ primary: { sx: { fontWeight: active ? 600 : 400 } } }} />
      </ListItemButton>
    )
  }

  const account = (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
      <Tooltip title={profile.email}>
        <Typography noWrap sx={{ fontWeight: 600, minWidth: 0 }}>
          {profile.name}
        </Typography>
      </Tooltip>
      <Chip label={evpRoleLabel(profile.role)} size="small" color="primary" sx={{ flexShrink: 0 }} />
    </Stack>
  )

  const warning = (
    <Box role="note" sx={{ bgcolor: COLORS.vigilance, border: '1px solid #E6D96B', borderRadius: 2, p: 1.25, fontSize: '0.875rem' }}>
      {PAYFIT_WARNING}
    </Box>
  )

  const banners = (
    <>
      {!online && (
        <Box role="alert" sx={{ bgcolor: '#FCE4E8', color: '#8E1B2E', p: 1.5, fontWeight: 600 }}>
          Vous êtes hors ligne. Les données RH ne sont pas disponibles hors ligne.
        </Box>
      )}
      {pwa.available && (
        <Box sx={{ px: 2, py: 1 }}>
          <Button variant="outlined" size="small" onClick={() => void pwa.install()}>
            Installer EVP
          </Button>
        </Box>
      )}
    </>
  )

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: COLORS.light, display: 'flex', flexDirection: { xs: 'column', md: 'row' } }}>
      <MuiLink
        href="#contenu"
        sx={{
          position: 'absolute',
          left: 8,
          top: -80,
          zIndex: 2000,
          bgcolor: '#fff',
          p: 1.5,
          borderRadius: 2,
          '&:focus': { top: 8 },
        }}
      >
        Aller au contenu
      </MuiLink>
      <Box
        component="header"
        sx={{
          flexShrink: 0,
          bgcolor: COLORS.light,
          borderRight: { md: '1px solid #D5DDF5' },
          borderBottom: { xs: '1px solid #D5DDF5', md: 'none' },
          ...(desktop
            ? { width: SIDEBAR_WIDTH, position: 'fixed', top: 0, bottom: 0, left: 0, overflowY: 'auto', p: 2 }
            : { p: 1.5 }),
        }}
      >
        <Stack spacing={desktop ? 2 : 1.25}>
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
            <MuiLink component={Link} to="/" underline="none" aria-label="EVP" sx={{ fontFamily: '"Fredoka", sans-serif', fontSize: '1.75rem', fontWeight: 600, color: COLORS.title }}>
              EVP
            </MuiLink>
            {!desktop && (
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
                {account}
                <Button onClick={onLogout} aria-label="Se déconnecter" sx={{ minWidth: 44, px: 1 }}>
                  <LogoutIcon />
                </Button>
              </Stack>
            )}
          </Stack>
          {desktop && warning}
          {desktop && account}
          <Box
            component="nav"
            aria-label="Navigation principale"
            sx={desktop ? undefined : { overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}
          >
            <List disablePadding sx={desktop ? { display: 'flex', flexDirection: 'column', gap: 0.5 } : { display: 'flex', flexDirection: 'row', gap: 0.5 }}>
              {main.map(item)}
              {admin.length > 0 && (
                <>
                  {desktop ? (
                    <>
                      <Divider sx={{ my: 1 }} />
                      <Typography variant="overline" sx={{ px: 2, color: COLORS.title }}>
                        Administration
                      </Typography>
                    </>
                  ) : (
                    <Typography variant="overline" sx={{ alignSelf: 'center', px: 1, color: COLORS.title, whiteSpace: 'nowrap' }}>
                      Administration
                    </Typography>
                  )}
                  {admin.map(item)}
                </>
              )}
              {desktop && <Divider sx={{ my: 1 }} />}
              {item(SETTINGS)}
            </List>
          </Box>
          {!desktop && warning}
          {desktop && (
            <Button onClick={onLogout} startIcon={<LogoutIcon />} sx={{ justifyContent: 'flex-start' }}>
              Se déconnecter
            </Button>
          )}
        </Stack>
      </Box>
      <Box sx={{ flexGrow: 1, minWidth: 0, ml: { md: `${SIDEBAR_WIDTH}px` } }}>
        {banners}
        <Box component="main" id="contenu" tabIndex={-1} sx={{ maxWidth: 1200, mx: 'auto', p: { xs: 2, md: 3 } }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  )
}
