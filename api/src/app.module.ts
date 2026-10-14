import { Module } from '@nestjs/common'
import { AbsencesModule } from './features/absences/absences.module'
import { AccessModule } from './features/access/access.module'
import { AuditModule } from './features/audit/audit.module'
import { AuthModule } from './features/auth/auth.module'
import { ClosuresModule } from './features/closures/closures.module'
import { CrechesModule } from './features/creches/creches.module'
import { EvpCoreModule } from './features/evp-core/evp-core.module'
import { ExportsModule } from './features/exports/exports.module'
import { GoogleSignInModule } from './features/google-sign-in/google-sign-in.module'
import { GroupsModule } from './features/groups/groups.module'
import { JournalModule } from './features/journal/journal.module'
import { JustificatifsModule } from './features/justificatifs/justificatifs.module'
import { NotificationsModule } from './features/notifications/notifications.module'
import { ProfileModule } from './features/profile/profile.module'
import { ScopesModule } from './features/scopes/scopes.module'
import { ServerModule } from './features/server/server.module'
import { ServiceStatusModule } from './features/service-status/service-status.module'
import { SettingsModule } from './features/settings/settings.module'
import { SourcesModule } from './features/sources/sources.module'
import { UsersModule } from './features/users/users.module'
import { PlatformModule } from './platform/platform.module'

/**
 * Root module. A business feature adds its module to `imports` (lot r1 added accounts, groups and scopes;
 * lot r2 added the audit journal; lot r3 adds the imports here; the EVP modules follow).
 */
@Module({
  imports: [
    PlatformModule,
    ServerModule,
    AuthModule,
    UsersModule,
    GroupsModule,
    ScopesModule,
    AuditModule,
    EvpCoreModule,
    ServiceStatusModule,
    GoogleSignInModule,
    ProfileModule,
    SettingsModule,
    AccessModule,
    CrechesModule,
    ClosuresModule,
    AbsencesModule,
    JustificatifsModule,
    NotificationsModule,
    JournalModule,
    ExportsModule,
    SourcesModule,
  ],
})
export class AppModule {}
