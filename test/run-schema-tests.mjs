import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

// This runner creates its own server; it never accepts an application database URL.
const name = `gdg-schema-test-${process.pid}-${randomBytes(4).toString('hex')}`;
const password = randomBytes(24).toString('hex');
const env = {
  ...process.env,
  POSTGRES_USER: 'postgres',
  POSTGRES_PASSWORD: password,
  POSTGRES_DB: 'gdg_schema_test_a',
};
const scratch = mkdtempSync(join(tmpdir(), 'gdg-schema-test-'));
let started = false;
let backendStarted = false;
let networkStarted = false;
let imageBuilt = false;
const backendName = `${name}-backend`;
const image = `${name}:startup`;
function run(command, args, overrides = {}) {
  // pnpm 12 may be a shebang-less shim on macOS; a shell handles its ENOEXEC fallback.
  if (command === 'pnpm') {
    return run('sh', ['-c', 'exec pnpm "$@"', 'pnpm', ...args], overrides);
  }
  try {
    return execFileSync(command, args, {
      env: { ...env, ...overrides },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 180000,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.replaceAll(
      password,
      '[redacted]',
    );
    throw new Error(
      `${command} failed (${error.status ?? error.code})\n${output}`,
    );
  }
}
function sql(database, query) {
  return run('docker', [
    'exec',
    name,
    'psql',
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    'postgres',
    '-d',
    database,
    '-At',
    '-c',
    query,
  ]).trim();
}
try {
  run('docker', ['network', 'create', name]);
  networkStarted = true;
  run('docker', [
    'run',
    '--network',
    name,
    '--detach',
    '--rm',
    '--name',
    name,
    '-e',
    'POSTGRES_USER',
    '-e',
    'POSTGRES_PASSWORD',
    '-e',
    'POSTGRES_DB',
    '-p',
    '127.0.0.1::5432',
    'postgres:17',
  ]);
  started = true;
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      run('docker', ['exec', name, 'pg_isready', '-U', 'postgres']);
      ready = true;
      break;
    } catch {
      await delay(500);
    }
  }
  assert(ready, 'Disposable PostgreSQL did not become ready');
  const port = run('docker', ['port', name, '5432/tcp'])
    .trim()
    .split(':')
    .at(-1);
  assert(/^\d+$/.test(port), 'Expected one loopback PostgreSQL port');
  const url = (database) =>
    `postgresql://postgres:${password}@127.0.0.1:${port}/${database}?schema=public`;
  const testEnv = {
    DATABASE_URL: url('postgres'),
    TEST_DATABASE_URL: url('gdg_schema_test_a'),
  };
  assert.equal(
    sql(
      'gdg_schema_test_a',
      "SELECT count(*) FROM pg_tables WHERE schemaname='public'",
    ),
    '0',
  );

  console.log(
    'RED: expecting schema tests to fail on an empty disposable database.',
  );
  let failedBeforeMigration = false;
  try {
    run('pnpm', ['test:schema'], testEnv);
  } catch (error) {
    assert.match(
      error.message,
      /does not exist|P2021/,
      'Expected missing-schema failure, not a broken test harness',
    );
    failedBeforeMigration = true;
  }
  assert(
    failedBeforeMigration,
    'Schema tests unexpectedly passed before migration',
  );

  const dumps = [];
  for (const database of ['gdg_schema_test_a', 'gdg_schema_test_b']) {
    if (database.endsWith('_b'))
      run('docker', ['exec', name, 'createdb', '-U', 'postgres', database]);
    console.log(`Migrating and testing ${database}.`);
    run('pnpm', ['prisma:migrate:deploy'], { DATABASE_URL: url(database) });
    console.log(
      run('pnpm', ['test:schema'], {
        ...testEnv,
        TEST_DATABASE_URL: url(database),
      }),
    );
    const repeat = run('pnpm', ['prisma:migrate:deploy'], {
      DATABASE_URL: url(database),
    });
    assert.match(repeat, /No pending migrations/);
    assert.equal(
      sql(
        database,
        "SELECT (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM ' || quote_ident(tablename), false, true, '')))[1]::text FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' ORDER BY tablename",
      ),
      Array(13).fill('0').join('\n'),
      'Tests must clean up all committed fixtures',
    );
    const dump = run('docker', [
      'exec',
      name,
      'pg_dump',
      '-U',
      'postgres',
      '-d',
      database,
      '--schema-only',
      '--no-owner',
      '--no-privileges',
    ]);
    dumps.push(
      dump
        .split('\n')
        .filter(
          (line) =>
            !line.startsWith('--') &&
            !line.startsWith('\\restrict ') &&
            !line.startsWith('\\unrestrict '),
        )
        .join('\n'),
    );
  }
  assert.equal(dumps[0], dumps[1], 'Clean database schemas differ');
  console.log(
    'PASS: two clean replays are equivalent; repeat deploy is a no-op.',
  );

  const failingDatabase = 'gdg_schema_test_failure';
  run('docker', ['exec', name, 'createdb', '-U', 'postgres', failingDatabase]);
  const migrations = readdirSync('prisma/migrations').filter((entry) =>
    /^\d+_/.test(entry),
  );
  assert.equal(
    migrations.length,
    1,
    'Update rollback fixture explicitly when migration history grows',
  );
  const migration = readFileSync(
    join('prisma/migrations', migrations[0], 'migration.sql'),
    'utf8',
  );
  assert.match(migration, /COMMIT;\s*$/);
  const failureRoot = join(scratch, 'prisma');
  const failureMigration = join(failureRoot, 'migrations', migrations[0]);
  mkdirSync(failureMigration, { recursive: true });
  writeFileSync(
    join(failureRoot, 'schema.prisma'),
    readFileSync('prisma/schema.prisma'),
  );
  writeFileSync(
    join(failureRoot, 'migrations', 'migration_lock.toml'),
    readFileSync('prisma/migrations/migration_lock.toml'),
  );
  writeFileSync(
    join(failureMigration, 'migration.sql'),
    migration.replace(/COMMIT;\s*$/, 'SELECT 1 / 0;\nCOMMIT;\n'),
  );
  // Config contains no credentials and uses only the runner-owned environment URL.
  writeFileSync(
    join(scratch, 'prisma.config.ts'),
    `export default { schema: ${JSON.stringify(join(failureRoot, 'schema.prisma'))}, migrations: { path: ${JSON.stringify(join(failureRoot, 'migrations'))} }, datasource: { url: process.env.DATABASE_URL } };\n`,
  );
  const failureArgs = [
    'exec',
    'prisma',
    'migrate',
    'deploy',
    '--config',
    join(scratch, 'prisma.config.ts'),
  ];
  let rolledBack = false;
  try {
    run('pnpm', failureArgs, { DATABASE_URL: url(failingDatabase) });
  } catch (error) {
    assert.match(
      error.message,
      /division by zero|current transaction is aborted/,
    );
    // Prisma can mask the original SQL error while recording the aborted transaction.
    const logs = spawnSync('docker', ['logs', name], { encoding: 'utf8' });
    assert.equal(logs.status, 0);
    assert.match(`${logs.stdout}${logs.stderr}`, /division by zero/);
    rolledBack = true;
  }
  assert(rolledBack, 'Injected migration failure must be observed');
  assert.equal(
    sql(
      failingDatabase,
      "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'",
    ),
    '0',
  );
  assert.equal(
    sql(
      failingDatabase,
      "SELECT count(*) FROM pg_type WHERE typnamespace='public'::regnamespace AND typtype='e'",
    ),
    '0',
  );
  assert.equal(
    sql(
      failingDatabase,
      'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL',
    ),
    '1',
  );
  console.log(
    'PASS: injected failure rolled back domain tables/enums while Prisma recorded failed history.',
  );
  run(
    'pnpm',
    [
      'exec',
      'prisma',
      'migrate',
      'resolve',
      '--rolled-back',
      migrations[0],
      '--config',
      join(scratch, 'prisma.config.ts'),
    ],
    { DATABASE_URL: url(failingDatabase) },
  );
  run('pnpm', ['prisma:migrate:deploy'], {
    DATABASE_URL: url(failingDatabase),
  });
  assert.equal(
    sql(
      failingDatabase,
      "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'",
    ),
    '13',
  );
  console.log(
    'PASS: explicit failed-history resolution permits a successful retry.',
  );
  console.log(run('pnpm', ['test:e2e'], testEnv));
  if (process.argv.includes('--performance')) {
    const database = 'gdg_schema_test_performance';
    run('docker', ['exec', name, 'createdb', '-U', 'postgres', database]);
    run('pnpm', ['prisma:migrate:deploy'], { DATABASE_URL: url(database) });
    sql(database, readFileSync('test/schema-performance.sql', 'utf8'));
    assert.equal(
      sql(database, 'SELECT count(*) FROM event_registrations'),
      '41300',
    );
    const measurements = [];
    for (const [eventId, size] of [
      [101, 100],
      [102, 400],
      [103, 800],
    ]) {
      assert.equal(
        sql(
          database,
          `SELECT count(*) FROM event_registrations WHERE event_id=${eventId}`,
        ),
        String(size),
      );
      const cursor = sql(
        database,
        `SELECT min(registration_id) FROM event_registrations WHERE user_id=1`,
      );
      const queries = {
        'PR status page': `SELECT registration_id,user_id,status FROM event_registrations WHERE event_id=${eventId} AND status='PENDING' ORDER BY registered_at,registration_id LIMIT 50`,
        'My Events cursor page': `SELECT registration_id,event_id,status FROM event_registrations WHERE user_id=1 AND (registered_at,registration_id) > (SELECT registered_at,registration_id FROM event_registrations WHERE registration_id=${cursor}) ORDER BY registered_at,registration_id LIMIT 50`,
        'Reserved seats': `SELECT count(*) FROM event_registrations WHERE event_id=${eventId} AND status IN ('AWAITING_CONFIRMATION','CONFIRMED')`,
        'Next waitlist entry': `SELECT registration_id,user_id FROM event_registrations WHERE event_id=${eventId} AND status='WAITLISTED' ORDER BY waitlist_position LIMIT 1`,
        'Expiry batch': `SELECT registration_id,event_id FROM event_registrations WHERE status='AWAITING_CONFIRMATION' AND confirmation_deadline <= now() ORDER BY confirmation_deadline,registration_id LIMIT 50`,
        'Due events': `SELECT event_id FROM events WHERE status='published' AND ends_at<=now() ORDER BY ends_at,event_id LIMIT 50`,
        'Token lookup': `SELECT registration_id,event_id,status FROM event_registrations WHERE attendance_token_hash=md5('${eventId}:5')`,
        Questions: `SELECT question_id,question_text,question_type FROM event_questions WHERE event_id=${eventId} ORDER BY position`,
        'Warning flags page': `SELECT r.registration_id,r.user_id,COALESCE((SELECT true FROM event_registrations history JOIN registration_blacklist_entries b ON b.registration_id=history.registration_id WHERE history.user_id=r.user_id AND b.resolved_at IS NULL LIMIT 1),false) AS has_notice FROM event_registrations r WHERE r.event_id=${eventId} ORDER BY r.registered_at,r.registration_id LIMIT 50`,
      };
      assert.equal(
        sql(database, queries['Reserved seats']),
        String((size * 2) / 5),
      );
      assert.equal(
        sql(database, `SELECT count(*) FROM (${queries['Due events']}) q`),
        '1',
      );
      assert.equal(
        sql(database, `SELECT count(*) FROM (${queries['Questions']}) q`),
        '5',
      );
      assert.equal(
        sql(database, `SELECT count(*) FROM (${queries['Token lookup']}) q`),
        '1',
      );
      for (const [query, statement] of Object.entries(queries)) {
        const plan = JSON.parse(
          sql(database, `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`),
        )[0];
        const nodes = [];
        const walk = (node) => {
          nodes.push(node);
          for (const child of node.Plans ?? []) walk(child);
        };
        walk(plan.Plan);
        assert(Number.isFinite(plan['Execution Time']));
        measurements.push({
          eventSize: size,
          query,
          milliseconds: plan['Execution Time'],
          estimatedRows: plan.Plan['Plan Rows'],
          actualRows: plan.Plan['Actual Rows'],
          rowsVisited: nodes
            .filter((node) => node['Relation Name'])
            .reduce(
              (sum, node) =>
                sum +
                ((node['Actual Rows'] ?? 0) +
                  (node['Rows Removed by Filter'] ?? 0) +
                  (node['Rows Removed by Index Recheck'] ?? 0)) *
                  (node['Actual Loops'] ?? 1),
              0,
            ),
          sharedHitBlocks: plan.Plan['Shared Hit Blocks'] ?? 0,
          sharedReadBlocks: plan.Plan['Shared Read Blocks'] ?? 0,
          indexes: [
            ...new Set(nodes.map((node) => node['Index Name']).filter(Boolean)),
          ],
          sequentialScans: nodes
            .filter((node) => node['Node Type'] === 'Seq Scan')
            .map((node) => node['Relation Name']),
        });
      }
    }
    console.log(
      'PERFORMANCE_RESULTS ' +
        JSON.stringify({
          postgres: sql(database, 'SELECT version()'),
          docker: run('docker', [
            'info',
            '--format',
            '{{.NCPU}} CPUs / {{.MemTotal}} bytes',
          ]).trim(),
          measurements,
        }),
    );
    console.log(
      'PASS: representative query plans recorded; these are single-query timings, not API throughput or capacity guarantees.',
    );
  }

  if (process.argv.includes('--startup')) {
    const config = JSON.parse(
      run('docker', [
        'compose',
        '-f',
        'docker-compose.yml',
        '-f',
        'compose.platform.yml',
        'config',
        '--no-interpolate',
        '--format',
        'json',
      ]),
    );
    const command = config.services.backend.command;
    assert.deepEqual(command, [
      'sh',
      '-c',
      'pnpm prisma:migrate:deploy && exec pnpm start:dev',
    ]);
    console.log('Building isolated backend image for startup verification.');
    run('docker', ['build', '-t', image, '.']);
    imageBuilt = true;
    const startupDb = 'gdg_schema_test_startup';
    run('docker', ['exec', name, 'createdb', '-U', 'postgres', startupDb]);
    const startBackend = () => {
      run(
        'docker',
        [
          'run',
          '--detach',
          '--network',
          name,
          '--name',
          backendName,
          '-e',
          'DATABASE_URL',
          '-e',
          'PORT=3001',
          '-p',
          '127.0.0.1::3001',
          image,
          ...command,
        ],
        {
          DATABASE_URL: url(startupDb).replace(
            `127.0.0.1:${port}`,
            `${name}:5432`,
          ),
        },
      );
      backendStarted = true;
      return run('docker', ['port', backendName, '3001/tcp'])
        .trim()
        .split(':')
        .at(-1);
    };
    const stopBackend = () => {
      run('docker', ['rm', '--force', backendName]);
      backendStarted = false;
    };
    const waitForHttp = async (backendPort) => {
      for (let attempt = 0; attempt < 120; attempt++) {
        try {
          const response = await fetch(`http://127.0.0.1:${backendPort}`, {
            signal: AbortSignal.timeout(1000),
          });
          if (response.ok && (await response.text()) === 'Hello World!') return;
        } catch {
          /* Server may still be migrating or compiling. */
        }
        await delay(500);
      }
      throw new Error('Isolated backend did not become HTTP ready');
    };
    await waitForHttp(startBackend());
    assert.equal(
      sql(
        startupDb,
        "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'",
      ),
      '13',
    );
    sql(
      startupDb,
      "INSERT INTO users(full_name,email,updated_at) VALUES ('Preserved fixture','preserved@example.test',CURRENT_TIMESTAMP)",
    );
    stopBackend();
    await waitForHttp(startBackend());
    assert.equal(
      sql(
        startupDb,
        "SELECT count(*) FROM users WHERE email='preserved@example.test'",
      ),
      '1',
    );
    stopBackend();
    // A separate incompatible database must fail before the application command runs.
    sql('postgres', 'CREATE DATABASE gdg_schema_test_incompatible');
    sql(
      'gdg_schema_test_incompatible',
      'CREATE TABLE incompatible_fixture(id integer)',
    );
    run(
      'docker',
      [
        'run',
        '--detach',
        '--network',
        name,
        '--name',
        backendName,
        '-e',
        'DATABASE_URL',
        '-e',
        'PORT=3001',
        image,
        ...command,
      ],
      {
        DATABASE_URL: url('gdg_schema_test_incompatible').replace(
          `127.0.0.1:${port}`,
          `${name}:5432`,
        ),
      },
    );
    backendStarted = true;
    const exit = run('docker', ['wait', backendName]).trim();
    assert.notEqual(exit, '0');
    const failedLogs = spawnSync('docker', ['logs', backendName], {
      encoding: 'utf8',
    });
    assert.equal(failedLogs.status, 0);
    assert.match(`${failedLogs.stdout}${failedLogs.stderr}`, /P3005|not empty/);
    assert.doesNotMatch(
      `${failedLogs.stdout}${failedLogs.stderr}`,
      /nest start|Nest application successfully started/,
    );
    stopBackend();
    console.log(
      'PASS: Docker startup migrates before HTTP readiness, preserves data on restart, and fails closed on incompatible schema.',
    );
  }
} finally {
  try {
    if (backendStarted) run('docker', ['rm', '--force', backendName]);
    if (started) run('docker', ['rm', '--force', name]);
    if (networkStarted) run('docker', ['network', 'rm', name]);
    if (imageBuilt) run('docker', ['image', 'rm', '--force', image]);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
