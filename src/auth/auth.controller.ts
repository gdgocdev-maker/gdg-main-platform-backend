import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { apiSuccess } from '../common/http/api-response.js';
import type { RequestUser } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { CheckEmailDto } from './check-email.dto.js';
import { LoginDto } from './login.dto.js';
import { RequestSetupLinkDto, SetupPasswordDto } from './setup-password.dto.js';
import { SignupDto } from './signup.dto.js';
import { VerifySignupEmailDto } from './verify-signup-email.dto.js';
import { RefreshSessionDto } from './refresh-session.dto.js';

@Controller()
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('auth/login')
  @HttpCode(200)
  async login(@Body() body: LoginDto) {
    return apiSuccess(await this.auth.login(body));
  }

  @Post('auth/check-email')
  @HttpCode(200)
  async checkEmail(@Body() body: CheckEmailDto) {
    return apiSuccess(await this.auth.checkEmail(body));
  }

  @Post('auth/signup')
  async signup(@Body() body: SignupDto) {
    return apiSuccess(await this.auth.signup(body));
  }

  @Post('auth/verify-email')
  @HttpCode(200)
  async verifySignupEmail(@Body() body: VerifySignupEmailDto) {
    return apiSuccess(await this.auth.verifySignupEmail(body.email, body.token));
  }

  @Post('auth/refresh')
  @HttpCode(200)
  async refresh(@Body() body: RefreshSessionDto) {
    return apiSuccess(await this.auth.refreshSession(body.refreshToken));
  }

  @Post('auth/setup-password/request')
  @HttpCode(200)
  async requestSetupLink(@Body() body: RequestSetupLinkDto) {
    await this.auth.requestSetupLink(body);
    return apiSuccess(null, 'A link to set your password was sent by email.');
  }

  @Post('auth/setup-password')
  @HttpCode(200)
  async setupPassword(
    @Req() request: { user?: RequestUser },
    @Body() body: SetupPasswordDto,
  ) {
    if (!request.user) throw new UnauthorizedException();
    return apiSuccess(await this.auth.setupPassword(request.user, body));
  }

  @Get('me')
  async me(@Req() request: { user?: RequestUser }) {
    if (!request.user) throw new UnauthorizedException();
    return apiSuccess(await this.auth.me(request.user));
  }
}
