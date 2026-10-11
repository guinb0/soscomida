import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type ModerationDecisionInput,
  type ModerationQueueItem,
  moderationDecisionInputSchema,
  statusChangeInputSchema,
} from '@soscomida/contracts';
import { z } from 'zod';
import { ApiZodBody, ZodPipe } from '../../infra/http/zod';
import { CampaignsService } from '../campaigns';
import { type AuthContext, CurrentUser, Roles } from '../identity';
import { ModerationService } from './moderation.service';

const versionSchema = z.object({ version: z.number().int().nonnegative() });
const closeInvestigationSchema = statusChangeInputSchema.extend({ outcome: z.enum(['CLEARED', 'CANCELLED']) });

@ApiTags('moderação')
@Controller('moderation')
@Roles('moderator', 'admin')
export class ModerationController {
  constructor(
    private readonly moderation: ModerationService,
    private readonly campaigns: CampaignsService,
  ) {}

  @Get('queue')
  queue(): Promise<ModerationQueueItem[]> {
    return this.moderation.queue();
  }

  /** Campanha em qualquer status, para análise. */
  @Get('campaigns/:id')
  campaign(@Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.getForModeration(id);
  }

  @Post('campaigns/:id/claim')
  @HttpCode(200)
  @ApiZodBody(versionSchema)
  async claim(@CurrentUser() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(versionSchema)) input: { version: number }) {
    await this.moderation.claim(auth, id, input.version);
    return { ok: true };
  }

  @Post('campaigns/:id/decision')
  @HttpCode(200)
  @ApiZodBody(moderationDecisionInputSchema)
  async decide(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(moderationDecisionInputSchema)) input: ModerationDecisionInput,
  ) {
    await this.moderation.decide(auth, id, input);
    return { ok: true };
  }

  @Post('campaigns/:id/investigate')
  @HttpCode(200)
  @ApiZodBody(statusChangeInputSchema)
  async investigate(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(statusChangeInputSchema)) input: z.infer<typeof statusChangeInputSchema>,
  ) {
    await this.moderation.investigate(auth, id, input.version, input.reason);
    return { ok: true };
  }

  @Post('campaigns/:id/close-investigation')
  @HttpCode(200)
  @ApiZodBody(closeInvestigationSchema)
  async closeInvestigation(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(closeInvestigationSchema)) input: z.infer<typeof closeInvestigationSchema>,
  ) {
    await this.moderation.closeInvestigation(auth, id, input.version, input.reason, input.outcome);
    return { ok: true };
  }
}
