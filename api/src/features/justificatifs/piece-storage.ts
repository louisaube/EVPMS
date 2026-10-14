import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { copyFile, mkdir, open, rm, stat } from 'node:fs/promises'
import { dirname, join, normalize, sep } from 'node:path'
import { getConfig } from '../../platform/config/config'
import { evpConfig } from '../evp-core/evp-config'

export interface PutTicket {
  method: 'PUT'
  url: string
  headers: Record<string, string>
}

/**
 * Object storage of the supporting documents (rule-evp-attach-no-files-in-db): the bytes never go through the API nor the
 * database. Keys are `deposit/...` (temporary zone) and `final/...` (after confirmation).
 */
export abstract class PieceStorage {
  abstract presignPut(key: string, contentType: string, size: number, ttlSeconds: number): PutTicket
  abstract presignGet(key: string, contentType: string, ttlSeconds: number): string
  abstract head(key: string): Promise<{ size: number } | null>
  abstract readStart(key: string, length: number): Promise<Buffer>
  abstract copy(from: string, to: string): Promise<void>
  abstract remove(key: string): Promise<void>
}

// ───────────────────────────── local double (signed URLs served by the hidden /test/storage routes) ─────────────────────────────

export type FakeOperation = 'put' | 'get'

const fakeSignature = (parts: string[]): string =>
  createHmac('sha256', getConfig().jwtSecret).update(parts.join('|')).digest('hex')

