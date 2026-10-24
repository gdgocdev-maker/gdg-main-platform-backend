import {
  type CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../auth/auth.service.js';

interface AuthRequest {
  headers: { authorization?: string };
}

@Injectable()
export class VerifiedSupabaseEmailGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const token = request.headers.authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token) throw new UnauthorizedException();
    if (!(await this.auth.isEmailVerified(token))) {
      throw new ForbiddenException('Verify your email before applying for membership.');
    }
    return true;
  }
}
