import {
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import { IsDateString, IsIn } from 'class-validator';
import { AttendanceTokenService } from '../event-registrations/attendance-token.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { guestWalletScope } from './guest-wallet-scope.js';

const select = {
  registrationId: true,
  status: true,
  attendanceTokenEncrypted: true,
  person: {
    select: {
      fullName: true,
      isActive: true,
      emailPersonal: true,
      emailPersonalVerifiedAt: true,
    },
  },
  event: { select: { name: true, startsAt: true, endsAt: true, status: true } },
} satisfies Prisma.EventRegistrationSelect;

type Ticket = Prisma.EventRegistrationGetPayload<{ select: typeof select }>;

function eligible(row: Ticket) {
  return (
    row.status === 'CONFIRMED' &&
    row.person.isActive &&
    row.event.status === 'PUBLISHED' &&
    row.event.endsAt > new Date()
  );
}

class DeliveryResult {
  @IsDateString()
  lease: string;

  @IsIn(['SENT', 'FAILED', 'SKIPPED', 'RETRY'])
  state: 'SENT' | 'FAILED' | 'SKIPPED' | 'RETRY';
}

class DeliveryClaim {
  @IsDateString()
  startsAt: string;

  @IsDateString()
  endsAt: string;
}

@Controller('wallet-worker/v1/guest-tickets')
export class GuestWalletWorkerController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(AttendanceTokenService)
    private readonly tokens: AttendanceTokenService,
  ) {}

  private scope(
    authorization: string | undefined,
  ): Prisma.EventRegistrationWhereInput {
    const scope = guestWalletScope(this.config);
    if (!scope) throw new NotFoundException();
    const secret = (value: string) =>
      createHash('sha256').update(value).digest();
    if (
      !timingSafeEqual(
        secret(authorization ?? ''),
        secret(`Bearer ${scope.token}`),
      )
    ) {
      throw new UnauthorizedException();
    }
    return {
      attendanceMethod: 'GUEST_QR',
      event: { committee: { committeeCode: { in: scope.committeeCodes } } },
    };
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(
    @Headers('authorization') authorization: string | undefined,
    @Query('after') cursor?: string,
  ) {
    const scope = this.scope(authorization);
    const after = /^\d{1,10}$/.test(cursor ?? '') ? Number(cursor) : 0;
    if (after > 2_147_483_647) return { items: [], nextCursor: null };
    const rows = await this.prisma.eventRegistration.findMany({
      where: {
        AND: [
          scope,
          {
            registrationId: { gt: after },
            status: 'CONFIRMED',
            person: { isActive: true },
            event: { status: 'PUBLISHED', endsAt: { gt: new Date() } },
          },
        ],
      },
      orderBy: { registrationId: 'asc' },
      take: 51,
      select: { registrationId: true },
    });
    return {
      items: rows.slice(0, 50).map((row) => row.registrationId),
      nextCursor: rows.length > 50 ? rows[49].registrationId : null,
    };
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  async ticket(
    @Headers('authorization') authorization: string | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const row = await this.find(id, this.scope(authorization));
    if (!eligible(row) || !row.attendanceTokenEncrypted) {
      return {
        active: false as const,
        expired:
          row.status === 'CONFIRMED' &&
          row.person.isActive &&
          row.event.status === 'PUBLISHED' &&
          row.event.endsAt <= new Date(),
      };
    }
    return {
      active: true as const,
      name: row.person.fullName,
      title: row.event.name,
      startsAt: row.event.startsAt,
      endsAt: row.event.endsAt,
      barcode: this.tokens.reveal(row.attendanceTokenEncrypted),
    };
  }

  @Post(':id/email/claim')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async claim(
    @Headers('authorization') authorization: string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() issued: DeliveryClaim,
  ) {
    const scope = this.scope(authorization);
    return this.prisma.$transaction(async (tx) => {
      // Use the same event lock as schedule changes and confirmation. Recheck
      // after acquiring it so an old build cannot claim delivery for a new time.
      const target = await tx.eventRegistration.findFirst({
        where: { ...scope, registrationId: id },
        select: { eventId: true },
      });
      if (!target) throw new NotFoundException();
      await tx.$queryRaw`SELECT event_id FROM events WHERE event_id = ${target.eventId} FOR UPDATE`;
      const row = await this.find(id, scope, tx);
      if (
        !eligible(row) ||
        row.event.startsAt.getTime() !== Date.parse(issued.startsAt) ||
        row.event.endsAt.getTime() !== Date.parse(issued.endsAt)
      )
        throw new ConflictException();
      const delivery = await tx.registrationEmailDelivery.findFirst({
        where: { registrationId: id, kind: 'CONFIRMED' },
        orderBy: { id: 'desc' },
      });
      if (!delivery || delivery.state !== 'PENDING') return { email: null };
      if (!row.person.emailPersonal || !row.person.emailPersonalVerifiedAt) {
        await tx.registrationEmailDelivery.updateMany({
          where: { id: delivery.id, state: 'PENDING' },
          data: { state: 'FAILED' },
        });
        return { email: null };
      }
      const leaseExpiresAt = new Date(Date.now() + 10 * 60_000);
      const claimed = await tx.registrationEmailDelivery.updateMany({
        where: { id: delivery.id, state: 'PENDING' },
        data: { state: 'SENDING', leaseExpiresAt },
      });
      return {
        email: claimed.count
          ? { recipient: row.person.emailPersonal, lease: leaseExpiresAt }
          : null,
      };
    });
  }

  @Post(':id/email/result')
  @HttpCode(204)
  async result(
    @Headers('authorization') authorization: string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: DeliveryResult,
  ) {
    const row = await this.find(id, this.scope(authorization));
    const lease = new Date(body.lease);
    const updated = await this.prisma.registrationEmailDelivery.updateMany({
      where: {
        registrationId: row.registrationId,
        kind: 'CONFIRMED',
        state: 'SENDING',
        AND: [
          { leaseExpiresAt: lease },
          { leaseExpiresAt: { gt: new Date() } },
        ],
      },
      data: {
        state: body.state === 'RETRY' ? 'PENDING' : body.state,
        leaseExpiresAt: null,
      },
    });
    if (!updated.count) throw new ConflictException();
  }

  private async find(
    id: number,
    scope: Prisma.EventRegistrationWhereInput,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const row = await db.eventRegistration.findFirst({
      where: { ...scope, registrationId: id },
      select,
    });
    if (!row) throw new NotFoundException();
    return row;
  }
}
