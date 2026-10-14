import { SourceError } from '../source-error'

export const CALL_TIMEOUT_MS = 30_000
export const MAX_ATTEMPTS = 3
const MAX_WAIT_MS = 60_000

export interface HttpAnswer {
  status: number
  headers: Headers
  text: string
}

export interface HttpRequest {
  headers?: Record<string, string>
  /** Base wait before a new try; doubled at each attempt when the source gives no `Retry-After`. */
  retryDelayMs: number
  /** Largest body accepted (checked while streaming). */
  maxBytes?: number
  /** Causes shown when the call cannot be made at all. */
  unreachable: string
  tooLarge?: string
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** `Retry-After` in seconds (the date form is ignored: the doubled base delay applies). */
function retryAfterMs(headers: Headers): number | null {
  const value = headers.get('retry-after')
  if (!value || !/^\d+$/.test(value.trim())) return null
  return Math.min(Number(value) * 1000, MAX_WAIT_MS)
}

async function readBody(response: Response, maxBytes: number | undefined, tooLarge: string): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (maxBytes !== undefined && size > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new SourceError('sources.unexpected_format', tooLarge)
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * rule-evp-sources-timeouts: 30 seconds per call, 3 tries at most per call on 429 or 5xx, none on another 4xx.
 * rule-evp-sources-readonly: the only methods are GET and, to obtain an access, POST (token of the service account,
 * introspection of a PayFit key). No redirection is followed. The failures are rebuilt from fixed texts: the exception
 * of `fetch` (which may quote the address) is never relayed.
 */
export class SourceHttp {
  get(url: string, request: HttpRequest): Promise<HttpAnswer> {
    return this.send(url, { method: 'GET', headers: request.headers }, request)
  }

  postForm(url: string, form: Record<string, string>, request: HttpRequest): Promise<HttpAnswer> {
    return this.send(
      url,
      { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...request.headers }, body: new URLSearchParams(form) },
      request,
    )
  }

  postJson(url: string, body: unknown, request: HttpRequest): Promise<HttpAnswer> {
    return this.send(
      url,
      { method: 'POST', headers: { 'content-type': 'application/json', ...request.headers }, body: JSON.stringify(body) },
      request,
    )
  }

  private async send(url: string, init: RequestInit, request: HttpRequest): Promise<HttpAnswer> {
    let delay = request.retryDelayMs
    for (let attempt = 1; ; attempt++) {
      let answer: HttpAnswer
      try {
        const response = await fetch(url, {
          ...init,
          redirect: 'manual',
          signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        })
        answer = {
          status: response.status,
          headers: response.headers,
          text: await readBody(response, request.maxBytes, request.tooLarge ?? request.unreachable),
        }
      } catch (error) {
        if (error instanceof SourceError) throw error
        throw new SourceError('sources.unreachable', request.unreachable)
      }
      const retriable = answer.status === 429 || answer.status >= 500
      if (!retriable || attempt >= MAX_ATTEMPTS) return answer
      await sleep(retryAfterMs(answer.headers) ?? delay)
      delay *= 2
    }
  }
}

/** The body as JSON; anything else is an unexpected format. */
export function parseJson(text: string, message: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new SourceError('sources.unexpected_format', message)
  }
}
