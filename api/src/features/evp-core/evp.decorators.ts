import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import type { EvpAccess, EvpRequest } from './evp.types'

/** The EVP identity of the caller, resolved by the capability guard. */
export const Evp = createParamDecorator((_data: unknown, context: ExecutionContext): EvpAccess => {
  return context.switchToHttp().getRequest<EvpRequest>().evp as EvpAccess
})
