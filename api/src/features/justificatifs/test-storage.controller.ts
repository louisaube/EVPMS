import { Controller, Get, Param, Put, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { Public } from '../../platform/access/access.decorators'
import { ApiError, notFound } from '../../platform/http/errors'
import { ApiRoute, ApiTag } from '../../platform/openapi/route-contract'
import { FakePieceStorage, PieceStorage, verifyFakeSignature } from './piece-storage'

const ok = { 200: { description: 'ok', schema: z.object({}) } }

type SignedQuery = { exp?: string; type?: string; size?: string; sig?: string }

/**
 * Local double of the object storage (hidden from the contract, only served with the local driver): the signed URLs
 * returned by the API point here. The signature carries the key, the expiry, the type and the exact size.
 */
@Controller('test/storage')
@ApiTag('Test')
export class TestStorageController {
  constructor(private readonly storage: PieceStorage) {}

  private fake(): FakePieceStorage {
    if (!(this.storage instanceof FakePieceStorage)) throw notFound()
    return this.storage
  }

  private keyOf(raw: string | string[]): string {
    const key = Array.isArray(raw) ? raw.join('/') : raw
    if (!/^(deposit|final)\/[A-Za-z0-9_-]+\/[0-9a-f-]{36}$/.test(key)) throw notFound()
    return key
  }

  @Put('put/*key')
  @Public()
  @ApiRoute({ hidden: true, responses: ok })
  async put(@Param('key') raw: string | string[], @Req() req: Request, @Res() res: Response): Promise<void> {
    const storage = this.fake()
    const key = this.keyOf(raw)
    const query = req.query as SignedQuery
    if (!verifyFakeSignature('put', key, query)) throw new ApiError(403, 'storage.invalid_signature', 'Invalid or expired link')
    // The body is always drained first: answering an error with an unread body makes Node drop the keep-alive socket.
    const chunks: Buffer[] = []
    let total = 0
    for await (const chunk of req) {
      total += (chunk as Buffer).length
      chunks.push(chunk as Buffer)
    }
    const sent = (req.header('content-type') ?? '').split(';')[0].trim()
    if (sent !== query.type) throw new ApiError(400, 'storage.type_mismatch', 'The content type does not match the link')
    const expected = Number(query.size)
    if (total > expected) throw new ApiError(400, 'storage.size_mismatch', 'The file is larger than announced')
    if (total !== expected) throw new ApiError(400, 'storage.size_mismatch', 'The file does not have the announced size')
    await storage.write(key, Buffer.concat(chunks))
    res.status(200).json({})
  }

  @Get('get/*key')
  @Public()
  @ApiRoute({ hidden: true, responses: ok })
  async get(@Param('key') raw: string | string[], @Req() req: Request, @Res() res: Response): Promise<void> {
    const storage = this.fake()
    const key = this.keyOf(raw)
    const query = req.query as SignedQuery
    if (!verifyFakeSignature('get', key, query)) throw new ApiError(403, 'storage.invalid_signature', 'Invalid or expired link')
    const bytes = await storage.readAll(key)
    if (!bytes) throw notFound()
    res.status(200).setHeader('Content-Type', query.type ?? 'application/octet-stream')
    res.setHeader('Content-Disposition', 'inline')
    res.setHeader('Cache-Control', 'no-store')
    res.end(bytes)
  }
}
