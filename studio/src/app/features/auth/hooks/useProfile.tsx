import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { components } from '@evpms/api-client'
import { api } from '../../../shared/api'
import { FullScreenLoading } from '../../../shared/FullScreenLoading'
import { EtatErreur } from '../../../shared/components/EtatsEcran'
import { useSession } from './useSession'

export type Profile = components['schemas']['ProfileResponseDto']
export type Capability = Profile['capabilities'][number]

interface ProfileContextValue {
  profile: Profile
  /** rule-evp-layout-nav-by-capability: the studio reads capabilities, never the role name. */
  can: (capability: Capability) => boolean
  unreadCount: number
  refreshUnread: () => void
  setUnreadCount: (value: number) => void
}

const ProfileContext = createContext<ProfileContextValue | null>(null)

const INACTIVE_CODES = ['access.account_inactive', 'access.not_authorized']

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; profile: Profile }

/**
 * Reads `GET /profile` once the session exists and keeps the unread counter fresh.
 * rule-evp-account-inactive-logout, rule-evp-rights-rechecked, rule-evp-unread-badge-refresh
 */
export function ProfileProvider({ children }: { children: ReactNode }) {
  const { logout, expire } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const [state, setState] = useState<State>({ status: 'loading' })
  const [unreadCount, setUnreadCount] = useState(0)
  const [version, setVersion] = useState(0)
  const leaving = useRef(false)

  const withdrawn = useCallback(() => {
    if (leaving.current) return
    leaving.current = true
    void logout(() => navigate('/connexion?motif=acces-retire', { replace: true }))
  }, [logout, navigate])

  useEffect(() => {
    let current = true
    setState({ status: 'loading' })
    void (async () => {
      try {
        const { data, error, response } = await api.GET('/profile')
        if (!current) return
        if (response.ok && data) return setState({ status: 'ready', profile: data })
        const code = (error as { code?: string } | undefined)?.code
        if (response.status === 403 && code && INACTIVE_CODES.includes(code)) return withdrawn()
        // rule-foundation-api-failure-handling: a 401 means the session ended (8 h), not a failure to retry.
        if (response.status === 401) return expire()
        setState({ status: 'error' })
      } catch {
        if (current) setState({ status: 'error' })
      }
    })()
    return () => {
      current = false
    }
  }, [version, withdrawn, expire])

  const refreshUnread = useCallback(() => {
    void (async () => {
      try {
        const { data, error, response } = await api.GET('/notifications/unread-count')
        if (response.ok && data) return setUnreadCount(data.unreadCount)
        const code = (error as { code?: string } | undefined)?.code
        if (response.status === 403 && code && INACTIVE_CODES.includes(code)) withdrawn()
        else if (response.status === 401) expire()
      } catch {
        // a network failure leaves the badge as it is
      }
    })()
  }, [withdrawn, expire])

  const ready = state.status === 'ready'
  // On every page change, and every 60 s while the tab is visible.
  useEffect(() => {
    if (ready) refreshUnread()
  }, [ready, location.pathname, refreshUnread])
  useEffect(() => {
    if (!ready) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refreshUnread()
    }, 60_000)
    return () => clearInterval(timer)
  }, [ready, refreshUnread])

  // `can` keeps its identity while the profile does: screens list it in the dependencies of their loads, and the unread
  // counter (refreshed every minute) must not make them reload.
  const profile = state.status === 'ready' ? state.profile : null
  const can = useMemo(() => {
    const caps = new Set<string>(profile?.capabilities ?? [])
    return (c: Capability) => caps.has(c)
  }, [profile])
  const value = useMemo<ProfileContextValue | null>(
    () => (profile ? { profile, can, unreadCount, refreshUnread, setUnreadCount } : null),
    [profile, can, unreadCount, refreshUnread],
  )

  if (state.status === 'loading') return <FullScreenLoading />
  if (state.status === 'error' || !value) return <EtatErreur onRetry={() => setVersion((v) => v + 1)} />
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext)
  if (!ctx) throw new Error('ProfileProvider manquant')
  return ctx
}