/** Verifies the HMAC of a local signed URL and its expiry. */
export function verifyFakeSignature(
  operation: FakeOperation,
  key: string,
  query: { exp?: string; type?: string; size?: string; sig?: string },
): boolean {
  const exp = Number(query.exp)
  if (!Number.isFinite(exp) || exp < Date.now() || !query.sig) return false
  const expected = Buffer.from(fakeSignature([operation, key, query.exp ?? '', query.type ?? '', query.size ?? '']))
  const given = Buffer.from(query.sig)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

export class FakePieceStorage extends PieceStorage {
  constructor(private readonly root: string) {
    super()
  }

  path(key: string): string {
    const full = normalize(join(this.root, key))
    if (!full.startsWith(this.root + sep)) throw new Error('Invalid storage key')
    return full
  }

  private url(operation: FakeOperation, key: string, ttlSeconds: number, type: string, size?: number): string {
    const exp = String(Date.now() + ttlSeconds * 1000)
    const sizeText = size === undefined ? '' : String(size)
    const sig = fakeSignature([operation, key, exp, type, sizeText])
    const params = new URLSearchParams({ exp, type, sig })
    if (size !== undefined) params.set('size', sizeText)
    return `/test/storage/${operation}/${key.split('/').map(encodeURIComponent).join('/')}?${params.toString()}`
  }

  presignPut(key: string, contentType: string, size: number, ttlSeconds: number): PutTicket {
    return { method: 'PUT', url: this.url('put', key, ttlSeconds, contentType, size), headers: { 'content-type': contentType } }
  }

  presignGet(key: string, contentType: string, ttlSeconds: number): string {
    return this.url('get', key, ttlSeconds, contentType)
  }

  async write(key: string, bytes: Buffer): Promise<void> {
    const target = this.path(key)
    await mkdir(dirname(target), { recursive: true })
    const handle = await open(target, 'w')
    try {
      await handle.writeFile(bytes)
    } finally {
      await handle.close()
    }
  }

  async head(key: string): Promise<{ size: number } | null> {
    try {
      return { size: (await stat(this.path(key))).size }
    } catch {
      return null
    }
  }

  async readStart(key: string, length: number): Promise<Buffer> {
    const handle = await open(this.path(key), 'r')
    try {
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, 0)
      return buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  }

  async readAll(key: string): Promise<Buffer | null> {
    try {
      const handle = await open(this.path(key), 'r')
      try {
        return await handle.readFile()
      } finally {
        await handle.close()
      }
    } catch {
      return null
    }
  }

  async copy(from: string, to: string): Promise<void> {
    const target = this.path(to)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(this.path(from), target)
  }

  async remove(key: string): Promise<void> {
    await rm(this.path(key), { force: true })
  }
}

// ───────────────────────────── S3 compatible (AWS Signature V4, no SDK) ─────────────────────────────

const sha256Hex = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex')
const hmac = (key: string | Buffer, data: string): Buffer => createHmac('sha256', key).update(data).digest()
const encode = (text: string): string => encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
const EMPTY_HASH = sha256Hex('')

type S3Settings = NonNullable<ReturnType<typeof evpConfig>['s3']>

export class S3PieceStorage extends PieceStorage {
  private readonly base: URL

  constructor(private readonly s3: S3Settings) {
    super()
    this.base = new URL(s3.endpoint)
  }

  private path(key: string): string {
    return '/' + [this.s3.bucket, ...key.split('/')].map(encode).join('/')
  }

  private signingKey(day: string): Buffer {
    return hmac(hmac(hmac(hmac(`AWS4${this.s3.secretAccessKey}`, day), this.s3.region), 's3'), 'aws4_request')
  }

  private stamp(): { amz: string; day: string; scope: string } {
    const amz = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
    const day = amz.slice(0, 8)
    return { amz, day, scope: `${day}/${this.s3.region}/s3/aws4_request` }
  }

  private presign(method: string, key: string, ttlSeconds: number, signed: Record<string, string>, extraQuery: Record<string, string> = {}): string {
    const { amz, day, scope } = this.stamp()
    const headers: Record<string, string> = { host: this.base.host, ...signed }
    const names = Object.keys(headers).sort()
    const query: Record<string, string> = {
      ...extraQuery,
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${this.s3.accessKeyId}/${scope}`,
      'X-Amz-Date': amz,
      'X-Amz-Expires': String(ttlSeconds),
      'X-Amz-SignedHeaders': names.join(';'),
    }
    const canonicalQuery = Object.keys(query)
      .sort()
      .map((name) => `${encode(name)}=${encode(query[name])}`)
      .join('&')
    const canonical = [
      method,
      this.path(key),
      canonicalQuery,
      names.map((name) => `${name}:${headers[name].trim()}\n`).join(''),
      names.join(';'),
      'UNSIGNED-PAYLOAD',
    ].join('\n')
    const toSign = ['AWS4-HMAC-SHA256', amz, scope, sha256Hex(canonical)].join('\n')
    const signature = createHmac('sha256', this.signingKey(day)).update(toSign).digest('hex')
    return `${this.base.origin}${this.path(key)}?${canonicalQuery}&X-Amz-Signature=${signature}`
  }

  presignPut(key: string, contentType: string, size: number, ttlSeconds: number): PutTicket {
    const signed = { 'content-type': contentType, 'content-length': String(size) }
    return { method: 'PUT', url: this.presign('PUT', key, ttlSeconds, signed), headers: { 'content-type': contentType } }
  }

  presignGet(key: string, contentType: string, ttlSeconds: number): string {
    return this.presign('GET', key, ttlSeconds, {}, { 'response-content-type': contentType })
  }

  private async request(method: string, key: string, extra: Record<string, string> = {}): Promise<Response> {
    const { amz, day, scope } = this.stamp()
    const headers: Record<string, string> = { host: this.base.host, 'x-amz-content-sha256': EMPTY_HASH, 'x-amz-date': amz, ...extra }
    const names = Object.keys(headers).sort()
    const canonical = [
      method,
      this.path(key),
      '',
      names.map((name) => `${name}:${headers[name].trim()}\n`).join(''),
      names.join(';'),
      EMPTY_HASH,
    ].join('\n')
    const toSign = ['AWS4-HMAC-SHA256', amz, scope, sha256Hex(canonical)].join('\n')
    const signature = createHmac('sha256', this.signingKey(day)).update(toSign).digest('hex')
    const { host: _host, ...sent } = headers
    return fetch(`${this.base.origin}${this.path(key)}`, {
      method,
      headers: {
        ...sent,
        authorization: `AWS4-HMAC-SHA256 Credential=${this.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
      },
    })
  }

  async head(key: string): Promise<{ size: number } | null> {
    const res = await this.request('HEAD', key)
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`Storage HEAD failed (${res.status})`)
    return { size: Number(res.headers.get('content-length') ?? 0) }
  }

  async readStart(key: string, length: number): Promise<Buffer> {
    const res = await this.request('GET', key, { range: `bytes=0-${length - 1}` })
    if (!res.ok) throw new Error(`Storage GET failed (${res.status})`)
    return Buffer.from(await res.arrayBuffer())
  }

  async copy(from: string, to: string): Promise<void> {
    const res = await this.request('PUT', to, { 'x-amz-copy-source': this.path(from) })
    if (!res.ok) throw new Error(`Storage COPY failed (${res.status})`)
    await res.arrayBuffer()
  }

  async remove(key: string): Promise<void> {
    const res = await this.request('DELETE', key)
    await res.arrayBuffer()
    if (!res.ok && res.status !== 404) throw new Error(`Storage DELETE failed (${res.status})`)
  }
}

/** The local double outside production (unless a real driver is requested and configured), S3 otherwise. */
export function createPieceStorage(): PieceStorage {
  const config = evpConfig()
  if (config.storageDriver === 'real') {
    if (!config.s3) throw new Error('EVP_STORAGE_DRIVER=real requires the EVP_S3_* settings')
    return new S3PieceStorage(config.s3)
  }
  return new FakePieceStorage(config.storageDir)
}
