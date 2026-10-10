import { Body, Controller, Delete, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { roleSchema } from '@soscomida/contracts';
import { z } from 'zod';
import { ApiZodBody, ZodPipe } from '../../../infra/http/zod';
import { IdentityService } from '../application/identity.service';
import type { AuthContext } from '../domain/auth-context';
import { CurrentUser, Roles } from './auth.guards';

const roleInputSchema = z.object({ role: roleSchema });

@ApiTags('administração')
@Controller('admin/users')
@Roles('admin')
export class AdminUsersController {
  constructor(private readonly identity: IdentityService) {}

  @Post(':userId/roles')
  @HttpCode(200)
  @ApiZodBody(roleInputSchema)
  async grant(
    @CurrentUser() auth: AuthContext,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodPipe(roleInputSchema)) input: z.infer<typeof roleInputSchema>,
  ): Promise<{ ok: true }> {
    await this.identity.grantRole(userId, input.role, auth.userId);
    return { ok: true };
  }

  @Delete(':userId/roles/:role')
  async revoke(
    @CurrentUser() auth: AuthContext,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('role', new ZodPipe(roleSchema)) role: z.infer<typeof roleSchema>,
  ): Promise<{ ok: true }> {
    await this.identity.revokeRole(userId, role, auth.userId);
    return { ok: true };
  }
}
