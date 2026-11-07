import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { AttendanceTokenService } from '../event-registrations/attendance-token.service.js';
import { AttendanceMethod, RegistrationStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CommitteeAccessService,
  REGISTRATIONS_REVIEW,
} from './committee-access.service.js';
import { registrationForbidden } from './registration-errors.js';
import { inEventTransaction, lockEvent } from './event-seats.js';

// Approved window: scanning opens one hour before the event starts and
// closes when it ends.
const OPENS_BEFORE_START_MS = 60 * 60 * 1000;

// Unknown token, wrong event, or a registration that is no longer
// confirmed all get the same answer, so a scan reveals nothing else.
function invalidQrCode(): BadRequestException {
  return new BadRequestException('Invalid QR Code.', {
    errorCode: 'INVALID_QR_CODE',
  });
}

function alreadyCheckedIn(): ConflictException {
  return new ConflictException('Already Checked In.', {
    errorCode: 'ALREADY_CHECKED_IN',
  });
}

function checkInClosed(): ConflictException {
  return new ConflictException(
    'Check-in opens one hour before the event and closes when it ends.',
    { errorCode: 'CHECK_IN_CLOSED' },
  );
}

@Injectable()
export class CheckInService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CommitteeAccessService)
    private readonly access: CommitteeAccessService,
  ) {}

  async checkIn(eventId: number, token: string, staffMemberId: number) {
    if (
      !(await this.access.hasCommitteePermission(
        staffMemberId,
        REGISTRATIONS_REVIEW,
      ))
    ) {
      throw registrationForbidden();
    }

    return inEventTransaction(this.prisma, async (tx) => {
      const event = await lockEvent(tx, eventId);
      const barcodeHash = AttendanceTokenService.hash(token);
      const select = {
        registrationId: true,
        eventId: true,
        status: true,
        checkedInAt: true,
        person: { select: { fullName: true, isActive: true } },
      } as const;
      let registration = await tx.eventRegistration.findUnique({
        where: { attendanceTokenHash: barcodeHash },
        select,
      });
      if (!registration) {
        const alias = await tx.walletBarcodeAlias.findFirst({
          where: {
            barcodeHash,
            revokedAt: null,
            link: { revokedAt: null, member: { isActive: true, person: { isActive: true } } },
          },
          select: { link: { select: { member: { select: { personId: true } } } } },
        });
        if (alias) registration = await tx.eventRegistration.findFirst({
          where: {
            eventId,
            personId: alias.link.member.personId,
            OR: [{ attendanceMethod: null }, { attendanceMethod: AttendanceMethod.MEMBER_CARD }],
          },
          select,
        });
      }
      if (
        !registration || registration.eventId !== eventId || !registration.person.isActive ||
        registration.status !== RegistrationStatus.CONFIRMED
      ) throw invalidQrCode();
      if (registration.checkedInAt) throw alreadyCheckedIn();

      const now = new Date();
      if (!event.published || now.getTime() < event.startsAt.getTime() - OPENS_BEFORE_START_MS || now >= event.endsAt) {
        throw checkInClosed();
      }
      const { count } = await tx.eventRegistration.updateMany({
        where: { registrationId: registration.registrationId, status: RegistrationStatus.CONFIRMED, checkedInAt: null },
        data: { checkedInAt: now, checkedInByMemberId: staffMemberId },
      });
      if (count === 0) throw alreadyCheckedIn();
      return { registrationId: registration.registrationId, name: registration.person.fullName, checkedInAt: now };
    });
  }
}
