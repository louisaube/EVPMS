import type { ApiRequest } from '../../platform/http/request-context'

export type EvpRoleName = 'DIRECTRICE' | 'RO' | 'RH' | 'ADMINISTRATRICE' | 'SUPERADMIN'

export const EVP_CAPABILITIES = [
  'absences:create',
  'absences:decide',
  'access:manage:directrice',
  'access:manage:ro',
  'closures:attest',
  'export:run',
  'journal:read',
  'notifications:read',
  'profile:read',
  'settings:read',
  'sources:read',
  'sources:refresh:aqoona',
  'sources:refresh:payfit',
  'sources:refresh:sheets',
] as const
export type Capability = (typeof EVP_CAPABILITIES)[number]

export interface EvpCreche {
  code: string
  name: string
}

/** The EVP identity of the caller, resolved by the capability guard (rule-evp-declare-roles). */
export interface EvpAccess {
  userId: string
  name: string
  email: string
  role: EvpRoleName
  active: boolean
  /** `ALL`: global consultation (RH, ADMINISTRATRICE, SUPERADMIN); `ASSIGNED`: only the assigned crèches. */
  scope: 'ASSIGNED' | 'ALL'
  creches: EvpCreche[]
  capabilities: Capability[]
  /** rule-evp-access-session-version: internal, compared with the `sv` of the token; never copied into a DTO. */
  sessionVersion: number
}

export type EvpRequest = ApiRequest & { evp?: EvpAccess }

/** Session lifetime of an EVP account: 8 hours (rule-evp-session-8h). */
export const EVP_SESSION_SECONDS = 8 * 60 * 60
