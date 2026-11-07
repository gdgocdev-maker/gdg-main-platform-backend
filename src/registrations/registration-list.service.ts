import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  BlacklistReason,
  EventStatus,
  Prisma,
  RegistrationStatus,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CommitteeAccessService,
  REGISTRANTS_VIEW,
  REGISTRATIONS_REVIEW,
} from './committee-access.service.js';
import {
  blacklistEntryNotFound,
  registrationForbidden,
} from './registration-errors.js';
import type { DataEventReportGroup } from './registration.dto.js';

const PR_COMMITTEE_CODE = 'PR';
const DATA_COMMITTEE_CODE = 'DATA';

export interface RegistrationListQuery {
  page: number;
  pageSize: number;
  search?: string;
  status?: RegistrationStatus;
}

// Membership, university, and committee details come from the account, so
// attendees cannot self-report them. Phone and major are shared when requested.
export function registrantProfile(
  person: {
    phoneNumber: string | null;
    major: string | null;
    university?: string | null;
    member: {
      isActive: boolean;
      committees?: { committee: { committeeName: string } }[];
    } | null;
  },
  requiredFields: string[],
) {
  const committees = person.member?.isActive
    ? (person.member.committees ?? []).map(({ committee }) => committee.committeeName)
    : [];
  return {
    membership: person.member?.isActive === true,
    ...(person.university ? { university: person.university } : {}),
    ...(committees.length ? { committees: committees.join(', ') } : {}),
    ...(requiredFields.includes('phone') ? { phone: person.phoneNumber } : {}),
    ...(requiredFields.includes('major') ? { major: person.major } : {}),
  };
}

