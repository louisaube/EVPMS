import { Module } from '@nestjs/common'
import { CrechesController } from './creches.controller'
import { CrechesService } from './creches.service'

@Module({ controllers: [CrechesController], providers: [CrechesService] })
export class CrechesModule {}
