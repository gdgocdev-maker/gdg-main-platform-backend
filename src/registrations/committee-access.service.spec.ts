import type { PrismaService } from '../prisma/prisma.service.js';
import { CommitteeAccessService } from './committee-access.service.js';

describe('CommitteeAccessService', () => {
  it('binds membership review permission checks to the requested committee', async () => {
    const query = vi.fn().mockResolvedValue([{ allowed: false }]);
    const access = new CommitteeAccessService({ $queryRaw: query } as unknown as PrismaService);

    await expect(access.hasCommitteePermission(14, 'applications.decide', 'DATA')).resolves.toBe(false);
    const [sql, ...values] = query.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(sql.join('?')).toContain('c.committee_code = ?');
    expect(values).toContain(14);
    expect(values).toContain('applications.decide');
    expect(values).toContain('DATA');
  });

  it('rejects when the permission query finds no active committee grant', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const access = new CommitteeAccessService({ $queryRaw: query } as unknown as PrismaService);

    await expect(access.hasCommitteePermission(14, 'applications.decide', 'PR')).resolves.toBe(false);
  });
});
