import { createHash, randomUUID } from 'node:crypto';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { AuthGuard } from '../src/auth/auth.guard.js';
import { TokenVerifierService } from '../src/auth/token-verifier.service.js';
import { CommitteeDashboardController } from '../src/committee-dashboard/committee-dashboard.controller.js';
import { CommitteeDashboardService } from '../src/committee-dashboard/committee-dashboard.service.js';
import { LeadershipTasksService } from '../src/committee-dashboard/leadership-tasks.service.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { CommitteeAccessService } from '../src/registrations/committee-access.service.js';
import { schemaTestTarget } from './schema-test-target.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)('Wallet membership links', () => {
  it('uses one public number across card pairs and limits link status to the current committee leader', async () => {
    const connectionString = schemaTestTarget(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    const rollback = new Error('Discard synthetic Wallet fixtures');

    try {
      await expect(db.$transaction(async (tx) => {
        const code = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
        const first = await tx.committee.create({ data: { committeeCode: code, committeeName: code } });
        const second = await tx.committee.create({ data: { committeeCode: code + 'B', committeeName: code + 'B' } });
        const actorAuthId = randomUUID();
        const actor = await tx.member.create({
          data: {
            person: { create: { authUserId: actorAuthId, fullName: 'Synthetic committee leader' } },
            committees: { create: [
              { committeeId: first.committeeId, role: 'Leader' },
              { committeeId: second.committeeId, role: 'Member' },
            ] },
          },
        });
        const target = await tx.member.create({
          data: {
            person: { create: { fullName: 'Synthetic card holder' } },
            committees: { create: [
              { committeeId: first.committeeId },
              { committeeId: second.committeeId },
            ] },
          },
        });
        const firstWalletId = randomUUID();
        const secondWalletId = randomUUID();
        const barcodeHash = createHash('sha256').update('GDG-UJ:MEMBER:SYNTHETIC-' + code).digest('hex');
        await tx.walletMembershipLink.create({
          data: {
            walletPublicId: firstWalletId,
            memberId: target.memberId,
            committeeId: first.committeeId,
            barcodeAliases: { create: { barcodeHash } },
          },
        });
        await tx.walletMembershipLink.create({
          data: { walletPublicId: secondWalletId, memberId: target.memberId, committeeId: second.committeeId },
        });
        const links = await tx.walletMembershipLink.findMany({
          where: { memberId: target.memberId },
          select: { member: { select: { membershipNumber: true } } },
        });
        expect(links.map(({ member }) => member.membershipNumber)).toEqual([
          target.membershipNumber,
          target.membershipNumber,
        ]);
        expect(target.membershipNumber).toBeGreaterThanOrEqual(100001);
        expect(target.membershipNumber).not.toBe(actor.membershipNumber);

        const module = await Test.createTestingModule({
          controllers: [CommitteeDashboardController],
          providers: [
            CommitteeDashboardService,
            CommitteeAccessService,
            { provide: LeadershipTasksService, useValue: {} },
            { provide: PrismaService, useValue: tx },
            {
              provide: TokenVerifierService,
              useValue: {
                verify: async (token: string) => token === 'synthetic-session'
                  ? { authUserId: actorAuthId, expiresAt: Date.now() / 1000 + 300 }
                  : null,
              },
            },
            { provide: APP_GUARD, useClass: AuthGuard },
          ],
        }).compile();
        const app = module.createNestApplication();
        try {
          await app.init();
          const path = (committeeCode: string) =>
            `/committees/${committeeCode}/members/${target.memberId}/wallet-link`;
          const client = request(app.getHttpServer());
          const auth = 'Bearer synthetic-session';
          const get = (committeeCode: string) => client.get(path(committeeCode)).set('Authorization', auth);

          await client.get(path(first.committeeCode)).expect(403);
          const linked = await get(first.committeeCode).expect(200);
          expect(linked.body.data).toEqual({ membershipNumber: target.membershipNumber, walletLinked: true });
          await get(second.committeeCode).expect(403);

          await tx.walletMembershipLink.update({
            where: { walletPublicId: firstWalletId },
            data: { revokedAt: new Date() },
          });
          const revoked = await get(first.committeeCode).expect(200);
          expect(revoked.body.data).toEqual({ membershipNumber: target.membershipNumber, walletLinked: false });

          await tx.memberCommittee.update({
            where: { memberId_committeeId: { memberId: actor.memberId, committeeId: first.committeeId } },
            data: { role: 'Member' },
          });
          await get(first.committeeCode).expect(403);
        } finally {
          await app.close();
        }
        throw rollback;
      }, { timeout: 15_000 })).rejects.toBe(rollback);
    } finally {
      await db.$disconnect();
    }
  });
});
