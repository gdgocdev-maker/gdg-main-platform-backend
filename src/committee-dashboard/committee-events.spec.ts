import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { CommitteeAccessService } from '../registrations/committee-access.service.js';
import type { CreateCommitteeEventDto } from './committee-dashboard.dto.js';
import { CommitteeDashboardService } from './committee-dashboard.service.js';

const findCommittee = vi.fn();
const findMembership = vi.fn();
const createEvent = vi.fn();
const hasCommitteePermission = vi.fn();
const service = new CommitteeDashboardService(
  {
    committee: { findUnique: findCommittee },
    memberCommittee: { findUnique: findMembership },
    event: { create: createEvent },
  } as unknown as PrismaService,
  { hasCommitteePermission } as unknown as CommitteeAccessService,
);

const day = 24 * 60 * 60 * 1000;
const validEvent = (): CreateCommitteeEventDto => ({
  name: '  Flutter Workshop ',
  description: 'Build an app.',
  eventType: 'Workshop',
  startsAt: new Date(Date.now() + 7 * day).toISOString(),
  endsAt: new Date(Date.now() + 7 * day + 2 * 60 * 60 * 1000).toISOString(),
  registrationDeadline: new Date(Date.now() + 5 * day).toISOString(),
  location: 'Building 1',
  capacity: 30,
  requiredRegistrantFields: ['phone', 'phone'],
  status: 'PUBLISHED',
  questions: [
    { text: ' Why? ', type: 'TEXT', required: true, options: ['ignored'] },
    { text: 'Level', type: 'RADIO', required: false, options: [' Beginner ', 'Advanced', 'Beginner', ''] },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  findCommittee.mockResolvedValue({ committeeId: 2, committeeCode: 'PR', committeeName: 'Public Relations' });
  findMembership.mockResolvedValue({ memberId: 12, member: { isActive: true, person: { isActive: true } } });
  hasCommitteePermission.mockResolvedValue(true);
  createEvent.mockResolvedValue({ eventId: 9, name: 'Flutter Workshop', status: 'PUBLISHED', startsAt: new Date(), registrationDeadline: new Date() });
});

describe('Committee leader creates an event', () => {
  it('requires events.create in that committee before saving anything', async () => {
    hasCommitteePermission.mockResolvedValue(false);
    await expect(service.createEvent({ personId: 8, memberId: 12 }, 'PR', validEvent())).rejects.toBeInstanceOf(ForbiddenException);
    expect(hasCommitteePermission).toHaveBeenCalledWith(12, 'events.create', undefined, 2);
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('rejects people who are not members of the committee', async () => {
    findMembership.mockResolvedValue(null);
    await expect(service.createEvent({ personId: 8, memberId: 12 }, 'PR', validEvent())).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.createEvent(undefined, 'PR', validEvent())).rejects.toBeInstanceOf(ForbiddenException);
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('rejects a deadline after the start, an end before the start and choice questions without two options', async () => {
    const event = validEvent();
    event.registrationDeadline = new Date(Date.now() + 8 * day).toISOString();
    event.endsAt = new Date(Date.now() + 6 * day).toISOString();
    event.questions = [{ text: 'Pick', type: 'SELECT', required: true, options: ['Only', ' Only '] }];

    const error = await service.createEvent({ personId: 8, memberId: 12 }, 'PR', event).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('saves the event for the committee with trimmed values and ordered questions', async () => {
    await expect(service.createEvent({ personId: 8, memberId: 12 }, 'PR', validEvent())).resolves.toMatchObject({ id: '9', eventId: 9 });
    const { data } = createEvent.mock.calls[0][0];
    expect(data).toMatchObject({
      name: 'Flutter Workshop',
      eventType: 'Workshop',
      status: 'PUBLISHED',
      committeeId: 2,
      createdByMemberId: 12,
      mapsLink: null,
      requiredRegistrantFields: ['phone'],
    });
    expect(data.questions.create).toEqual([
      { questionText: 'Why?', questionType: 'TEXT', isRequired: true, position: 1, options: Prisma.DbNull },
      { questionText: 'Level', questionType: 'RADIO', isRequired: false, position: 2, options: ['Beginner', 'Advanced'] },
    ]);
  });

  it('publishes only its own committee drafts, once', async () => {
    const findFirst = vi.fn();
    const updateMany = vi.fn();
    const publisher = new CommitteeDashboardService(
      {
        committee: { findUnique: findCommittee },
        memberCommittee: { findUnique: findMembership },
        event: { findFirst, updateMany },
      } as unknown as PrismaService,
      { hasCommitteePermission } as unknown as CommitteeAccessService,
    );
    const user = { personId: 8, memberId: 12 };

    findFirst.mockResolvedValueOnce(null);
    await expect(publisher.publishEvent(user, 'PR', 4)).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { eventId: 4, committeeId: 2 } }));

    findFirst.mockResolvedValueOnce({ status: 'PUBLISHED', registrationDeadline: new Date(Date.now() + day) });
    await expect(publisher.publishEvent(user, 'PR', 4)).rejects.toBeInstanceOf(ConflictException);

    findFirst.mockResolvedValueOnce({ status: 'DRAFT', registrationDeadline: new Date(Date.now() - day) });
    await expect(publisher.publishEvent(user, 'PR', 4)).rejects.toBeInstanceOf(BadRequestException);

    findFirst.mockResolvedValueOnce({ status: 'DRAFT', registrationDeadline: new Date(Date.now() + day) });
    updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(publisher.publishEvent(user, 'PR', 4)).resolves.toEqual({ id: '4', status: 'PUBLISHED' });
    expect(updateMany).toHaveBeenCalledWith({ where: { eventId: 4, status: 'DRAFT' }, data: { status: 'PUBLISHED' } });

    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('shows a committee its own events, drafts included, only to those who create events', async () => {
    const findFirst = vi.fn();
    const reader = new CommitteeDashboardService(
      {
        committee: { findUnique: findCommittee },
        memberCommittee: { findUnique: findMembership },
        event: { findFirst },
      } as unknown as PrismaService,
      { hasCommitteePermission } as unknown as CommitteeAccessService,
    );
    const user = { personId: 8, memberId: 12 };

    hasCommitteePermission.mockResolvedValueOnce(false);
    await expect(reader.getCommitteeEvent(user, 'PR', 4)).rejects.toBeInstanceOf(ForbiddenException);
    expect(findFirst).not.toHaveBeenCalled();

    findFirst.mockResolvedValueOnce(null);
    await expect(reader.getCommitteeEvent(user, 'PR', 4)).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { eventId: 4, committeeId: 2 } }));

    findFirst.mockResolvedValueOnce({ eventId: 4, name: 'Draft talk', status: 'DRAFT', questions: [], requiredRegistrantFields: [] });
    await expect(reader.getCommitteeEvent(user, 'PR', 4)).resolves.toMatchObject({ id: '4', status: 'DRAFT' });
  });

  it('deletes only its own committee drafts, never published events', async () => {
    const findFirst = vi.fn();
    const deleteMany = vi.fn();
    const remover = new CommitteeDashboardService(
      {
        committee: { findUnique: findCommittee },
        memberCommittee: { findUnique: findMembership },
        event: { findFirst, deleteMany },
      } as unknown as PrismaService,
      { hasCommitteePermission } as unknown as CommitteeAccessService,
    );
    const user = { personId: 8, memberId: 12 };

    hasCommitteePermission.mockResolvedValueOnce(false);
    await expect(remover.deleteDraftEvent(user, 'PR', 4)).rejects.toBeInstanceOf(ForbiddenException);

    findFirst.mockResolvedValueOnce(null);
    await expect(remover.deleteDraftEvent(user, 'PR', 4)).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { eventId: 4, committeeId: 2 } }));

    findFirst.mockResolvedValueOnce({ status: 'PUBLISHED' });
    await expect(remover.deleteDraftEvent(user, 'PR', 4)).rejects.toBeInstanceOf(ConflictException);
    expect(deleteMany).not.toHaveBeenCalled();

    findFirst.mockResolvedValueOnce({ status: 'DRAFT' });
    deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(remover.deleteDraftEvent(user, 'PR', 4)).rejects.toBeInstanceOf(ConflictException);

    findFirst.mockResolvedValueOnce({ status: 'DRAFT' });
    deleteMany.mockResolvedValueOnce({ count: 1 });
    await expect(remover.deleteDraftEvent(user, 'PR', 4)).resolves.toEqual({ id: '4' });
    expect(deleteMany).toHaveBeenLastCalledWith({ where: { eventId: 4, status: 'DRAFT' } });
  });

  it('keeps drafts off the public list', async () => {
    await service.createEvent({ personId: 8, memberId: 12 }, 'PR', { ...validEvent(), status: 'DRAFT' });
    expect(createEvent.mock.calls[0][0].data.status).toBe('DRAFT');
  });
});
