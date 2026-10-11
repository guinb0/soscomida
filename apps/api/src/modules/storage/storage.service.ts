import { createHash } from 'node:crypto';
import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { APP_CONFIG, type AppConfig } from '../../infra/config/config';
import { DB, type Database } from '../../infra/db/db';
import { DomainError, forbidden, notFound } from '../../infra/http/errors';
import { newId } from '../../infra/ids';
import { type DetectedType, EXTENSION, detectFileType } from './domain/file-type';
import { storedFiles } from './infra/storage.schema';

export type FilePurpose = 'campaign_image' | 'expense_document';

const UPLOAD_URL_TTL_SECONDS = 300;

/** Regras por finalidade: o que pode ser enviado e até que tamanho. */
const PURPOSES: Record<FilePurpose, { types: DetectedType[]; maxBytes: number; public: boolean }> = {
  campaign_image: { types: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 8 * 1024 * 1024, public: true },
  // Notas, comprovantes e evidências: sempre privados (podem ter dados pessoais).
  expense_document: {
    types: ['application/xml', 'application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
    maxBytes: 15 * 1024 * 1024,
    public: false,
  },
};

const DOWNLOAD_URL_TTL_SECONDS = 300;

export interface StoredFileInfo {
  id: string;
  ownerUserId: string;
  purpose: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

export interface UploadTicket {
  fileId: string;
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: string;
}

export interface ValidatedFile {
  id: string;
  publicUrl: string | null;
  mimeType: string;
  sha256: string;
}

/**
 * Upload direto para o S3 por URL assinada (a API não recebe o arquivo) e
 * validação posterior: tamanho, tipo real pelos bytes e hash. Só arquivos
 * validados podem ser usados; versões públicas são cópias no bucket público.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.s3 = new S3Client({
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
      // O SDK, por padrão, embute na URL assinada um checksum do corpo calculado
      // na hora de assinar (vazio) — o upload real falha com BadDigest.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  /** Em desenvolvimento e teste cria os buckets; em produção eles são provisionados fora da aplicação. */
  async onModuleInit(): Promise<void> {
    if (this.config.isProduction) return;
    for (const bucket of [this.config.S3_PRIVATE_BUCKET, this.config.S3_PUBLIC_BUCKET]) {
      try {
        await this.s3.send(new HeadBucketCommand({ Bucket: bucket }));
      } catch {
        try {
          await this.s3.send(new CreateBucketCommand({ Bucket: bucket }));
        } catch (error) {
          this.logger.warn({ bucket, err: (error as Error).message }, 'Não foi possível criar o bucket de desenvolvimento');
        }
      }
    }
  }

  async createUploadTicket(ownerUserId: string, purpose: FilePurpose, contentType: DetectedType, sizeBytes: number): Promise<UploadTicket> {
    const regra = PURPOSES[purpose];
    if (!regra.types.includes(contentType)) throw new DomainError('FILE_TYPE_NOT_ALLOWED', 'Tipo de arquivo não permitido');
    if (sizeBytes > regra.maxBytes) throw new DomainError('FILE_TOO_LARGE', 'Arquivo grande demais');

    const id = newId();
    const objectKey = `uploads/pending/${id}`;
    await this.db.insert(storedFiles).values({
      id,
      ownerUserId,
      purpose,
      bucket: this.config.S3_PRIVATE_BUCKET,
      objectKey,
      declaredMimeType: contentType,
      declaredSizeBytes: sizeBytes,
    });

    // Tipo e tamanho entram na assinatura: o S3 recusa um PUT diferente do declarado.
    const uploadUrl = await getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: this.config.S3_PRIVATE_BUCKET, Key: objectKey, ContentType: contentType, ContentLength: sizeBytes }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS, signableHeaders: new Set(['content-type', 'content-length']) },
    );
    return {
      fileId: id,
      uploadUrl,
      headers: { 'Content-Type': contentType },
      expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    };
  }

  /** Confere o que foi enviado. Idempotente: confirmar de novo um arquivo validado devolve o mesmo resultado. */
  async confirmUpload(fileId: string, ownerUserId: string): Promise<ValidatedFile> {
    const [arquivo] = await this.db.select().from(storedFiles).where(eq(storedFiles.id, fileId)).limit(1);
    if (!arquivo) throw notFound('Arquivo');
    if (arquivo.ownerUserId !== ownerUserId) throw forbidden();
    if (arquivo.status === 'VALIDATED') {
      return { id: arquivo.id, publicUrl: arquivo.publicUrl, mimeType: arquivo.detectedMimeType!, sha256: arquivo.sha256! };
    }
    if (arquivo.status === 'REJECTED') throw new DomainError('FILE_REJECTED', arquivo.rejectionReason ?? 'Arquivo recusado');

    const conteudo = await this.download(arquivo.bucket, arquivo.objectKey);
    if (!conteudo) throw new DomainError('FILE_NOT_UPLOADED', 'O arquivo ainda não foi enviado');

    const detectado = detectFileType(conteudo.subarray(0, 32));
    const regra = PURPOSES[arquivo.purpose as FilePurpose];
    const motivo =
      conteudo.length !== arquivo.declaredSizeBytes
        ? 'Tamanho diferente do declarado'
        : !detectado || !regra.types.includes(detectado)
          ? 'O conteúdo do arquivo não é de um tipo permitido'
          : detectado !== arquivo.declaredMimeType
            ? 'O conteúdo do arquivo não corresponde ao tipo declarado'
            : null;

    if (motivo) {
      await this.s3.send(new DeleteObjectCommand({ Bucket: arquivo.bucket, Key: arquivo.objectKey }));
      await this.db.update(storedFiles).set({ status: 'REJECTED', rejectionReason: motivo }).where(eq(storedFiles.id, fileId));
      throw new DomainError('FILE_REJECTED', motivo);
    }

    const sha256 = createHash('sha256').update(conteudo).digest('hex');
    let publicUrl: string | null = null;
    let bucket = arquivo.bucket;
    const objectKey = `files/${arquivo.purpose}/${fileId}.${EXTENSION[detectado!]}`;

    if (regra.public) {
      bucket = this.config.S3_PUBLIC_BUCKET;
      await this.s3.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          CopySource: `${arquivo.bucket}/${arquivo.objectKey}`,
          ContentType: detectado!,
          MetadataDirective: 'REPLACE',
          // Imagens públicas são imutáveis (nome = id): cache longo na CDN.
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      publicUrl = `${this.config.S3_PUBLIC_BASE_URL.replace(/\/$/, '')}/${objectKey}`;
    } else {
      await this.s3.send(new CopyObjectCommand({ Bucket: bucket, Key: objectKey, CopySource: `${arquivo.bucket}/${arquivo.objectKey}` }));
    }
    await this.s3.send(new DeleteObjectCommand({ Bucket: arquivo.bucket, Key: arquivo.objectKey }));

    await this.db
      .update(storedFiles)
      .set({ status: 'VALIDATED', detectedMimeType: detectado, sha256, publicUrl, bucket, objectKey, validatedAt: new Date() })
      .where(and(eq(storedFiles.id, fileId), eq(storedFiles.status, 'PENDING_UPLOAD')));
    return { id: fileId, publicUrl, mimeType: detectado!, sha256 };
  }

  /** URLs públicas de arquivos validados (para montar galerias). */
  async publicUrls(fileIds: string[]): Promise<Map<string, string>> {
    if (fileIds.length === 0) return new Map();
    const linhas = await this.db
      .select({ id: storedFiles.id, url: storedFiles.publicUrl })
      .from(storedFiles)
      .where(and(inArray(storedFiles.id, fileIds), eq(storedFiles.status, 'VALIDATED')));
    return new Map(linhas.filter((l) => l.url).map((l) => [l.id, l.url!]));
  }

  /** Metadados de arquivos validados. */
  async filesInfo(fileIds: string[]): Promise<Map<string, StoredFileInfo>> {
    if (fileIds.length === 0) return new Map();
    const linhas = await this.db
      .select()
      .from(storedFiles)
      .where(and(inArray(storedFiles.id, fileIds), eq(storedFiles.status, 'VALIDATED')));
    return new Map(
      linhas.map((l) => [
        l.id,
        { id: l.id, ownerUserId: l.ownerUserId, purpose: l.purpose, mimeType: l.detectedMimeType!, sizeBytes: l.declaredSizeBytes, sha256: l.sha256! },
      ]),
    );
  }

  /** Arquivos validados com o mesmo conteúdo (SHA-256), exceto os informados. */
  async filesWithSameContent(sha256: string, exceptIds: string[]): Promise<string[]> {
    const linhas = await this.db
      .select({ id: storedFiles.id })
      .from(storedFiles)
      .where(and(eq(storedFiles.sha256, sha256), eq(storedFiles.status, 'VALIDATED')));
    return linhas.map((l) => l.id).filter((id) => !exceptIds.includes(id));
  }

  /** Conteúdo de um arquivo validado (para leitura de XML/QR no worker ou na API). */
  async readValidated(fileId: string): Promise<Buffer> {
    const [arquivo] = await this.db.select().from(storedFiles).where(eq(storedFiles.id, fileId)).limit(1);
    if (!arquivo || arquivo.status !== 'VALIDATED') throw notFound('Arquivo');
    const conteudo = await this.download(arquivo.bucket, arquivo.objectKey);
    if (!conteudo) throw notFound('Arquivo');
    return conteudo;
  }

  /**
   * Link temporário para ver um arquivo privado. Quem pode ver é decidido
   * pelo módulo dono do arquivo antes de chamar aqui.
   */
  async signedDownloadUrl(fileId: string): Promise<{ url: string; expiresAt: string }> {
    const [arquivo] = await this.db.select().from(storedFiles).where(eq(storedFiles.id, fileId)).limit(1);
    if (!arquivo || arquivo.status !== 'VALIDATED') throw notFound('Arquivo');
    const url = await getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: arquivo.bucket,
        Key: arquivo.objectKey,
        ResponseContentType: arquivo.detectedMimeType ?? undefined,
        // Abre no navegador sem executar nada: XML e PDF não viram página do nosso domínio.
        ResponseContentDisposition: `inline; filename="${arquivo.id}.${EXTENSION[arquivo.detectedMimeType as DetectedType] ?? 'bin'}"`,
      }),
      { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
    );
    return { url, expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString() };
  }

  async assertOwnedValidated(fileId: string, ownerUserId: string): Promise<void> {
    const [arquivo] = await this.db.select().from(storedFiles).where(eq(storedFiles.id, fileId)).limit(1);
    if (!arquivo || arquivo.ownerUserId !== ownerUserId) throw notFound('Arquivo');
    if (arquivo.status !== 'VALIDATED') throw new DomainError('FILE_NOT_VALIDATED', 'Confirme o envio do arquivo antes de usá-lo');
  }

  private async download(bucket: string, key: string): Promise<Buffer | null> {
    try {
      const resposta = await this.s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const bytes = await resposta.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    } catch (error) {
      if ((error as { name?: string }).name === 'NoSuchKey') return null;
      throw error;
    }
  }
}
