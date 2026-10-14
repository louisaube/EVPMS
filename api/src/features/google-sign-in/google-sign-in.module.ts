import { Module } from '@nestjs/common'
import { GoogleIdTokenVerifier } from './google-id-token.verifier'
import { GoogleSignInController } from './google-sign-in.controller'
import { GoogleSignInService } from './google-sign-in.service'

@Module({ controllers: [GoogleSignInController], providers: [GoogleSignInService, GoogleIdTokenVerifier] })
export class GoogleSignInModule {}
