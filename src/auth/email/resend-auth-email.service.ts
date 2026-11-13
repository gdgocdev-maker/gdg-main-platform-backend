import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { renderAuthEmail, type AuthEmailKind, type AuthLocale } from './auth-email.js';

@Injectable()
export class ResendAuthEmailService {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  async send(input: { to: string; kind: AuthEmailKind; locale: AuthLocale; url: string; code?: string }) {
    const key = this.config.getOrThrow<string>('RESEND_API_KEY');
    const from = this.config.getOrThrow<string>('EMAIL_FROM');
    const rendered = renderAuthEmail({ ...input, frontendOrigin: this.config.getOrThrow<string>('FRONTEND_URL') });
    try {
      const { data, error } = await new Resend(key).emails.send({ from, to: input.to, ...rendered });
      if (error) throw new Error('Delivery rejected');
      return data?.id;
    } catch {
      // Provider errors may contain recipients or message content; never expose them.
      throw new ServiceUnavailableException('Could not send authentication email. Please try again.');
    }
  }
}
