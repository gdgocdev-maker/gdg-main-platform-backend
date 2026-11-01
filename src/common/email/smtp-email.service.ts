import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type SendMailOptions } from 'nodemailer';

export interface SmtpSendOptions {
  unavailableMessage?: string;
  sendErrorMessage?: string;
}

@Injectable()
export class SmtpEmailService {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return this.smtpConfig() !== null;
  }

  getFromAddress(): string | undefined {
    return this.config.get<string>('AUTH_EMAIL_FROM');
  }

  async sendMail(message: SendMailOptions, options: SmtpSendOptions = {}): Promise<void> {
    const smtpConfig = this.smtpConfig();
    if (!smtpConfig) {
      throw new ServiceUnavailableException(
        options.unavailableMessage ?? 'Email delivery is not configured.',
      );
    }

    const transporter = nodemailer.createTransport(smtpConfig);
    try {
      await transporter.sendMail(message);
    } catch (error) {
      if (options.sendErrorMessage) {
        throw new ServiceUnavailableException(options.sendErrorMessage);
      }
      throw error;
    } finally {
      transporter.close();
    }
  }

  private smtpConfig() {
    const host = this.config.get<string>('SMTP_HOST');
    const port = Number(this.config.get<string>('SMTP_PORT') ?? 465);
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS')?.replace(/\s+/g, '');
    if (!host || !Number.isInteger(port) || !user || !pass) {
      return null;
    }
    return {
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    };
  }
}
