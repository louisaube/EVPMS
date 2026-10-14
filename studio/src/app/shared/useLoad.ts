import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'
import type { Failure, Outcome } from './useCall'

/** For a load that may be skipped (invalid filters, missing capability): the data is then `null`. */
export const SKIPPED: Outcome<null> = { ok: true, data: null }
export function orNull<T>(outcome: Outcome<T>): Outcome<T | null> {
  return outcome
}

export type LoadState<T> = { status: 'loading' } | { status: 'error'; failure: Failure } | { status: 'ready'; data: T }

/**
 * Loads one resource and reloads it when `deps` change or `reload` is called.
 * `keepData` keeps the previous data on screen while a reload is running.
 */
export function useLoad<T>(load: () => Promise<Outcome<T>>, deps: DependencyList, keepData = false) {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' })
  const [version, setVersion] = useState(0)
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    let current = true
    setState((s) => (keepData && s.status === 'ready' ? s : { status: 'loading' }))
    void loadRef.current().then((outcome) => {
      if (!current) return
      setState(outcome.ok ? { status: 'ready', data: outcome.data } : { status: 'error', failure: outcome.failure })
    })
    return () => {
      current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version])

  return { state, reload: useCallback(() => setVersion((v) => v + 1), []) }
}
