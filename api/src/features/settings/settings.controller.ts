import { Controller, Get, UseGuards, UseInterceptors } from '@nestjs/common'
import { Access } from '../../platform/access/access.decorators'
import { ApiRoute, ApiTag } from '../../platform/openapi/route-contract'
import { CapabilityGuard } from '../evp-core/capability.guard'
import { EvpContextInterceptor } from '../evp-core/evp-context.interceptor'
import { settingsResponseSchema } from './settings.schemas'
import { SettingsService } from './settings.service'

@Controller('settings')
@ApiTag('Settings')
@UseInterceptors(EvpContextInterceptor)
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  @Get()
  @UseGuards(CapabilityGuard('settings:read'))
  @Access({ action: 'settings:read', roles: ['user'] })
  @ApiRoute({
    description: 'Use this API action to read the visible configuration: limits, windows read, absence types',
    responses: {
      200: { description: 'Visible configuration', schema: settingsResponseSchema },
      401: { description: 'Unauthorized' },
      403: { description: 'Forbidden - not an EVP account' },
    },
  })
  read() {
    return this.service.read()
  }
}
