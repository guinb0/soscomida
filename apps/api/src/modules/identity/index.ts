import { Module } from '@nestjs/common';
import { IdentityService } from './application/identity.service';
import { AdminUsersController } from './http/admin-users.controller';
import { AuthController } from './http/auth.controller';

export { IdentityService, type RequestMeta } from './application/identity.service';
export { type AuthContext, hasRole } from './domain/auth-context';
export { generateTotp } from './domain/totp';
export {
  CurrentUser,
  Roles,
  RolesGuard,
  RequestMetaParam,
  SessionGuard,
  type AuthenticatedRequest,
} from './http/auth.guards';

/**
 * Os guards (SessionGuard, RolesGuard) são registrados como APP_GUARD no
 * AppModule, em ordem explícita.
 */
@Module({
  controllers: [AuthController, AdminUsersController],
  providers: [IdentityService],
  exports: [IdentityService],
})
export class IdentityModule {}
