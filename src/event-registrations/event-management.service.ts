import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { apiValidationError } from '../common/http/api-response.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { eventNotFound } from '../registrations/event-seats.js';
import {
  CommitteeAccessService,
  EVENTS_CREATE,
} from '../registrations/committee-access.service.js';
import type {
  CreateEventDto,
  EventQuestionDto,
  EventQuestionUpdateDto,
  UpdateEventDto,
} from './event-management.dto.js';

const DATA_COMMITTEE_CODE = 'DATA';

function asQuestionData(question: EventQuestionDto, isNew = true) {
  return {
    questionText: question.questionText,
    questionType: question.questionType,
    ...(isNew || question.isRequired !== undefined
      ? { isRequired: question.isRequired ?? false }
      : {}),
    ...(question.options === undefined
      ? {}
      : {
          options:
            question.options === null ? Prisma.JsonNull : question.options,
        }),
  };
}

function asEventData(dto: CreateEventDto | UpdateEventDto) {
  return {
    ...('name' in dto && dto.name !== undefined ? { name: dto.name } : {}),
    ...('description' in dto && dto.description !== undefined
      ? { description: dto.description }
      : {}),
    ...('startsAt' in dto && dto.startsAt !== undefined
      ? { startsAt: new Date(dto.startsAt) }
      : {}),
    ...('endsAt' in dto && dto.endsAt !== undefined
      ? { endsAt: new Date(dto.endsAt) }
      : {}),
    ...('location' in dto && dto.location !== undefined
      ? { location: dto.location }
      : {}),
    ...('capacity' in dto && dto.capacity !== undefined
      ? { capacity: dto.capacity }
      : {}),
    ...('registrationDeadline' in dto && dto.registrationDeadline !== undefined
      ? { registrationDeadline: new Date(dto.registrationDeadline) }
      : {}),
    ...('confirmationWindowHours' in dto &&
    dto.confirmationWindowHours !== undefined
      ? { confirmationWindowHours: dto.confirmationWindowHours }
      : {}),
    ...('imageUrl' in dto && dto.imageUrl !== undefined
      ? { imageUrl: dto.imageUrl }
      : {}),
    ...('requirements' in dto && dto.requirements !== undefined
      ? { requirements: dto.requirements }
      : {}),
    ...('status' in dto && dto.status !== undefined
      ? { status: dto.status }
      : {}),
  };
}

