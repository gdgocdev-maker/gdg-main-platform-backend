import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('queries PostgreSQL through the injected Prisma service', async () => {
    const prisma = app.get(PrismaService);
    await expect(prisma.$queryRaw`SELECT 1 AS value`).resolves.toEqual([
      { value: 1 },
    ]);
  });

  it('releases database connections when the application closes', async () => {
    const name = `gdg_prisma_shutdown_${process.pid}`;
    const url = new URL(
      app.get(ConfigService).getOrThrow<string>('DATABASE_URL'),
    );
    url.searchParams.set('application_name', name);
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(new ConfigService({ DATABASE_URL: url.toString() }))
      .compile();
    const closingApp = fixture.createNestApplication();
    const observer = app.get(PrismaService);

    try {
      await closingApp.init();
      const before = await observer.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int FROM pg_stat_activity WHERE application_name = ${name}
      `;
      expect(before[0].count).toBeGreaterThan(0);

      await closingApp.close();
      const after = await observer.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int FROM pg_stat_activity WHERE application_name = ${name}
      `;
      expect(after[0].count).toBe(0);
    } finally {
      await closingApp.close();
    }
  });

  it('refuses to initialize when PostgreSQL is unreachable', async () => {
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          DATABASE_URL: 'postgresql://invalid:invalid@127.0.0.1:1/unavailable',
        }),
      )
      .compile();
    const unavailableApp = fixture.createNestApplication();

    try {
      await expect(
        unavailableApp.init().then(() => undefined),
      ).rejects.toThrow();
    } finally {
      await unavailableApp.close();
    }
  });

  afterEach(async () => {
    await app.close();
  });
});
