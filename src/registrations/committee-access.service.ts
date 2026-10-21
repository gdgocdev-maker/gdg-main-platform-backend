import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export const REGISTRANTS_VIEW = 'registrants.view';
export const REGISTRATIONS_REVIEW = 'registrations.review';
export const EVENTS_CREATE = 'events.create';

@Injectable()
export class CommitteeAccessService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) { }

  // True when an active member holds the permission through a committee position.
  // A committee_permission row with a NULL committee applies to every committee.
  async hasCommitteePermission(
    memberId: number,
    code: string,
  ): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ allowed: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM member m
        JOIN member_committee mc ON mc.member_id = m.member_id
        JOIN committee_permission cp
          ON cp.committee_role = mc.role
         AND (cp.committee_id = mc.committee_id OR cp.committee_id IS NULL)
        WHERE m.member_id = ${memberId}
          AND m.is_active
          AND cp.code = ${code}
      ) AS allowed`;
    return rows[0]?.allowed === true;
  }

  async committeeIdWithPermission(
    memberId: number,
    committeeCode: string,
    code: string,
  ): Promise<number | null> {
    const rows = await this.prisma.$queryRaw<{ committeeId: number }[]>`
      SELECT mc.committee_id AS "committeeId"
      FROM member m
      JOIN member_committee mc ON mc.member_id = m.member_id
      JOIN committee c ON c.committee_id = mc.committee_id
      JOIN committee_permission cp
        ON cp.committee_id = mc.committee_id
       AND cp.committee_role = mc.role
      WHERE m.member_id = ${memberId}
        AND m.is_active
        AND c.committee_code = ${committeeCode}
        AND mc.role IN ('Leader', 'Co-Leader')
        AND cp.code = ${code}
        AND cp.applies_to = 'own'
      LIMIT 1`;
    return rows[0]?.committeeId ?? null;
  }
}
