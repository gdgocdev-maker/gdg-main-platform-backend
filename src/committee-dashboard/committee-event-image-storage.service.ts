import { BadGatewayException, BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const BUCKET = 'event-images';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

@Injectable()
export class CommitteeEventImageStorageService {
  private readonly logger = new Logger(CommitteeEventImageStorageService.name);
  private client?: SupabaseClient;
  private bucketReady?: Promise<void>;

  constructor(private readonly config: ConfigService) {}

  async upload(file: { buffer: Buffer; mimetype: string; size: number }) {
    return this.uploadToPath(file);
  }

  async uploadAnnouncementImage(file: { buffer: Buffer; mimetype: string; size: number }) {
    return this.uploadToPath(file, 'announcements');
  }

  private async uploadToPath(file: { buffer: Buffer; mimetype: string; size: number }, folder?: string) {
    if (!IMAGE_TYPES.has(file.mimetype) || file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
      throw new BadRequestException('Choose a JPEG, PNG, WebP, or GIF image up to 5 MB.');
    }
    const client = this.getClient();
    await this.ensureBucket(client);
    const objectName = `${randomUUID()}.${EXTENSION_BY_TYPE[file.mimetype]}`;
    const objectPath = folder ? `${folder}/${objectName}` : objectName;
    const { error } = await client.storage.from(BUCKET).upload(objectPath, file.buffer, {
      contentType: file.mimetype,
      cacheControl: '31536000',
      upsert: false,
    });
    if (error) {
      this.logStorageError('upload', error);
      throw new BadGatewayException('The event image could not be stored.');
    }
    return { imageUrl: client.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl };
  }

  private getClient() {
    try {
      this.client ??= createClient(
        this.config.getOrThrow<string>('SUPABASE_URL'),
        this.config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
    } catch {
      throw new BadGatewayException('Event image storage is unavailable.');
    }
    return this.client;
  }

  private ensureBucket(client: SupabaseClient) {
    this.bucketReady ??= (async () => {
      const { data, error } = await client.storage.listBuckets();
      if (error) {
        this.logStorageError('list_buckets', error);
        throw new BadGatewayException('Event image storage is unavailable.');
      }
      const existing = data.find((bucket) => bucket.name === BUCKET);
      if (existing) {
        if (!existing.public) {
          const { error: updateError } = await client.storage.updateBucket(BUCKET, {
            public: true,
            fileSizeLimit: MAX_IMAGE_BYTES,
            allowedMimeTypes: [...IMAGE_TYPES],
          });
          if (updateError) {
            this.logStorageError('update_bucket', updateError);
            throw new BadGatewayException('Event image storage is unavailable.');
          }
        }
        return;
      }
      const { error: createError } = await client.storage.createBucket(BUCKET, {
        public: true,
        fileSizeLimit: MAX_IMAGE_BYTES,
        allowedMimeTypes: [...IMAGE_TYPES],
      });
      if (createError && !/already exists/i.test(createError.message)) {
        this.logStorageError('create_bucket', createError);
        throw new BadGatewayException('Event image storage is unavailable.');
      }
    })().catch((error: unknown) => {
      this.bucketReady = undefined;
      throw error;
    });
    return this.bucketReady;
  }

  private logStorageError(operation: string, error: { message?: string; name?: string; statusCode?: string }) {
    const message = (error.message ?? 'Unknown storage error')
      .replace(/sb_(?:secret|publishable)_[\w-]+/g, '[redacted]')
      .slice(0, 240);
    this.logger.error({
      event: 'event_image_storage_failed',
      operation,
      errorName: error.name ?? 'StorageError',
      statusCode: error.statusCode,
      message,
    });
  }
}
