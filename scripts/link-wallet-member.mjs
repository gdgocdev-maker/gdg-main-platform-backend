import { parseArgs } from 'node:util';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../dist/prisma/prisma.service.js';

const args = parseArgs({
  options: {
    'membership-number': { type: 'string' },
    committee: { type: 'string' },
    'wallet-id': { type: 'string' },
    apply: { type: 'boolean' },
    'sync-points': { type: 'boolean' },
    'sync-next-event': { type: 'boolean' },
  },
}).values;
const number = Number(args['membership-number']);
const committeeCode = args.committee?.toUpperCase();
const walletPublicId = args['wallet-id']?.toLowerCase();
if (
  !/^\d{6,10}$/.test(args['membership-number'] ?? '') ||
  number < 100001 ||
  number > 2147483647 ||
  !/^[A-Z0-9_]{1,20}$/.test(committeeCode ?? '') ||
  !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(walletPublicId ?? '') ||
  !process.env.DATABASE_URL
) {
  console.error(
    'Set DATABASE_URL explicitly and supply --membership-number, --committee and --wallet-id.',
  );
  process.exit(2);
}

const prisma = new PrismaService(
  new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }),
);
try {
  const result = await prisma.$transaction(async (tx) => {
    const member = await tx.member.findFirst({
      where: {
        membershipNumber: number,
        isActive: true,
        person: { isActive: true },
      },
      select: {
        memberId: true,
        committees: {
          where: { committee: { committeeCode } },
          select: { committeeId: true },
        },
      },
    });
    if (!member || member.committees.length !== 1)
      return 'No active membership for that number and committee.';
    const { memberId } = member;
    const { committeeId } = member.committees[0];
    const previous = await tx.walletMembershipLink.findUnique({
      where: { walletPublicId },
    });
    if (
      previous &&
      (previous.memberId !== memberId ||
        previous.committeeId !== committeeId ||
        previous.revokedAt)
    ) {
      return 'The existing Wallet link requires owner review.';
    }
    if (!args.apply)
      return previous
        ? 'The mapping matches the existing link.'
        : 'Validated. No mapping written.';
    const options = {
      ...(args['sync-points'] ? { syncPoints: true } : {}),
      ...(args['sync-next-event'] ? { syncNextEvent: true } : {}),
    };
    if (previous) {
      if (!Object.keys(options).length)
        return 'The mapping matches the existing link.';
      const changed = await tx.walletMembershipLink.updateMany({
        where: { walletPublicId, memberId, committeeId, revokedAt: null },
        data: options,
      });
      if (!changed.count)
        return 'The existing Wallet link requires owner review.';
    } else {
      await tx.walletMembershipLink.create({
        data: { walletPublicId, memberId, committeeId, ...options },
      });
    }
    return 'Wallet membership link saved.';
  });
  console.log(result);
  if (result.startsWith('No active') || result.endsWith('owner review.'))
    process.exitCode = 1;
} catch {
  console.error(
    'The Wallet link could not be written. Check the target database and existing mapping.',
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
