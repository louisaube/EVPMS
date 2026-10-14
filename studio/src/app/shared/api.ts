import { createApiClient } from '@evpms/api-client'

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

/** Typed API client; the session cookie is sent with every request. */
export const api = createApiClient({
  baseUrl: API_URL,
  credentials: 'include',
})
