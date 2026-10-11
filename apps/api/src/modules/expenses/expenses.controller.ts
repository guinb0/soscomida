import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  type AttachDocumentInput,
  type ExpenseInput,
  type ExpenseQueueItem,
  type ExpenseReviewDecision,
  type FiscalKeyInput,
  type ModerationExpense,
  type OwnedExpense,
  type PublicExpense,
  type UpdateExpenseInput,
  attachDocumentInputSchema,
  expenseActionInputSchema,
  expenseInputSchema,
  expenseReviewDecisionSchema,
  expenseUploadInputSchema,
  fiscalKeyInputSchema,
  moderationExpenseSchema,
  ownedExpenseSchema,
  updateExpenseInputSchema,
} from '@soscomida/contracts';
import { z } from 'zod';
import { Public } from '../../infra/http/decorators';
import { ApiZodBody, ApiZodResponse, ZodPipe } from '../../infra/http/zod';
import { type AuthContext, CurrentUser, Roles } from '../identity';
import { ExpensesService } from './expenses.service';

const ORGANIZER_ACTIONS = ['submit', 'withdraw', 'cancel'] as const;
const versionSchema = z.object({ version: z.number().int().nonnegative() });

/** Prestação de contas pelo organizador (dono da campanha, verificado no serviço). */
@ApiTags('despesas (organizador)')
@Controller()
export class OrganizerExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get('me/campaigns/:campaignId/expenses')
  list(@CurrentUser() auth: AuthContext, @Param('campaignId', ParseUUIDPipe) campaignId: string): Promise<OwnedExpense[]> {
    return this.expenses.listForCampaign(auth, campaignId);
  }

  @Post('me/campaigns/:campaignId/expenses')
  @ApiZodBody(expenseInputSchema)
  @ApiZodResponse(ownedExpenseSchema)
  create(
    @CurrentUser() auth: AuthContext,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Body(new ZodPipe(expenseInputSchema)) input: ExpenseInput,
  ): Promise<OwnedExpense> {
    return this.expenses.create(auth, campaignId, input);
  }

  @Get('me/expenses/:id')
  @ApiZodResponse(ownedExpenseSchema)
  get(@CurrentUser() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<OwnedExpense> {
    return this.expenses.getOwned(auth, id);
  }

  @Patch('me/expenses/:id')
  @ApiZodBody(updateExpenseInputSchema)
  update(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateExpenseInputSchema)) input: UpdateExpenseInput,
  ): Promise<OwnedExpense> {
    return this.expenses.update(auth, id, input);
  }

  @Post('me/expenses/:id/documents/upload-url')
  @ApiZodBody(expenseUploadInputSchema)
  uploadUrl(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(expenseUploadInputSchema)) input: z.infer<typeof expenseUploadInputSchema>,
  ) {
    return this.expenses.requestUpload(auth, id, input.contentType, input.sizeBytes);
  }

  @Post('me/expenses/:id/documents')
  @HttpCode(200)
  @ApiZodBody(attachDocumentInputSchema)
  attach(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(attachDocumentInputSchema)) input: AttachDocumentInput,
  ): Promise<OwnedExpense> {
    return this.expenses.attach(auth, id, input);
  }

  @Post('me/expenses/:id/documents/:documentId/fiscal-key')
  @HttpCode(200)
  @ApiZodBody(fiscalKeyInputSchema)
  fiscalKey(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body(new ZodPipe(fiscalKeyInputSchema)) input: FiscalKeyInput,
  ): Promise<OwnedExpense> {
    return this.expenses.provideFiscalKey(auth, id, documentId, input);
  }

  @Delete('me/expenses/:id/documents/:documentId')
  removeDocument(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ): Promise<OwnedExpense> {
    return this.expenses.removeDocument(auth, id, documentId);
  }

  /** Link temporário (5 min) para ver o arquivo. Também usado pela revisão. */
  @Get('expenses/:id/documents/:documentId/url')
  documentUrl(@CurrentUser() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('documentId', ParseUUIDPipe) documentId: string) {
    return this.expenses.documentUrl(auth, id, documentId);
  }

  @Post('me/expenses/:id/actions/:action')
  @HttpCode(200)
  @ApiZodBody(expenseActionInputSchema)
  act(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('action', new ZodPipe(z.enum(ORGANIZER_ACTIONS))) action: (typeof ORGANIZER_ACTIONS)[number],
    @Body(new ZodPipe(expenseActionInputSchema)) input: z.infer<typeof expenseActionInputSchema>,
  ): Promise<OwnedExpense> {
    return this.expenses.organizerAction(auth, id, action, input.version, input.reason);
  }
}

@ApiTags('despesas (revisão)')
@Controller('moderation/expenses')
@Roles('moderator', 'admin')
export class ReviewExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  queue(): Promise<ExpenseQueueItem[]> {
    return this.expenses.queue();
  }

  @Get(':id')
  @ApiZodResponse(moderationExpenseSchema)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ModerationExpense> {
    return this.expenses.getForReview(id);
  }

  @Post(':id/claim')
  @HttpCode(200)
  @ApiZodBody(versionSchema)
  async claim(@CurrentUser() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(versionSchema)) input: { version: number }) {
    await this.expenses.claim(auth, id, input.version);
    return { ok: true };
  }

  @Post(':id/decision')
  @HttpCode(200)
  @ApiZodBody(expenseReviewDecisionSchema)
  async decide(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(expenseReviewDecisionSchema)) input: ExpenseReviewDecision,
  ) {
    await this.expenses.decide(auth, id, input);
    return { ok: true };
  }
}

@ApiTags('despesas (público)')
@Controller('campaigns')
export class PublicExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Public()
  @Get(':slug/expenses')
  list(@Param('slug') slug: string): Promise<PublicExpense[]> {
    return this.expenses.listPublic(slug);
  }
}
