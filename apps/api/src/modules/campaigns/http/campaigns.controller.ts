import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type CampaignDetail,
  type CampaignList,
  type CreateCampaignInput,
  type ImageUploadRequest,
  type ImageUploadTicket,
  type ListCampaignsQuery,
  type OwnedCampaign,
  type StatusChangeInput,
  type UpdateCampaignInput,
  campaignDetailSchema,
  campaignListSchema,
  campaignUpdateInputSchema,
  createCampaignInputSchema,
  imageUploadRequestSchema,
  imageUploadTicketSchema,
  listCampaignsQuerySchema,
  ownedCampaignSchema,
  statusChangeInputSchema,
  updateCampaignInputSchema,
} from '@soscomida/contracts';
import { z } from 'zod';
import { Public } from '../../../infra/http/decorators';
import { ApiZodBody, ApiZodQuery, ApiZodResponse, ZodPipe } from '../../../infra/http/zod';
import { type AuthContext, CurrentUser } from '../../identity';
import { CampaignsService } from '../application/campaigns.service';
import type { CampaignAction } from '../domain/campaign-status';

/** Leitura pública: catálogo e página da campanha. */
@ApiTags('campanhas (público)')
@Controller('campaigns')
export class PublicCampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Public()
  @Get()
  @ApiZodQuery(listCampaignsQuerySchema)
  @ApiZodResponse(campaignListSchema)
  list(@Query(new ZodPipe(listCampaignsQuerySchema)) query: ListCampaignsQuery): Promise<CampaignList> {
    return this.campaigns.listPublic(query);
  }

  @Public()
  @Get(':slug')
  @ApiZodResponse(campaignDetailSchema)
  detail(@Param('slug') slug: string): Promise<CampaignDetail> {
    return this.campaigns.getPublicBySlug(slug);
  }

  @Public()
  @Get(':slug/updates')
  updates(@Param('slug') slug: string) {
    return this.campaigns.listUpdates(slug);
  }
}

const ORGANIZER_ACTIONS = ['submit', 'withdraw', 'publish', 'pause', 'resume', 'end', 'cancel'] as const satisfies readonly CampaignAction[];
const organizerActionSchema = z.enum(ORGANIZER_ACTIONS);
const organizerActionInputSchema = statusChangeInputSchema.extend({ reason: z.string().trim().max(2000).optional() });

/** Área do organizador: só as próprias campanhas (verificado no serviço). */
@ApiTags('campanhas (organizador)')
@Controller('me/campaigns')
export class OrganizerCampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  list(@CurrentUser() auth: AuthContext): Promise<OwnedCampaign[]> {
    return this.campaigns.listOwned(auth);
  }

  @Post()
  @ApiZodBody(createCampaignInputSchema)
  @ApiZodResponse(ownedCampaignSchema)
  create(@CurrentUser() auth: AuthContext, @Body(new ZodPipe(createCampaignInputSchema)) input: CreateCampaignInput): Promise<OwnedCampaign> {
    return this.campaigns.create(auth, input);
  }

  @Get(':id')
  @ApiZodResponse(ownedCampaignSchema)
  get(@CurrentUser() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<OwnedCampaign> {
    return this.campaigns.getOwned(auth, id);
  }

  @Patch(':id')
  @ApiZodBody(updateCampaignInputSchema)
  update(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateCampaignInputSchema)) input: UpdateCampaignInput,
  ): Promise<OwnedCampaign> {
    return this.campaigns.update(auth, id, input);
  }

  @Post(':id/actions/:action')
  @HttpCode(200)
  @ApiZodBody(organizerActionInputSchema)
  act(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('action', new ZodPipe(organizerActionSchema)) action: (typeof ORGANIZER_ACTIONS)[number],
    @Body(new ZodPipe(organizerActionInputSchema)) input: Omit<StatusChangeInput, 'reason'> & { reason?: string },
  ): Promise<OwnedCampaign> {
    return this.campaigns.organizerAction(auth, id, action, input.version, input.reason);
  }

  @Post(':id/images/upload-url')
  @ApiZodBody(imageUploadRequestSchema)
  @ApiZodResponse(imageUploadTicketSchema)
  uploadUrl(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(imageUploadRequestSchema)) input: ImageUploadRequest,
  ): Promise<ImageUploadTicket> {
    return this.campaigns.requestImageUpload(auth, id, input.contentType, input.sizeBytes);
  }

  @Post(':id/images/:fileId')
  @HttpCode(200)
  attachImage(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<OwnedCampaign> {
    return this.campaigns.attachImage(auth, id, fileId);
  }

  @Delete(':id/images/:fileId')
  removeImage(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<OwnedCampaign> {
    return this.campaigns.removeImage(auth, id, fileId);
  }

  @Post(':id/updates')
  @ApiZodBody(campaignUpdateInputSchema)
  addUpdate(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(campaignUpdateInputSchema)) input: z.infer<typeof campaignUpdateInputSchema>,
  ) {
    return this.campaigns.addUpdate(auth, id, input);
  }
}
