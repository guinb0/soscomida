import { Module } from '@nestjs/common';
import { CampaignsModule } from '../campaigns';
import { IdentityModule } from '../identity';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';

export { ModerationService } from './moderation.service';

@Module({
  imports: [CampaignsModule, IdentityModule],
  controllers: [ModerationController],
  providers: [ModerationService],
})
export class ModerationModule {}