@Injectable()
export class EventManagementService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CommitteeAccessService)
    private readonly access: CommitteeAccessService,
  ) {}

  async create(dto: CreateEventDto, memberId: number | null | undefined) {
    if (!memberId) throw this.forbidden();
    const committeeId = await this.requireDataEventPermission(memberId);
    this.validateQuestionOptions(dto.questions ?? []);

    return this.prisma.event.create({
      data: {
        ...asEventData(dto),
        name: dto.name,
        startsAt: new Date(dto.startsAt),
        endsAt: new Date(dto.endsAt),
        capacity: dto.capacity,
        registrationDeadline: new Date(dto.registrationDeadline),
        createdByMemberId: memberId,
        committeeId,
        questions: {
          create: (dto.questions ?? []).map((question, position) => ({
            ...asQuestionData(question),
            position,
          })),
        },
      },
      include: { questions: { orderBy: { position: 'asc' } } },
    });
  }

  async update(
    eventId: number,
    dto: UpdateEventDto,
    memberId: number | null | undefined,
  ) {
    const event = await this.prisma.event.findUnique({
      where: { eventId },
      select: { createdByMemberId: true },
    });
    if (!event) throw eventNotFound();

    await this.assertOwner(event.createdByMemberId, memberId);
    this.validateQuestionOptions(dto.questions ?? []);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.event.update({
          where: { eventId },
          data: asEventData(dto),
        });

        if (dto.questions !== undefined) {
          await this.replaceQuestions(tx, eventId, dto.questions);
        }

        return tx.event.findUniqueOrThrow({
          where: { eventId },
          include: { questions: { orderBy: { position: 'asc' } } },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new ConflictException(
          'A question with submitted answers cannot be removed.',
          { errorCode: 'QUESTION_HAS_ANSWERS' },
        );
      }
      throw error;
    }
  }

  async delete(eventId: number, memberId: number | null | undefined) {
    const event = await this.prisma.event.findUnique({
      where: { eventId },
      select: { createdByMemberId: true },
    });
    if (!event) throw eventNotFound();

    await this.assertOwner(event.createdByMemberId, memberId);

    const registrations = await this.prisma.eventRegistration.count({
      where: { eventId },
    });
    if (registrations > 0) {
      throw new ConflictException(
        'An event with registrations cannot be deleted.',
        { errorCode: 'EVENT_HAS_REGISTRATIONS' },
      );
    }

    try {
      await this.prisma.event.delete({ where: { eventId } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new ConflictException(
          'An event with registrations cannot be deleted.',
          { errorCode: 'EVENT_HAS_REGISTRATIONS' },
        );
      }
      throw error;
    }
  }

  async dashboardEvents(memberId: number | null | undefined) {
    if (!memberId) return [];

    const memberships = await this.prisma.memberCommittee.findMany({
      where: { memberId, member: { isActive: true } },
      select: { committeeId: true },
    });
    const committeeIds = memberships.map(({ committeeId }) => committeeId);

    return this.prisma.event.findMany({
      where: {
        OR: [
          { createdByMemberId: memberId },
          ...(committeeIds.length > 0
            ? [{ committeeId: { in: committeeIds } }]
            : []),
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { eventId: 'desc' }],
      include: {
        questions: { orderBy: { position: 'asc' } },
        committee: {
          select: {
            committeeId: true,
            committeeCode: true,
            committeeName: true,
          },
        },
      },
    });
  }

  private async requireDataEventPermission(
    memberId: number | null | undefined,
  ): Promise<number> {
    if (!memberId) throw this.forbidden();
    const committeeId = await this.access.committeeIdWithPermission(
      memberId,
      DATA_COMMITTEE_CODE,
      EVENTS_CREATE,
    );
    if (!committeeId) throw this.forbidden();
    return committeeId;
  }

  private async assertOwner(
    createdByMemberId: number,
    memberId: number | null | undefined,
  ) {
    await this.requireDataEventPermission(memberId);
    if (createdByMemberId !== memberId) throw this.forbidden();
  }

  private validateQuestionOptions(questions: EventQuestionDto[]) {
    const errors = questions.flatMap((question, index) => {
      const needsOptions = question.questionType !== 'TEXT';
      if (needsOptions && !question.options?.length) {
        return [
          {
            pointer: `/questions/${index}/options`,
            message: 'Choice questions must include at least one option.',
          },
        ];
      }
      return [];
    });
    if (errors.length > 0) {
      throw apiValidationError(errors);
    }
  }

  private async replaceQuestions(
    tx: Prisma.TransactionClient,
    eventId: number,
    questions: EventQuestionUpdateDto[],
  ) {
    const existing = await tx.eventQuestion.findMany({
      where: { eventId },
      select: {
        questionId: true,
        position: true,
        _count: { select: { answers: true } },
      },
    });
    const existingById = new Map(existing.map((row) => [row.questionId, row]));
    const requestedIds = new Set<number>();

    for (const question of questions) {
      if (question.questionId === undefined) continue;
      if (!existingById.has(question.questionId)) {
        throw this.invalidQuestionId();
      }
      if (requestedIds.has(question.questionId)) {
        throw apiValidationError([
          {
            pointer: '/questions',
            message: 'A question can only appear once.',
          },
        ]);
      }
      requestedIds.add(question.questionId);
    }

    const removed = existing.filter(
      ({ questionId }) => !requestedIds.has(questionId),
    );
    if (removed.some(({ _count }) => _count.answers > 0)) {
      throw new ConflictException(
        'A question with submitted answers cannot be removed.',
        { errorCode: 'QUESTION_HAS_ANSWERS' },
      );
    }
    if (removed.length > 0) {
      await tx.eventQuestion.deleteMany({
        where: {
          eventId,
          questionId: { in: removed.map((q) => q.questionId) },
        },
      });
    }

    const retained = existing.filter(({ questionId }) =>
      requestedIds.has(questionId),
    );
    const firstTemporaryPosition =
      retained.reduce(
        (maximum, question) => Math.max(maximum, question.position),
        0,
      ) +
      retained.length +
      1;
    for (const [index, question] of retained.entries()) {
      await tx.eventQuestion.update({
        where: { questionId: question.questionId },
        data: { position: firstTemporaryPosition + index },
      });
    }

    for (const [position, question] of questions.entries()) {
      const { questionId, ...data } = question;
      if (questionId === undefined) {
        await tx.eventQuestion.create({
          data: { ...asQuestionData(data), position, eventId },
        });
      } else {
        await tx.eventQuestion.update({
          where: { questionId },
          data: { ...asQuestionData(data, false), position },
        });
      }
    }
  }

  private invalidQuestionId() {
    return apiValidationError([
      {
        pointer: '/questions',
        message: 'Every questionId must belong to this event.',
      },
    ]);
  }

  private forbidden() {
    return new ForbiddenException(
      'Only a DATA Leader or Co-Leader who created the event can manage it.',
    );
  }
}
