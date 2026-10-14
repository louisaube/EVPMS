import { Module } from '@nestjs/common'
import { ClosuresController } from './closures.controller'
import { ClosuresService } from './closures.service'

@Module({ controllers: [ClosuresController], providers: [ClosuresService], exports: [ClosuresService] })
export class ClosuresModule {}
