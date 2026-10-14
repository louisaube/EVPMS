import { Controller, Get } from '@nestjs/common'
import { Public } from '../../platform/access/access.decorators'
import { ApiRoute, ApiTag } from '../../platform/openapi/route-contract'
import { serviceStatusResponseSchema } from './service-status.schemas'
import { ServiceStatusService } from './service-status.service'

@Controller('service-status')
@ApiTag('ServiceStatus')
export class ServiceStatusController {
  constructor(private readonly service: ServiceStatusService) {}

  @Get()
  @Public()
  @ApiRoute({
    description: 'Use this API action to know whether the service is ready and, if not, why',
    responses: { 200: { description: 'Service state', schema: serviceStatusResponseSchema } },
  })
  status() {
    return this.service.status()
  }
}
