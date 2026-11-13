import { createHmac } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { SetMetadata } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

type RateLimitDimension = 'ip' | 'email' | 'refreshToken' | 'verificationToken';

export type AuthRateLimitRule = {
  scope: string;
  dimension: RateLimitDimension;
  limit: number;
  windowSeconds: number;
};

const AUTH_RATE_LIMIT_METADATA = 'auth:rate-limit';

export function AuthRateLimit(...rules: AuthRateLimitRule[]): MethodDecorator {
  return SetMetadata(AUTH_RATE_LIMIT_METADATA, rules);
}

interface RateLimitRequest {
  ip?: string;
  socket?: { remoteAddress?: string };
  body?: Record<string, unknown>;
  headers: { cookie?: string };
}

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(AuthRateLimitGuard.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rules = this.reflector.get<AuthRateLimitRule[]>(
      AUTH_RATE_LIMIT_METADATA,
      context.getHandler(),
    );
    if (!rules?.length) return true;

    const request = context.switchToHttp().getRequest<RateLimitRequest>();
    const secret = this.config.getOrThrow<string>('BETTER_AUTH_SECRET');
    for (const rule of rules) {
      const value = this.dimensionValue(request, rule.dimension);
      if (!value) continue;

      const bucketHash = createHmac('sha256', secret)
        .update(`auth-rate-limit-v1:${rule.scope}:${rule.dimension}:${rule.windowSeconds}:${value}`)
        .digest('hex');
      try {
        const rows = await this.prisma.$queryRaw<{ request_count: number }[]>`
          WITH current_window AS (
            SELECT to_timestamp(
              floor(extract(epoch FROM clock_timestamp()) / ${rule.windowSeconds}) * ${rule.windowSeconds}
            ) AS window_started_at
          )
          INSERT INTO auth_rate_limit_bucket AS current_bucket
            (bucket_hash, window_started_at, request_count)
          SELECT ${bucketHash}, current_window.window_started_at, 1
          FROM current_window
          ON CONFLICT (bucket_hash) DO UPDATE SET
            window_started_at = EXCLUDED.window_started_at,
            request_count = CASE
              WHEN current_bucket.window_started_at = EXCLUDED.window_started_at
                THEN current_bucket.request_count + 1
              ELSE 1
            END,
            updated_at = clock_timestamp()
          RETURNING request_count
        `;

        if ((rows[0]?.request_count ?? 0) > rule.limit) {
          throw new HttpException(
            'Too many requests. Please try again later.',
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
      } catch (error) {
        if (error instanceof HttpException) throw error;
        this.logger.error('Authentication rate-limit storage is unavailable.');
        throw new HttpException(
          'Authentication is temporarily unavailable.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
    }
    return true;
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async removeExpiredBuckets(): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        DELETE FROM auth_rate_limit_bucket
        WHERE window_started_at < clock_timestamp() - interval '48 hours'
      `;
    } catch {
      this.logger.warn('Could not clean expired authentication rate-limit buckets.');
    }
  }

  private dimensionValue(
    request: RateLimitRequest,
    dimension: RateLimitDimension,
  ): string | undefined {
    if (dimension === 'ip') {
      return request.ip || request.socket?.remoteAddress || 'unknown';
    }
    if (dimension === 'email') {
      const email = request.body?.email;
      return typeof email === 'string' ? email.trim().toLowerCase().slice(0, 255) || undefined : undefined;
    }
    const token = dimension === 'refreshToken'
      ? this.cookieValue(request.headers.cookie, 'gdg_refresh')
      : request.body?.tokenHash;
    return typeof token === 'string' ? token.slice(0, 512) || undefined : undefined;
  }

  private cookieValue(cookie: string | undefined, name: string): string | undefined {
    const pair = cookie?.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
    return pair ? decodeURIComponent(pair.slice(name.length + 1)) : undefined;
  }
}
