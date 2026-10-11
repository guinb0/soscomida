import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';

export { StorageService, type FilePurpose, type UploadTicket, type ValidatedFile } from './storage.service';
export type { DetectedType } from './domain/file-type';

@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
