import { Controller, HttpCode, Post, Res, UseGuards, UseInterceptors } from '@nestjs/common'
import type { Response } from 'express'
import { Access } from '../../platform/access/access.decorators'
import { Audited } from '../../platform/audit/audit.decorators'
import { ApiRoute, ApiTag } from '../../platform/openapi/route-contract'
import { ValidBody } from '../../platform/validation/zod-validation.interceptor'
import { CapabilityGuard } from '../evp-core/capability.guard'
import { EvpContextInterceptor } from '../evp-core/evp-context.interceptor'
import { Evp } from '../evp-core/evp.decorators'
import type { EvpAccess } from '../evp-core/evp.types'
import { ExportBody, exportBodySchema, exportResponseSchema } from './exports.schemas'
import { ExportsService } from './exports.service'

/** rule-evp-export-*: CSV of the dossiers of a period. A POST, so that every export is traced. */
@Controller('exports')
@ApiTag('Exports')
@UseInterceptors(EvpContextInterceptor)
export class ExportsController {
  constructor(private readonly service: ExportsService) {}

  @Post('absences')
  @HttpCode(200)
  @UseGuards(CapabilityGuard('export:run'))
  @Access({ action: 'exports:absences', roles: ['user'] })
  @Audited<string>({
    objectType: 'Export',
    describe: ({ body, response }) => {
      const rows = Math.max(0, response.split('\r\n').filter((line) => line.length > 0).length - 1)
      return {
        objectId: 'export',
        summary: `Export des absences du ${body.from} au ${body.to} : ${rows} ligne${rows < 2 ? '' : 's'}`,
      }
    },
  })
  @ApiRoute({
    description:
      'Use this API action to export the dossiers overlapping a period (366 days at most) as a CSV file (text/csv, attachment)',
    body: exportBodySchema,
    responses: {
      200: { description: 'CSV file', schema: exportResponseSchema },
      400: { description: 'Invalid period' },
      401: { description: 'Unauthorized' },
      403: { description: 'Forbidden - RH and SUPERADMIN only' },
    },
  })
  async absences(@ValidBody() body: ExportBody, @Evp() evp: EvpAccess, @Res({ passthrough: true }) res: Response) {
    const csv = await this.service.absences(evp, body)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="absences-${body.from}_${body.to}.csv"`)
    return csv
  }
}
