// Local-only browser harness. Records synthetic mail in a private temporary directory.
import 'reflect-metadata';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { parse } from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import { assertLocalDatabase } from './import-supabase-auth.mjs';
assertLocalDatabase(process.env.DATABASE_URL ?? '');
if (!new URL(process.env.DATABASE_URL).pathname.includes('test')) throw new Error('Use a dedicated test database');
Object.assign(process.env, { BETTER_AUTH_SECRET: 'browser-harness-only-local-test-secret-12345', FRONTEND_URL: 'http://localhost:3000', BETTER_AUTH_URL: 'http://localhost:3000', TRUST_PROXY_HOPS: '0' });
const { AppModule } = await import('../dist/app.module.js');
const { configureHttp } = await import('../dist/configure-http.js');
const { ResendAuthEmailService } = await import('../dist/auth/email/resend-auth-email.service.js');
const directory = resolve(process.argv[2] ?? '/tmp/gdg-auth-browser-emails');
await mkdir(directory, { recursive: true, mode: 0o700 });
// Explicit, owner-authorized mode only. A persistent reservation prevents repeat sends.
const live = process.argv.includes('--live');
const privateEnv = live ? parse(await readFile('.env', 'utf8')) : {};
if (live && (!privateEnv.EMAIL_TEST_TO || !privateEnv.RESEND_API_KEY || !privateEnv.EMAIL_FROM)) throw new Error('Live mode requires the owner inbox, sender and key in ignored .env');
const liveMailer = live ? new ResendAuthEmailService(new ConfigService({
  RESEND_API_KEY: privateEnv.RESEND_API_KEY, EMAIL_FROM: privateEnv.EMAIL_FROM,
  FRONTEND_URL: 'http://localhost:3000',
})) : null;
let counter = 0;
const fixture = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ResendAuthEmailService).useValue({ send: async message => {
  const owner = live && message.to === privateEnv.EMAIL_TEST_TO;
  if (!message.to.endsWith('@example.test') && !owner) throw new Error('Recipient is not permitted');
  if (owner && ['verification', 'reset'].includes(message.kind)) {
    await writeFile(`${directory}/live-${message.kind}.reserved`, 'reserved', { flag: 'wx', mode: 0o600 });
    const id = await liveMailer.send(message);
    await writeFile(`${directory}/live-${message.kind}.receipt.json`, JSON.stringify({ kind: message.kind, id }), { mode: 0o600 });
  }
  await writeFile(`${directory}/${++counter}-${message.kind}.json`, JSON.stringify(message), { mode: 0o600 });
} }).compile();
const app = fixture.createNestApplication({ bodyParser: false, logger: false });
configureHttp(app);
await app.listen(3101, '127.0.0.1');
console.log(live ? 'Local auth harness: one verification and one reset allowed for the configured owner inbox.' : 'Local auth browser harness on 127.0.0.1:3101; mail is recorded, never sent.');
