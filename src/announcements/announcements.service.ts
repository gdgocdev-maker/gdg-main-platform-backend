import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AnnouncementCategory, AnnouncementStatus } from '../generated/prisma/client.js';
import type { AuthenticatedUser } from '../auth/current-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CommitteeAccessService } from '../registrations/committee-access.service.js';
import { CommitteeEventImageStorageService } from '../committee-dashboard/committee-event-image-storage.service.js';
import type { CreateAnnouncementDto, UpdateAnnouncementDto } from './announcement.dto.js';

const artworkByCategory = {
  events: 'ocean',
  recruitment: 'forest',
  workshops: 'navy',
  results: 'ember',
  community: 'pine',
  trip: 'ocean',
} as const;

function announcementSlug(title: string) {
  const base = title
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 220) || 'announcement';
  return `${base}-${randomUUID().slice(0, 8)}`;
}

@Injectable()
export class AnnouncementsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CommitteeAccessService) private readonly access: CommitteeAccessService,
    @Inject(CommitteeEventImageStorageService) private readonly imageStorage: CommitteeEventImageStorageService,
  ) {}

  async listPublished() {
    const rows = await this.prisma.announcement.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }, { announcementId: 'desc' }],
      include: { publisher: { include: { person: { select: { fullName: true } } } } },
    });
    return rows.map((row) => this.serialize(row));
  }

  async getPublished(slug: string) {
    const row = await this.prisma.announcement.findUnique({
      where: { slug },
      include: { publisher: { include: { person: { select: { fullName: true } } } } },
    });
    if (!row || row.status !== 'PUBLISHED') throw new NotFoundException('Announcement not found.');
    return this.serialize(row);
  }

  async listForManagement(user: AuthenticatedUser) {
    await this.requireManager(user);
    const rows = await this.prisma.announcement.findMany({
      orderBy: [{ updatedAt: 'desc' }, { announcementId: 'desc' }],
      include: { publisher: { include: { person: { select: { fullName: true } } } } },
    });
    return rows.map((row) => this.serialize(row));
  }

  async uploadImage(user: AuthenticatedUser, file: { buffer: Buffer; mimetype: string; size: number } | undefined) {
    await this.requireManager(user);
    if (!file) throw new BadRequestException('An image file is required.');
    return this.imageStorage.uploadAnnouncementImage(file);
  }

  async create(user: AuthenticatedUser, body: CreateAnnouncementDto) {
    const memberId = await this.requireManager(user);
    const status = body.status ?? 'PUBLISHED';
    const title = body.title?.trim() ?? '';
    const excerpt = body.excerpt?.trim() ?? '';
    if (status === 'PUBLISHED' && (title.length < 3 || excerpt.length < 10)) {
      throw new BadRequestException('Published announcements require a title of at least 3 characters and a description of at least 10 characters.');
    }
    const hasActionLabel = Boolean(body.actionLabel?.trim());
    const hasActionHref = Boolean(body.actionHref?.trim());
    if (status === 'PUBLISHED' && hasActionLabel !== hasActionHref) {
      throw new BadRequestException('Provide both an action label and its URL, or leave both empty.');
    }
    const row = await this.prisma.announcement.create({
      data: {
        slug: announcementSlug(title),
        title,
        excerpt,
        category: body.category as AnnouncementCategory,
        status: (body.status ?? 'PUBLISHED') as AnnouncementStatus,
        body: body.body?.trim() || null,
        imageUrl: body.imageUrl?.trim() || null,
        actionLabel: body.actionLabel?.trim() || null,
        actionHref: body.actionHref?.trim() || null,
        pinned: body.pinned ?? false,
        publishedByMemberId: memberId,
      },
      include: { publisher: { include: { person: { select: { fullName: true } } } } },
    });
    return this.serialize(row);
  }

  async update(user: AuthenticatedUser, announcementId: number, body: UpdateAnnouncementDto) {
    await this.requireManager(user);
    const existing = await this.prisma.announcement.findUnique({ where: { announcementId } });
    if (!existing) throw new NotFoundException('Announcement not found.');

    const nextStatus = body.status ?? existing.status;
    const nextTitle = body.title?.trim() ?? existing.title;
    const nextExcerpt = body.excerpt?.trim() ?? existing.excerpt;
    if (nextStatus === 'PUBLISHED' && (nextTitle.length < 3 || nextExcerpt.length < 10)) {
      throw new BadRequestException('Published announcements require a title of at least 3 characters and a description of at least 10 characters.');
    }

    const actionLabel = body.actionLabel === undefined ? existing.actionLabel : body.actionLabel?.trim() || null;
    const actionHref = body.actionHref === undefined ? existing.actionHref : body.actionHref?.trim() || null;
    if (nextStatus === 'PUBLISHED' && Boolean(actionLabel) !== Boolean(actionHref)) {
      throw new BadRequestException('Provide both an action label and its URL, or clear both.');
    }

    const row = await this.prisma.announcement.update({
      where: { announcementId },
      data: {
        ...(body.title !== undefined ? { title: body.title.trim() } : {}),
        ...(body.excerpt !== undefined ? { excerpt: body.excerpt.trim() } : {}),
        ...(body.category !== undefined ? { category: body.category as AnnouncementCategory } : {}),
        ...(body.status !== undefined ? {
          status: body.status as AnnouncementStatus,
          ...(nextStatus === 'PUBLISHED' && existing.status === 'DRAFT'
            ? { publishedAt: new Date(), slug: announcementSlug(nextTitle) }
            : {}),
        } : {}),
        ...(body.body !== undefined ? { body: body.body.trim() || null } : {}),
        ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl?.trim() || null } : {}),
        actionLabel,
        actionHref,
        ...(body.pinned !== undefined ? { pinned: body.pinned } : {}),
      },
      include: { publisher: { include: { person: { select: { fullName: true } } } } },
    });
    return this.serialize(row);
  }

  async delete(user: AuthenticatedUser, announcementId: number) {
    await this.requireManager(user);
    const result = await this.prisma.announcement.deleteMany({ where: { announcementId } });
    if (result.count === 0) throw new NotFoundException('Announcement not found.');
    return { id: String(announcementId) };
  }

  private async requireManager(user: AuthenticatedUser) {
    if (!user.memberId || !(await this.access.hasGlobalPermission(user.memberId, 'announcements.manage'))) {
      throw new ForbiddenException();
    }
    return user.memberId;
  }

  private serialize(row: {
    announcementId: number;
    slug: string;
    title: string;
    excerpt: string;
    category: AnnouncementCategory;
    status: AnnouncementStatus;
    body: string | null;
    imageUrl: string | null;
    actionLabel: string | null;
    actionHref: string | null;
    pinned: boolean;
    publishedAt: Date;
    updatedAt: Date;
    publisher: { person: { fullName: string } };
  }) {
    const body = row.body?.split(/\n\s*\n/).map((text) => text.trim()).filter(Boolean);
    return {
      id: String(row.announcementId),
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt,
      category: row.category,
      publicationStatus: row.status,
      media: row.imageUrl
        ? { type: 'image' as const, src: row.imageUrl, alt: row.title }
        : { type: 'artwork' as const, artwork: artworkByCategory[row.category] },
      publishedAt: row.publishedAt.toISOString().slice(0, 10),
      updatedAt: row.updatedAt.toISOString().slice(0, 10),
      publishedBy: row.publisher.person.fullName,
      pinned: row.pinned,
      ...(row.status === 'DRAFT' ? {
        draftActionLabel: row.actionLabel,
        draftActionHref: row.actionHref,
      } : {}),
      ...(body?.length ? { body: body.map((text) => ({ type: 'paragraph' as const, text })) } : {}),
      ...(row.actionLabel && row.actionHref
        ? { primaryAction: { label: row.actionLabel, href: row.actionHref } }
        : {}),
    };
  }
}
