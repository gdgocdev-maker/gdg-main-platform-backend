import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnouncementsService } from './announcements.service.js';

const hasGlobalPermission = vi.fn();
const create = vi.fn();
const findMany = vi.fn();
const findUnique = vi.fn();
const uploadAnnouncementImage = vi.fn();

const service = new AnnouncementsService(
  {
    announcement: { create, findMany, findUnique },
  } as never,
  { hasGlobalPermission } as never,
  { uploadAnnouncementImage } as never,
);

describe('AnnouncementsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasGlobalPermission.mockResolvedValue(true);
  });

  it('publishes and persists an announcement under the requesting group leader', async () => {
    create.mockImplementation(async ({ data }) => ({
      announcementId: 7,
      slug: data.slug,
      title: data.title,
      excerpt: data.excerpt,
      category: data.category,
      status: data.status,
      body: data.body,
      actionLabel: data.actionLabel,
      actionHref: data.actionHref,
      pinned: data.pinned,
      publishedAt: new Date('2026-11-01T00:00:00.000Z'),
      updatedAt: new Date('2026-11-01T00:00:00.000Z'),
      publisher: { person: { fullName: 'Group Leader' } },
    }));

    const result = await service.create(
      { personId: 1, memberId: 12 },
      {
        title: 'New workshop',
        excerpt: 'Join our next developer workshop.',
        category: 'workshops',
        body: 'Details for the workshop.',
        pinned: true,
      },
    );

    expect(hasGlobalPermission).toHaveBeenCalledWith(12, 'announcements.manage');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        title: 'New workshop',
        category: 'workshops',
        publishedByMemberId: 12,
        pinned: true,
      }),
      include: expect.any(Object),
    }));
    expect(result).toMatchObject({
      id: '7',
      title: 'New workshop',
      publishedBy: 'Group Leader',
      pinned: true,
      media: { type: 'artwork', artwork: 'navy' },
    });
  });

  it('rejects callers without the announcement permission', async () => {
    hasGlobalPermission.mockResolvedValue(false);

    await expect(service.create(
      { personId: 2, memberId: 15 },
      { title: 'New workshop', excerpt: 'Join our next developer workshop.', category: 'workshops' },
    )).rejects.toMatchObject({ status: 403 });

    expect(create).not.toHaveBeenCalled();
  });

  it('requires a label and URL to be provided together', async () => {
    await expect(service.create(
      { personId: 1, memberId: 12 },
      {
        title: 'New workshop',
        excerpt: 'Join our next developer workshop.',
        category: 'workshops',
        actionLabel: 'Register',
      },
    )).rejects.toMatchObject({ status: 400 });

    expect(create).not.toHaveBeenCalled();
  });
});
