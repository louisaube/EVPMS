import type { components } from '@evpms/api-client'
import { api } from '../../../shared/api'
import { useCall } from '../../../shared/useCall'
import { useLoad } from '../../../shared/useLoad'

export type Creche = components['schemas']['CrecheDto']

/** `GET /creches`: the crèches of the caller's perimeter (rule-evp-creche-scope). */
export function useCreches() {
  const call = useCall()
  return useLoad(() => call(() => api.GET('/creches')), [call])
}
