import { ConfigService } from '@nestjs/config';
import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SmtpEmailService } from '../common/email/smtp-email.service.js';

export type RegistrationEmailKind =
  'ACCEPTED' | 'REJECTED' | 'PROMOTED' | 'CONFIRMED';

export interface RegistrationEmail {
  kind: RegistrationEmailKind;
  registrationId: number;
  to: string | null;
  recipientName: string;
  eventName: string;
  // Set for ACCEPTED and PROMOTED: the member must confirm before this time.
  confirmationDeadline?: Date;
  // Set for CONFIRMED: inline QR and a PNG attachment are sent to the member.
  attendanceQrCodeDataUrl?: string;
  eventStartsAt?: Date;
  eventLocation?: string | null;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] ?? character,
  );
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'Asia/Riyadh',
  }).format(date);
}

@Injectable()
export class RegistrationEmailService {
  private readonly logger = new Logger(RegistrationEmailService.name);

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(SmtpEmailService) private readonly smtp: SmtpEmailService,
  ) {}

  async send(email: RegistrationEmail): Promise<void> {
    if (!email.to) {
      this.logger.warn({
        event: 'registration_email_skipped',
        reason: 'NO_EMAIL_ADDRESS',
        kind: email.kind,
        registrationId: email.registrationId,
      });
      return;
    }

    const from = this.config.get<string>('AUTH_EMAIL_FROM');
    if (!this.smtp.isConfigured() || !from) {
      throw new ServiceUnavailableException(
        'Event email delivery is not configured.',
      );
    }

    const frontendUrl =
      this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    const eventUrl = new URL('/en/registrations', frontendUrl).toString();
    const details = [
      email.confirmationDeadline
        ? `Confirm your place by ${formatDate(email.confirmationDeadline)}.`
        : '',
      email.eventStartsAt
        ? `Event date: ${formatDate(email.eventStartsAt)}.`
        : '',
      email.eventLocation ? `Location: ${email.eventLocation}.` : '',
    ].filter(Boolean);
    const attachments: {
      filename: string;
      content: Buffer;
      contentType: string;
      cid?: string;
    }[] = [];
    let qrHtml = '';
    if (email.kind === 'CONFIRMED') {
      const match = email.attendanceQrCodeDataUrl?.match(
        /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/,
      );
      if (!match) throw new Error('Attendance QR image is missing or invalid.');
      attachments.push({
        filename: 'event-attendance-qr.png',
        content: Buffer.from(match[1], 'base64'),
        contentType: 'image/png',
        cid: 'event-attendance-qr',
      });
      qrHtml =
        '<p><img src="cid:event-attendance-qr" alt="Event attendance QR code" width="240" height="240"></p><p>The QR code is also attached as a PNG file. Show it to the PR team at the event entrance.</p>';
    }

    const subject =
      email.kind === 'REJECTED'
        ? `Update on your registration: ${email.eventName}`
        : email.kind === 'CONFIRMED'
          ? `Your attendance is confirmed: ${email.eventName}`
          : `You have a place at ${email.eventName} - please confirm`;
    const requiresResponse =
      email.kind === 'ACCEPTED' || email.kind === 'PROMOTED';
    const message =
      email.kind === 'REJECTED'
        ? `Your registration for ${email.eventName} was not accepted this time.`
        : email.kind === 'CONFIRMED'
          ? `Your attendance for ${email.eventName} is confirmed. Your QR code is below and attached.`
          : email.kind === 'PROMOTED'
            ? `Good news, ${email.recipientName}: a place has become available for ${email.eventName}. Confirm it before the deadline.`
            : `Good news, ${email.recipientName}: your registration for ${email.eventName} has been accepted. Please confirm your place before the deadline.`;
    const text = [
      message,
      ...details,
      requiresResponse
        ? `Open your event registration to confirm or decline: ${eventUrl}`
        : '',
      email.kind === 'CONFIRMED'
        ? 'Your attendance QR code is attached. Show it to the PR team at the event entrance.'
        : '',
      '',
      'GDG on Campus - University of Jeddah',
    ]
      .filter(Boolean)
      .join('\n');
    const responseLink = requiresResponse
      ? `<a href="${escapeHtml(eventUrl)}">Open your event registration</a>`
      : '';
    const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#202124;line-height:1.6"><h2>${escapeHtml(subject)}</h2><p>${escapeHtml(message)}</p>${details.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}${qrHtml}<p>${responseLink}</p><p>GDG on Campus - University of Jeddah</p></body></html>`;
    await this.smtp.sendMail({
      from,
      to: email.to,
      subject,
      text,
      html,
      attachments,
    }, { unavailableMessage: 'Event email delivery is not configured.' });
    this.logger.log({
      event: 'registration_email_sent',
      kind: email.kind,
      registrationId: email.registrationId,
    });
  }

  // Email delivery failures never undo an already committed registration change.
  async sendSafely(email: RegistrationEmail): Promise<void> {
    try {
      await this.send(email);
    } catch (error) {
      const code =
        error &&
        typeof error === 'object' &&
        'code' in error &&
        typeof error.code === 'string'
          ? error.code
          : undefined;
      this.logger.error({
        event: 'registration_email_failed',
        kind: email.kind,
        registrationId: email.registrationId,
        error: code ?? (error instanceof Error ? error.name : 'UNKNOWN'),
      });
    }
  }
}
