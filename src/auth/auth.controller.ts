import { Body, Controller, Get, HttpCode, Inject, Patch, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { apiSuccess } from '../common/http/api-response.js';
import type { RequestUser } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { BetterAuthService } from './better-auth.service.js';
import { CheckEmailDto } from './check-email.dto.js';
import { SignupDto } from './signup.dto.js';
import { AuthRateLimit } from './auth-rate-limit.guard.js';
import { UpdateBioDto } from './update-bio.dto.js';
import { UpdateSocialLinksDto } from './update-social-links.dto.js';
import { GoogleSignupCompletionDto } from './google-auth.dto.js';

@Controller()
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(BetterAuthService) private readonly better: BetterAuthService) {}

  @Post('account/check-email')
  @HttpCode(200)
  @AuthRateLimit({ scope: 'check-email', dimension: 'ip', limit: 60, windowSeconds: 60 }, { scope: 'check-email', dimension: 'email', limit: 10, windowSeconds: 60 })
  async checkEmail(@Body() body: CheckEmailDto) { return apiSuccess(await this.auth.checkEmail(body)); }

  @Post('account/signup')
  @AuthRateLimit({ scope: 'signup', dimension: 'ip', limit: 20, windowSeconds: 3600 }, { scope: 'signup', dimension: 'email', limit: 5, windowSeconds: 86400 })
  async signup(@Body() body: SignupDto) { return apiSuccess(await this.auth.signup(body)); }

  @Get('account/profile-status')
  async profileStatus(@Req() request: Request) {
    const session = await this.better.session(request.headers);
    if (!session?.user.emailVerified) throw new UnauthorizedException();
    await this.auth.reconcileVerifiedIdentity(session.user);
    const user = (request as Request & { user?: RequestUser }).user;
    return apiSuccess({ nextStep: user ? 'SIGNED_IN' : 'COMPLETE_PROFILE', profile: { email: session.user.email, fullName: session.user.name } });
  }

  @Post('account/complete-profile')
  @HttpCode(200)
  @AuthRateLimit({ scope: 'complete-profile', dimension: 'ip', limit: 10, windowSeconds: 3600 })
  async completeGoogleSignup(@Req() request: Request, @Body() body: GoogleSignupCompletionDto) {
    const session = await this.better.session(request.headers);
    if (!session?.user.emailVerified) throw new UnauthorizedException();
    return apiSuccess(await this.auth.completeGoogleSignup(session.user, body));
  }

  @Get('me')
  async me(@Req() request: { user?: RequestUser }) {
    if (!request.user) throw new UnauthorizedException();
    return apiSuccess(await this.auth.me(request.user));
  }

  @Patch('me/bio')
  @AuthRateLimit({ scope: 'profile-bio-update', dimension: 'ip', limit: 30, windowSeconds: 3600 })
  async updateMyBio(
    @Req() request: { user?: RequestUser },
    @Body() body: UpdateBioDto,
  ) {
    if (!request.user) throw new UnauthorizedException();
    return apiSuccess(await this.auth.updateBio(request.user, body.bio));
  }

  @Patch('me/social-links')
  @AuthRateLimit({ scope: 'profile-social-links-update', dimension: 'ip', limit: 30, windowSeconds: 3600 })
  async updateMySocialLinks(
    @Req() request: { user?: RequestUser },
    @Body() body: UpdateSocialLinksDto,
  ) {
    if (!request.user) throw new UnauthorizedException();
    return apiSuccess(await this.auth.updateSocialLinks(request.user, body));
  }

}
