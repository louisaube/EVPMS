import { Module } from '@nestjs/common'
import { JustificatifsController } from './justificatifs.controller'
import { JustificatifsService } from './justificatifs.service'
import { createPieceStorage, PieceStorage } from './piece-storage'
import { TestStorageController } from './test-storage.controller'

@Module({
  controllers: [JustificatifsController, TestStorageController],
  providers: [JustificatifsService, { provide: PieceStorage, useFactory: createPieceStorage }],
  exports: [PieceStorage],
})
export class JustificatifsModule {}
