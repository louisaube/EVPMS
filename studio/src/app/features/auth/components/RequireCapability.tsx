import { Outlet } from 'react-router-dom'
import { EtatInterdit } from '../../../shared/components/EtatsEcran'
import { useProfile, type Capability } from '../hooks/useProfile'

/** Guard by capability: « Accès refusé » without any call to the routes of the page (rule-evp-*-guard). */
export function RequireCapability({ capability }: { capability: Capability }) {
  const { can } = useProfile()
  if (!can(capability)) return <EtatInterdit />
  return <Outlet />
}