@Injectable()
export class RegistrationListService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CommitteeAccessService)
    private readonly access: CommitteeAccessService,
  ) {}

  async listDataReportEvents(actorMemberId: number) {
    await this.assertDataCommitteeLeader(actorMemberId);
    const events = await this.prisma.event.findMany({
      where: { status: { not: EventStatus.DRAFT } },
      orderBy: [{ startsAt: 'desc' }, { eventId: 'desc' }],
      select: {
        eventId: true,
        name: true,
        startsAt: true,
        status: true,
        _count: { select: { registrations: true } },
      },
    });
    const eventIds = events.map(({ eventId }) => eventId);
    if (eventIds.length === 0) return [];
    const [goingRows, checkedInRows] = await Promise.all([
      this.prisma.eventRegistration.groupBy({
        by: ['eventId'],
        where: {
          eventId: { in: eventIds },
          status: RegistrationStatus.CONFIRMED,
        },
        _count: { _all: true },
      }),
      this.prisma.eventRegistration.groupBy({
        by: ['eventId'],
        where: { eventId: { in: eventIds }, checkedInAt: { not: null } },
        _count: { _all: true },
      }),
    ]);
    const goingByEvent = new Map(
      goingRows.map((row) => [row.eventId, row._count._all]),
    );
    const checkedInByEvent = new Map(
      checkedInRows.map((row) => [row.eventId, row._count._all]),
    );
    return events.map(({ _count, ...event }) => ({
      ...event,
      registered: _count.registrations,
      going: goingByEvent.get(event.eventId) ?? 0,
      checkedIn: checkedInByEvent.get(event.eventId) ?? 0,
    }));
  }

  async getDataEventReport(
    eventId: number,
    group: DataEventReportGroup,
    actorMemberId: number,
  ) {
    await this.assertDataCommitteeLeader(actorMemberId);
    const event = await this.prisma.event.findFirst({
      where: { eventId, status: { not: EventStatus.DRAFT } },
      select: { eventId: true, name: true },
    });
    if (!event)
      throw new NotFoundException('The event was not found.', {
        errorCode: 'EVENT_NOT_FOUND',
      });
    const where: Prisma.EventRegistrationWhereInput = {
      eventId,
      ...(group === 'going' ? { status: RegistrationStatus.CONFIRMED } : {}),
      ...(group === 'checked-in' ? { checkedInAt: { not: null } } : {}),
    };
    const rows = await this.prisma.eventRegistration.findMany({
      where,
      orderBy: [{ registeredAt: 'asc' }, { registrationId: 'asc' }],
      select: {
        status: true,
        registeredAt: true,
        checkedInAt: true,
        discoverySource: true,
        person: {
          select: {
            fullName: true,
            emailPersonal: true,
            emailUniversity: true,
          },
        },
      },
    });
    return {
      event,
      group,
      items: rows.map((row) => ({
        name: row.person.fullName,
        email: row.person.emailPersonal ?? row.person.emailUniversity,
        status: row.status,
        registeredAt: row.registeredAt,
        checkedInAt: row.checkedInAt,
        discoverySource: row.discoverySource,
      })),
    };
  }

  private async assertDataCommitteeLeader(actorMemberId: number) {
    if (
      !(await this.access.isCommitteeLeader(actorMemberId, DATA_COMMITTEE_CODE))
    ) {
      throw registrationForbidden();
    }
  }

  async list(
    eventId: number,
    query: RegistrationListQuery,
    actorMemberId: number,
  ) {
    if (
      !(await this.access.hasCommitteePermission(
        actorMemberId,
        REGISTRANTS_VIEW,
      ))
    ) {
      throw registrationForbidden();
    }

    const event = await this.prisma.event.findUnique({
      where: { eventId },
      select: {
        eventId: true,
        name: true,
        capacity: true,
        requiredRegistrantFields: true,
      },
    });
    if (!event) {
      throw new NotFoundException('The event was not found.', {
        errorCode: 'EVENT_NOT_FOUND',
      });
    }

    const search = query.search?.trim();
    const where: Prisma.EventRegistrationWhereInput = {
      eventId,
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            person: {
              OR: [
                { fullName: { contains: search, mode: 'insensitive' } },
                { emailPersonal: { contains: search, mode: 'insensitive' } },
                { emailUniversity: { contains: search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };

    const [total, rows, counts, checkedIn] = await this.prisma.$transaction([
      this.prisma.eventRegistration.count({ where }),
      this.prisma.eventRegistration.findMany({
        where,
        orderBy: [{ registeredAt: 'asc' }, { registrationId: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          registrationId: true,
          status: true,
          registeredAt: true,
          waitlistPosition: true,
          confirmationDeadline: true,
          checkedInAt: true,
          emailDeliveries: { orderBy: { id: 'desc' }, take: 1, select: { state: true } },
          discoverySource: true,
          person: {
            select: {
              fullName: true,
              emailPersonal: true,
              emailUniversity: true,
              phoneNumber: true,
              major: true,
              university: true,
              member: {
                select: {
                  isActive: true,
                  committees: {
                    select: { committee: { select: { committeeName: true } } },
                    orderBy: { committeeId: 'asc' },
                  },
                },
              },
              // Any open entry from any event marks the person; it never
              // blocks registering, it only informs PR's review.
              registrations: {
                where: { blacklistEntries: { some: { resolvedAt: null } } },
                select: { registrationId: true },
                take: 1,
              },
            },
          },
          answers: {
            orderBy: { question: { position: 'asc' } },
            select: {
              questionId: true,
              answerText: true,
              question: { select: { questionText: true } },
            },
          },
        },
      }),
      this.prisma.eventRegistration.groupBy({
        by: ['status'],
        where: { eventId },
        _count: { _all: true },
      }),
      this.prisma.eventRegistration.count({
        where: { eventId, checkedInAt: { not: null } },
      }),
    ]);

    const countOf = (status: RegistrationStatus) =>
      counts.find((row) => row.status === status)?._count._all ?? 0;
    const confirmed = countOf(RegistrationStatus.CONFIRMED);

    return {
      event: {
        eventId: event.eventId,
        name: event.name,
        capacity: event.capacity,
      },
      summary: {
        accepted: countOf(RegistrationStatus.AWAITING_CONFIRMATION) + confirmed,
        capacity: event.capacity,
        confirmed,
        awaitingConfirmation: countOf(RegistrationStatus.AWAITING_CONFIRMATION),
        waitlisted: countOf(RegistrationStatus.WAITLISTED),
        pending: countOf(RegistrationStatus.PENDING),
        // Attendance: confirmed people who scanned in, and those who have
        // not (still CONFIRMED without a scan, or marked NO_CHECK_IN).
        checkedIn,
        notCheckedIn:
          confirmed - checkedIn + countOf(RegistrationStatus.NO_CHECK_IN),
      },
      items: rows.map((row) => ({
        registrationId: row.registrationId,
        name: row.person.fullName,
        email: row.person.emailPersonal ?? row.person.emailUniversity,
        profile: registrantProfile(
          row.person,
          event.requiredRegistrantFields.filter(
            (field) => field !== 'universityId',
          ),
        ),
        blacklisted: row.person.registrations.length > 0,
        status: row.status,
        registeredAt: row.registeredAt,
        waitlistPosition: row.waitlistPosition,
        confirmationDeadline: row.confirmationDeadline,
        emailState: row.emailDeliveries[0]?.state ?? null,
        checkedInAt: row.checkedInAt,
        discoverySource: row.discoverySource,
        answers: row.answers.map((answer) => ({
          questionId: answer.questionId,
          question: answer.question.questionText,
          answer: answer.answerText,
        })),
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async listBlacklist(
    query: Pick<RegistrationListQuery, 'page' | 'pageSize'>,
    actorMemberId: number,
  ) {
    if (
      !(await this.access.hasCommitteePermission(
        actorMemberId,
        REGISTRATIONS_REVIEW,
      ))
    ) {
      throw registrationForbidden();
    }

    const canResolve = await this.access.isCommitteeLeader(
      actorMemberId,
      PR_COMMITTEE_CODE,
    );
    // A removed person is no longer on the blacklist, so only open entries show.
    const where = {
      resolvedAt: null,
      reason: { in: [BlacklistReason.NO_CHECK_IN, BlacklistReason.LATE_CANCELLATION] },
    };
    const [total, entries] = await this.prisma.$transaction([
      this.prisma.registrationBlacklistEntry.count({ where }),
      this.prisma.registrationBlacklistEntry.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { entryId: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          entryId: true,
          reason: true,
          createdAt: true,
          resolvedAt: true,
          resolutionReason: true,
          registration: {
            select: {
              registrationId: true,
              status: true,
              registeredAt: true,
              checkedInAt: true,
              person: {
                select: {
                  fullName: true,
                  emailPersonal: true,
                  emailUniversity: true,
                },
              },
              event: {
                select: { eventId: true, name: true, startsAt: true },
              },
            },
          },
        },
      }),
    ]);

    return {
      canResolve,
      items: entries.map(({ registration, ...entry }) => ({
        ...entry,
        registration: {
          registrationId: registration.registrationId,
          status: registration.status,
          registeredAt: registration.registeredAt,
          checkedInAt: registration.checkedInAt,
          name: registration.person.fullName,
          email:
            registration.person.emailPersonal ??
            registration.person.emailUniversity,
          event: registration.event,
        },
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  // Removing someone resolves every open entry they have, so they leave the
  // blacklist and the PR registrants list stops flagging them. Rows are kept
  // in the database as history.
  async resolveBlacklist(
    entryId: number,
    reason: string | undefined,
    actorMemberId: number,
  ) {
    if (
      !(await this.access.isCommitteeLeader(actorMemberId, PR_COMMITTEE_CODE))
    ) {
      throw registrationForbidden();
    }

    const entry = await this.prisma.registrationBlacklistEntry.findUnique({
      where: { entryId },
      select: { registration: { select: { personId: true } } },
    });
    if (!entry) throw blacklistEntryNotFound();

    const { count } = await this.prisma.registrationBlacklistEntry.updateMany({
      where: {
        resolvedAt: null,
        registration: { personId: entry.registration.personId },
      },
      data: {
        resolvedAt: new Date(),
        resolvedByMemberId: actorMemberId,
        resolutionReason: reason?.trim() || 'Removed by PR leadership',
      },
    });
    return { entryId, resolvedEntries: count };
  }
}
