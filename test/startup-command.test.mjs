import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const config = JSON.parse(
  execFileSync(
    'docker',
    [
      'compose',
      '-f',
      'docker-compose.yml',
      '-f',
      'compose.platform.yml',
      'config',
      '--no-interpolate',
      '--format',
      'json',
    ],
    { encoding: 'utf8' },
  ),
);
assert.deepEqual(config.services.backend.command, [
  'sh',
  '-c',
  'pnpm prisma:migrate:deploy && exec pnpm start:dev',
]);
console.log(
  'Startup command applies migrations before NestJS, and stops on failure.',
);
