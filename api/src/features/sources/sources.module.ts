import { Module } from '@nestjs/common'
import { DB, Database } from '../../platform/database/database.module'
import { ReconciliationService } from './reconciliation.service'
import { createSourceConnectors, SourceConnectors } from './source-connectors'
import { SourceReaders } from './source-readers'
import { SourcesController } from './sources.controller'
import { SourcesService } from './sources.service'

@Module({
  controllers: [SourcesController],
  providers: [
    SourcesService,
    SourceReaders,
    ReconciliationService,
    // rule-evp-sources-configurable: one switch (EVP_SOURCES_DRIVER) for the whole process, no fall-back by source
    { provide: SourceConnectors, inject: [DB], useFactory: (db: Database) => createSourceConnectors(db) },
  ],
})
export class SourcesModule {}
