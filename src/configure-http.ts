import { toNodeHandler } from 'better-auth/node';
import { BetterAuthService } from './auth/better-auth.service.js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { getAllowedFrontendOrigins } from './common/http/frontend-origins.js';

export function configureHttp(app: NestExpressApplication) {
  app.enableShutdownHooks();
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  if (!Number.isSafeInteger(trustProxyHops) || trustProxyHops < 0) {
    throw new Error('TRUST_PROXY_HOPS must be a non-negative integer.');
  }
  app.getHttpAdapter().getInstance().set('trust proxy', trustProxyHops);
  app.enableCors({
    origin: getAllowedFrontendOrigins(),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  });
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (process.env.NODE_ENV === 'production') response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  const authHandler = toNodeHandler(app.get(BetterAuthService).auth);
  app.getHttpAdapter().getInstance().all('/api/auth/{*path}', (request: Request, response: Response) => {
    // Never trust a caller-supplied auth IP header. Express resolves the configured proxy chain.
    request.headers['x-gdg-client-ip'] = request.ip ?? request.socket.remoteAddress ?? '127.0.0.1';
    return authHandler(request, response);
  });
  app.useBodyParser('json');
  app.useBodyParser('urlencoded', { extended: true });
}
