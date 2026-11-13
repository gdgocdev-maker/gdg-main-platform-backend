import {
  type CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { BetterAuthService } from '../auth/better-auth.service.js';

interface AuthRequest {
  headers: { authorization?: string; cookie?: string };
}

@Injectable()
export class VerifiedSupabaseEmailGuard implements CanActivate {
  constructor(@Inject(BetterAuthService) private readonly auth: BetterAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const session = await this.auth.session(request.headers);
    if (!session) throw new UnauthorizedException();
    if (!session.user.emailVerified) throw new ForbiddenException('Verify your email before applying for membership.');
    return true;
  }
}
