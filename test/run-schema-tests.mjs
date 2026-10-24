import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import {
  copyMigrationHistory,
  injectMigrationFailure,
  migrationNames,
} from './schema-migrations.mjs';

const initialTables = [
  'committee',
  'event_questions',
  'event_registrations',
  'events',
  'member',
  'member_committee',
  'permissions',
  'registration_answers',
  'registration_blacklist_entries',
  'role_permissions',
  'roles',
  'user_roles',
  'users',
];
// Update this explicit manifest when a migration adds or removes project tables.
const expectedTables = [
  ...initialTables.filter(
    (table) =>
      ![
        'users',
        'user_roles',
        'roles',
        'permissions',
        'role_permissions',
      ].includes(table),
  ),
  'person',
  'permission',
  'role_permission',
  'role',
  'member_role',
  'member_skill',
  'membership_request',
  'membership_request_committee',
  'skill',
  'committee_permission',
].sort();
const approvedCommitteePolicy = JSON.parse(
  readFileSync('test/fixtures/approved-committee-permissions.json', 'utf8'),
);
const approvedRolePermissions = JSON.parse(
  readFileSync('test/fixtures/approved-role-permissions.json', 'utf8'),
);
const approvedPermissions = JSON.parse(
  readFileSync('test/fixtures/approved-permissions.json', 'utf8'),
);
const approvedSkills = JSON.parse(
  readFileSync('test/fixtures/approved-skills.json', 'utf8'),
);

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
function tables(database) {
  const result = sql(
    database,
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' ORDER BY tablename",
  );
  return result ? result.split('\n') : [];
}
function assertTables(database, expected) {
  assert.deepEqual(
    tables(database),
    [...expected].sort(),
    'Unexpected project tables',
  );
}
function schemaDump(database) {
  return run('docker', [
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
    '--exclude-table=public._prisma_migrations',
  ])
    .split('\n')
    .filter(
      (line) =>
        !line.startsWith('--') &&
        !line.startsWith('\\restrict ') &&
        !line.startsWith('\\unrestrict '),
    )
    .join('\n');
}
function domainRows(database) {
  return tables(database).map((table) => [
    table,
    sql(
      database,
      `SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text), '[]'::jsonb) FROM "${table.replaceAll('"', '""')}" r`,
    ),
  ]);
}

function committeePolicy(database) {
  return JSON.parse(
    sql(
      database,
      `SELECT jsonb_build_object(
    'committees', (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY committee_code),'[]'::jsonb) FROM (
      SELECT c.committee_code,c.committee_name,p.committee_code AS parent_committee_code
      FROM committee c LEFT JOIN committee p ON p.committee_id=c.parent_committee_id) r),
    'permissions', (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY committee_code,committee_role,code),'[]'::jsonb) FROM (
      SELECT c.committee_code,cp.committee_role,cp.code,cp.applies_to,cp.include_sub_committees
      FROM committee_permission cp LEFT JOIN committee c ON c.committee_id=cp.committee_id) r))`,
    ),
  );
}

try {
  run('docker', ['network', 'create', name]);
  networkStarted = true;
  run('docker', [
    'run',
    '--network',
    name,
    '--network-alias',
    'db',
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
      // The image's temporary initialization server accepts Unix sockets before the test database exists.
      run('docker', [
        'exec',
        name,
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-U',
        'postgres',
      ]);
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
  if (process.argv.includes('--seed')) {
    const seedDatabase = 'gdg_schema_test_seed';
    const createSeedDatabase = (database) => {
      run('docker', ['exec', name, 'createdb', '-U', 'postgres', database]);
      run('pnpm', ['prisma:migrate:deploy'], { DATABASE_URL: url(database) });
    };
    const seed = (database) =>
      run('node', ['scripts/seed-development.mjs'], {
        DATABASE_URL: url(database),
        NODE_ENV: 'test',
      });
    createSeedDatabase(seedDatabase);
    sql(
      seedDatabase,
      "INSERT INTO person(full_name,email_personal) VALUES ('Unrelated sentinel','sentinel@example.test')",
    );
    const initial = domainRows(seedDatabase);
    assert.match(seed(seedDatabase), /Local development seed completed/);
    const overrideFile = join(scratch, 'seed-target.env');
    writeFileSync(
      overrideFile,
      `DATABASE_URL=${url('gdg_schema_test_seed_unwanted')}\n`,
    );
    assert.match(
      run('node', ['scripts/seed-development.mjs'], {
        DATABASE_URL: url(seedDatabase),
        NODE_ENV: 'test',
        DOTENV_CONFIG_PATH: overrideFile,
        DOTENV_CONFIG_OVERRIDE: 'true',
      }),
      /Local development seed completed/,
    );

    const expected = [
      {
        name: 'Ammar Babaset',
        email: 'babaset99@gmail.com',
        type: 'current',
        committees: { WEB: 'Leader', PM: 'Member' },
        roles: [],
        skills: [2, 3, 10],
      },
      {
        name: 'Leen Alghamdi',
        email: 'LeenAlghamdi@gmail.com',
        type: 'current',
        committees: {},
        roles: ['GROUP_LEADER'],
        skills: [3, 4, 5],
      },
      {
        name: 'Abdullah Misar',
        email: 'AbdullahMisar@gmail.com',
        type: 'current',
        committees: { DEV: 'Leader', WEB: 'Member' },
        roles: [],
        skills: [3, 8, 10],
      },
      {
        name: 'Mohmmad Alamri',
        email: 'MohmmadAlamri@gmail.com',
        type: 'alumni',
        committees: { CYBER: 'Member', PR: 'Member' },
        roles: [],
        skills: [4, 6, 28],
      },
      {
        name: 'Sara Alqahtani',
        email: 'sara.alqahtani@example.test',
        type: 'current',
        committees: { WEB: 'Co-Leader', PM: 'Member' },
        roles: [],
        skills: [1, 2, 10],
      },
      {
        name: 'Noura Demo',
        email: 'data.leader@example.test',
        type: 'current',
        committees: { DATA: 'Leader' },
        roles: [],
        skills: [],
      },
      {
        name: 'Faisal Demo',
        email: 'data.coleader@example.test',
        type: 'current',
        committees: { DATA: 'Co-Leader' },
        roles: [],
        skills: [],
      },
      {
        name: 'Hala Demo',
        email: 'data.member@example.test',
        type: 'current',
        committees: { DATA: 'Member' },
        roles: [],
        skills: [],
      },
      {
        name: 'Omar Demo',
        email: 'club.coleader@example.test',
        type: 'current',
        committees: {},
        roles: ['GROUP_CO_LEADER'],
        skills: [],
      },
      {
        name: 'Rania Demo',
        email: 'club.advisor@example.test',
        type: 'current',
        committees: {},
        roles: ['ADVISOR'],
        skills: [],
      },
    ]
      .map((row) => ({
        ...row,
        auth: null,
        active: true,
        memberActive: true,
        joinDate: null,
        skills: row.skills
          .map(
            (id) =>
              approvedSkills.find((skill) => skill.skill_id === id).skill_name,
          )
          .sort(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const actual = JSON.parse(
      sql(
        seedDatabase,
        `SELECT jsonb_agg(to_jsonb(r) ORDER BY name) FROM (
      SELECT p.full_name AS name, p.email_personal AS email, m.member_type AS type, p.auth_user_id AS auth,
        p.is_active AS active, m.is_active AS "memberActive", m.join_date AS "joinDate",
        COALESCE((SELECT jsonb_object_agg(c.committee_code, mc.role) FROM member_committee mc JOIN committee c USING(committee_id) WHERE mc.member_id=m.member_id), '{}'::jsonb) AS committees,
        COALESCE((SELECT jsonb_agg(role_code ORDER BY role_code) FROM member_role WHERE member_id=m.member_id), '[]'::jsonb) AS roles,
        COALESCE((SELECT jsonb_agg(s.skill_name ORDER BY s.skill_name) FROM member_skill ms JOIN skill s USING(skill_id) WHERE ms.member_id=m.member_id), '[]'::jsonb) AS skills
      FROM person p JOIN member m USING(person_id)) r`,
      ),
    );
    assert.deepEqual(actual, expected);
    const counts = Object.fromEntries(
      [
        'person',
        'member',
        'committee',
        'member_committee',
        'member_role',
        'member_skill',
        'role',
        'skill',
        'permission',
        'role_permission',
        'committee_permission',
        'events',
      ].map((table) => [
        table,
        Number(sql(seedDatabase, `SELECT count(*) FROM ${table}`)),
      ]),
    );
    assert.deepEqual(counts, {
      person: 11,
      member: 10,
      committee: 6,
      member_committee: 11,
      member_role: 3,
      member_skill: 15,
      role: 3,
      skill: 32,
      permission: 30,
      role_permission: 2,
      committee_permission: 8,
      events: 0,
    });
    assert.deepEqual(
      JSON.parse(
        sql(
          seedDatabase,
          'SELECT jsonb_object_agg(c.committee_code,p.committee_code) FROM committee c LEFT JOIN committee p ON p.committee_id=c.parent_committee_id',
        ),
      ),
      { DATA: null, DEV: null, WEB: 'DEV', CYBER: 'DEV', PM: null, PR: null },
    );
    for (const table of [
      'role',
      'skill',
      'permission',
      'role_permission',
      'committee_permission',
    ])
      assert.equal(
        domainRows(seedDatabase).find(([key]) => key === table)[1],
        initial.find(([key]) => key === table)[1],
      );
    assert.equal(
      sql(
        seedDatabase,
        "SELECT count(*) FROM person WHERE full_name='Unrelated sentinel' AND email_personal='sentinel@example.test'",
      ),
      '1',
    );
    const originalSentinel = JSON.parse(
      initial.find(([table]) => table === 'person')[1],
    )[0];
    assert.deepEqual(
      JSON.parse(
        domainRows(seedDatabase).find(([table]) => table === 'person')[1],
      ).find((row) => row.email_personal === 'sentinel@example.test'),
      originalSentinel,
    );
    sql(
      seedDatabase,
      "UPDATE person SET email_personal=' BABASET99@GMAIL.COM ' WHERE email_personal='babaset99@gmail.com'",
    );
    assert.deepEqual(
      committeePolicy(seedDatabase).permissions,
      approvedCommitteePolicy.permissions,
    );
    const matchedRules = JSON.parse(
      sql(
        seedDatabase,
        `SELECT jsonb_agg(to_jsonb(r) ORDER BY lower(email),code) FROM (
      SELECT p.email_personal AS email,c.committee_code,mc.role,cp.code,cp.applies_to
      FROM person p JOIN member m USING(person_id) JOIN member_committee mc USING(member_id)
      JOIN committee c ON c.committee_id=mc.committee_id
      JOIN committee_permission cp ON cp.committee_id=mc.committee_id AND cp.committee_role=mc.role) r`,
      ),
    );
    assert.deepEqual(
      matchedRules,
      [
        {
          email: 'data.coleader@example.test',
          committee_code: 'DATA',
          role: 'Co-Leader',
          code: 'events.create',
          applies_to: 'own',
        },
        {
          email: 'data.leader@example.test',
          committee_code: 'DATA',
          role: 'Leader',
          code: 'events.create',
          applies_to: 'own',
        },
        {
          email: 'MohmmadAlamri@gmail.com',
          committee_code: 'PR',
          role: 'Member',
          code: 'registrants.view',
          applies_to: 'all',
        },
        {
          email: 'MohmmadAlamri@gmail.com',
          committee_code: 'PR',
          role: 'Member',
          code: 'registrations.review',
          applies_to: 'all',
        },
      ],
      'Committee membership/position joins match only approved DATA leadership and PR rules; no DATA Member or unrelated-committee rule',
    );
    const normalized = domainRows(seedDatabase);
    seed(seedDatabase);
    assert.deepEqual(
      domainRows(seedDatabase),
      normalized,
      'Normalized email reuse must not rewrite stored values',
    );
    sql(
      seedDatabase,
      "UPDATE person SET email_personal='babaset99@gmail.com' WHERE email_personal=' BABASET99@GMAIL.COM '",
    );
    assert.deepEqual(
      JSON.parse(
        sql(
          seedDatabase,
          `SELECT jsonb_agg(to_jsonb(r) ORDER BY lower(email),role_code) FROM (
        SELECT p.email_personal AS email, mr.role_code,
          COALESCE(jsonb_agg(rp.code ORDER BY rp.code) FILTER (WHERE rp.code IS NOT NULL), '[]'::jsonb) AS permissions
        FROM person p JOIN member m USING(person_id) JOIN member_role mr USING(member_id)
        LEFT JOIN role_permission rp USING(role_code)
        GROUP BY p.email_personal, mr.role_code) r`,
        ),
      ),
      [
        {
          email: 'LeenAlghamdi@gmail.com',
          role_code: 'GROUP_LEADER',
          permissions: ['members.manage'],
        },
        {
          email: 'club.advisor@example.test',
          role_code: 'ADVISOR',
          permissions: [],
        },
        {
          email: 'club.coleader@example.test',
          role_code: 'GROUP_CO_LEADER',
          permissions: ['members.manage'],
        },
      ].sort((a, b) =>
        a.email.toLowerCase().localeCompare(b.email.toLowerCase()),
      ),
      'Only the club leader and co-leader match members.manage; the advisor has no permissions and committee leadership adds no global role',
    );
    const first = domainRows(seedDatabase);
    seed(seedDatabase);
    assert.deepEqual(
      domainRows(seedDatabase),
      first,
      'Repeat seed must preserve rows and timestamps',
    );
    sql(
      seedDatabase,
      "DELETE FROM member_skill WHERE member_id=(SELECT member_id FROM member JOIN person USING(person_id) WHERE email_personal='babaset99@gmail.com') AND skill_id=2",
    );
    seed(seedDatabase);
    assert.equal(sql(seedDatabase, 'SELECT count(*) FROM member_skill'), '15');
    assert.deepEqual(
      domainRows(seedDatabase).filter(([table]) => table !== 'member_skill'),
      first.filter(([table]) => table !== 'member_skill'),
    );
    sql(
      seedDatabase,
      "INSERT INTO member_skill(member_id,skill_id) SELECT member_id,32 FROM member JOIN person USING(person_id) WHERE email_personal='babaset99@gmail.com'",
    );
    const extra = domainRows(seedDatabase);
    seed(seedDatabase);
    assert.deepEqual(
      domainRows(seedDatabase),
      extra,
      'Additional selections must be preserved',
    );
    const conflictCases = [
      [
        'person name',
        "UPDATE person SET full_name='Conflicting name' WHERE email_personal='babaset99@gmail.com'",
        "UPDATE person SET full_name='Ammar Babaset' WHERE email_personal='babaset99@gmail.com'",
        'development_seed_conflict_person',
      ],
      [
        'member type',
        "UPDATE member SET member_type='alumni' WHERE person_id=(SELECT person_id FROM person WHERE email_personal='babaset99@gmail.com')",
        "UPDATE member SET member_type='current' WHERE person_id=(SELECT person_id FROM person WHERE email_personal='babaset99@gmail.com')",
        'development_seed_conflict_member',
      ],
      [
        'committee name',
        "UPDATE committee SET committee_name='Conflicting Web' WHERE committee_code='WEB'",
        "UPDATE committee SET committee_name='Web' WHERE committee_code='WEB'",
        'development_seed_conflict_committee',
      ],
      [
        'committee parent',
        "UPDATE committee SET parent_committee_id=(SELECT committee_id FROM committee WHERE committee_code='PM') WHERE committee_code='WEB'",
        "UPDATE committee SET parent_committee_id=(SELECT committee_id FROM committee WHERE committee_code='DEV') WHERE committee_code='WEB'",
        'development_seed_conflict_committee',
      ],
      [
        'committee position',
        "UPDATE member_committee SET role='Member' WHERE role='Leader' AND committee_id=(SELECT committee_id FROM committee WHERE committee_code='WEB')",
        "UPDATE member_committee SET role='Leader' WHERE member_id=(SELECT member_id FROM member JOIN person USING(person_id) WHERE email_personal='babaset99@gmail.com') AND committee_id=(SELECT committee_id FROM committee WHERE committee_code='WEB')",
        'development_seed_conflict_position',
      ],
      [
        'role metadata',
        "UPDATE member_role SET starts_on=DATE '2030-01-01'",
        'UPDATE member_role SET starts_on=NULL',
        'development_seed_conflict_role',
      ],
    ];
    for (const [label, change, restore, code] of conflictCases) {
      sql(seedDatabase, change);
      const before = domainRows(seedDatabase);
      assert.throws(() => seed(seedDatabase), new RegExp(code), label);
      assert.deepEqual(
        domainRows(seedDatabase),
        before,
        `${label} must not be overwritten`,
      );
      sql(seedDatabase, restore);
    }
    // Reconstruct the prior eight-person fixture only on this runner-owned database.
    sql(
      seedDatabase,
      `
      DELETE FROM member_role WHERE member_id IN (
        SELECT m.member_id FROM member m JOIN person p USING(person_id)
        WHERE p.email_personal IN ('club.coleader@example.test','club.advisor@example.test'));
      DELETE FROM member WHERE person_id IN (
        SELECT person_id FROM person WHERE email_personal IN ('club.coleader@example.test','club.advisor@example.test'));
      DELETE FROM person WHERE email_personal IN ('club.coleader@example.test','club.advisor@example.test');
    `,
    );
    const priorSeed = domainRows(seedDatabase);
    assert.equal(sql(seedDatabase, 'SELECT count(*) FROM member'), '8');
    seed(seedDatabase);
    const upgradedSeed = new Map(domainRows(seedDatabase));
    for (const [table, rows] of priorSeed) {
      const retained = new Set(
        JSON.parse(upgradedSeed.get(table)).map((row) => JSON.stringify(row)),
      );
      for (const row of JSON.parse(rows))
        assert(
          retained.has(JSON.stringify(row)),
          `Extending the old seed must preserve existing ${table} rows and timestamps`,
        );
    }
    assert.equal(sql(seedDatabase, 'SELECT count(*) FROM member'), '10');
    assert.equal(sql(seedDatabase, 'SELECT count(*) FROM member_role'), '3');
    const upgradedRows = domainRows(seedDatabase);
    seed(seedDatabase);
    assert.deepEqual(domainRows(seedDatabase), upgradedRows);

    for (const [suffix, change, code] of [
      [
        'role',
        "DELETE FROM role_permission WHERE role_code='GROUP_LEADER'; DELETE FROM role WHERE role_code='GROUP_LEADER'",
        'development_seed_missing_role',
      ],
      ...['GROUP_CO_LEADER', 'ADVISOR'].map((roleCode) => [
        `role_${roleCode.toLowerCase()}`,
        `DELETE FROM role_permission WHERE role_code='${roleCode}'; DELETE FROM role WHERE role_code='${roleCode}'`,
        'development_seed_missing_role',
      ]),
      [
        'advisor_conflict',
        "INSERT INTO person(full_name,email_personal) VALUES ('Existing conflicting advisor','club.advisor@example.test')",
        'development_seed_conflict_person',
      ],
      [
        'skill',
        "DELETE FROM skill WHERE skill_name='Research & Analysis'",
        'development_seed_missing_skill',
      ],
      [
        'parent',
        "INSERT INTO committee(committee_code,committee_name) VALUES ('DEV','Wrong Development')",
        'development_seed_conflict_committee',
      ],
    ]) {
      const database = `gdg_schema_test_seed_${suffix}`;
      createSeedDatabase(database);
      sql(database, change);
      const before = domainRows(database);
      assert.throws(() => seed(database), new RegExp(code));
      assert.deepEqual(
        domainRows(database),
        before,
        'Failure must roll back the entire partial graph',
      );
    }
    console.log(
      'PASS: optional seed exact graph, all three club roles/permission joins, eight-to-ten-member upgrade preservation, defaults, repeat/no-op, missing-link repair, unrelated data, conflict rejection and atomic rollback.',
    );
  }

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
    assertTables(database, expectedTables);
    assert.deepEqual(
      domainRows(database)
        .filter(
          ([table]) => !['committee', 'committee_permission'].includes(table),
        )
        .map(([table, rows]) => [
          table,
          JSON.parse(rows).sort((a, b) =>
            String(a.role_code ?? a.skill_id ?? a.code ?? '').localeCompare(
              String(b.role_code ?? b.skill_id ?? b.code ?? ''),
            ),
          ),
        ]),
      [...expectedTables]
        .filter(
          (table) => !['committee', 'committee_permission'].includes(table),
        )
        .sort()
        .map((table) => [
          table,
          table === 'role'
            ? [
                {
                  role_code: 'ADVISOR',
                  description: 'Club advisor',
                  is_privileged: true,
                },
                {
                  role_code: 'GROUP_LEADER',
                  description: 'Club (group) leader',
                  is_privileged: true,
                },
                {
                  role_code: 'GROUP_CO_LEADER',
                  description: 'Club (group) co-leader',
                  is_privileged: true,
                },
              ].sort((a, b) => a.role_code.localeCompare(b.role_code))
            : table === 'skill'
              ? [...approvedSkills].sort((a, b) =>
                  String(a.skill_id).localeCompare(String(b.skill_id)),
                )
              : table === 'permission'
                ? [...approvedPermissions].sort((a, b) =>
                    a.code.localeCompare(b.code),
                  )
                : table === 'role_permission'
                  ? approvedRolePermissions
                  : [],
        ]),
      'Tests must preserve approved seeds and clean up all committed fixtures',
    );
    assert.deepEqual(
      committeePolicy(database),
      approvedCommitteePolicy,
      'Fresh replay must contain exactly approved committees and rules',
    );
    dumps.push(schemaDump(database));
  }
  assert.equal(dumps[0], dumps[1], 'Clean database schemas differ');
  console.log(
    'PASS: two clean replays are equivalent; repeat deploy is a no-op.',
  );

  const migrations = migrationNames('prisma/migrations');
  assert(migrations.length > 0, 'Expected committed migration history');

  // Prove the fresh-only precondition independently for every old table, not just users.
  const freshMigration = '20261015164000_people_membership_fresh';
  const freshIndex = migrations.indexOf(freshMigration);
  assert(
    freshIndex > 0,
    'Expected the fresh-schema migration after initial history',
  );
  const preservedDatabase = 'gdg_schema_test_nonempty';
  run('docker', [
    'exec',
    name,
    'createdb',
    '-U',
    'postgres',
    preservedDatabase,
  ]);
  const preservedRoot = join(scratch, 'nonempty', 'prisma');
  copyMigrationHistory(
    'prisma',
    preservedRoot,
    migrations.slice(0, freshIndex),
  );
  const preservedConfig = join(scratch, 'nonempty', 'prisma.config.ts');
  writeFileSync(
    preservedConfig,
    `export default { schema: ${JSON.stringify(join(preservedRoot, 'schema.prisma'))}, migrations: { path: ${JSON.stringify(join(preservedRoot, 'migrations'))} }, datasource: { url: process.env.DATABASE_URL } };\n`,
  );
  run(
    'pnpm',
    ['exec', 'prisma', 'migrate', 'deploy', '--config', preservedConfig],
    { DATABASE_URL: url(preservedDatabase) },
  );
  const preservedSchema = schemaDump(preservedDatabase);
  const fixtures = JSON.parse(
    readFileSync('test/fixtures/initial-nonempty.json', 'utf8'),
  );
  assert.deepEqual(Object.keys(fixtures).sort(), [...initialTables].sort());
  const freshSQL = readFileSync(
    join('prisma/migrations', freshMigration, 'migration.sql'),
    'utf8',
  );
  for (const [table, insert] of Object.entries(fixtures)) {
    // Test server only: disable FK triggers to isolate one populated table at a time.
    sql(preservedDatabase, `SET session_replication_role=replica; ${insert}`);
    const rows = domainRows(preservedDatabase);
    assert.throws(
      () => sql(preservedDatabase, freshSQL),
      /people_membership_requires_empty_database/,
    );
    assert.equal(
      schemaDump(preservedDatabase),
      preservedSchema,
      `Nonempty ${table} schema changed`,
    );
    assert.deepEqual(
      domainRows(preservedDatabase),
      rows,
      `Nonempty ${table} records changed`,
    );
    assert.equal(
      sql(
        preservedDatabase,
        'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
      ),
      String(freshIndex),
    );
    assert.equal(
      sql(
        preservedDatabase,
        'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL',
      ),
      '0',
    );
    sql(
      preservedDatabase,
      `SET session_replication_role=replica; DELETE FROM "${table}"`,
    );
  }
  console.log(
    'PASS: fresh-schema migration rejected each populated initial table without changing records, schema, or history.',
  );

  // Verify this role-only step rejects old role rows but preserves unrelated people/permissions.
  const roleMigration = '20261015190000_role_registry';
  const roleIndex = migrations.indexOf(roleMigration);
  assert(roleIndex > freshIndex);
  const roleDatabase = 'gdg_schema_test_role_guard';
  run('docker', ['exec', name, 'createdb', '-U', 'postgres', roleDatabase]);
  for (const migration of migrations.slice(0, roleIndex)) {
    sql(
      roleDatabase,
      readFileSync(
        join('prisma/migrations', migration, 'migration.sql'),
        'utf8',
      ),
    );
  }
  sql(
    roleDatabase,
    "INSERT INTO person(full_name) VALUES ('Preserved role-stage person'); INSERT INTO permissions(permission_name) VALUES ('preserved.permission')",
  );
  const roleSQL = readFileSync(
    join('prisma/migrations', roleMigration, 'migration.sql'),
    'utf8',
  );
  for (const [table, insert] of [
    ['roles', "INSERT INTO roles(role_name) VALUES ('Legacy role')"],
    [
      'role_permissions',
      'INSERT INTO role_permissions(role_id,permission_id) VALUES (1,1)',
    ],
  ]) {
    sql(roleDatabase, `SET session_replication_role=replica; ${insert}`);
    const beforeSchema = schemaDump(roleDatabase);
    const beforeRows = domainRows(roleDatabase);
    assert.throws(
      () => sql(roleDatabase, roleSQL),
      /role_registry_requires_empty_role_tables/,
    );
    assert.equal(schemaDump(roleDatabase), beforeSchema);
    assert.deepEqual(domainRows(roleDatabase), beforeRows);
    sql(
      roleDatabase,
      `SET session_replication_role=replica; DELETE FROM "${table}"`,
    );
  }
  sql(roleDatabase, roleSQL);
  assert.equal(
    sql(roleDatabase, 'SELECT full_name FROM person'),
    'Preserved role-stage person',
  );
  assert.equal(
    sql(roleDatabase, 'SELECT permission_name FROM permissions'),
    'preserved.permission',
  );
  assert.equal(sql(roleDatabase, 'SELECT count(*) FROM role'), '3');
  console.log(
    'PASS: role migration preserves unrelated records and rejects each populated legacy role table.',
  );

  const assignmentMigration = '20261015200000_member_role';
  sql(
    roleDatabase,
    'INSERT INTO member(person_id) SELECT person_id FROM person',
  );
  const beforeAssignmentRows = domainRows(roleDatabase);
  sql(
    roleDatabase,
    readFileSync(
      join('prisma/migrations', assignmentMigration, 'migration.sql'),
      'utf8',
    ),
  );
  assertTables(roleDatabase, [
    ...beforeAssignmentRows.map(([table]) => table),
    'member_role',
  ]);
  assert.equal(sql(roleDatabase, 'SELECT count(*) FROM member_role'), '0');
  assert.deepEqual(
    domainRows(roleDatabase).filter(([table]) => table !== 'member_role'),
    beforeAssignmentRows,
  );
  console.log(
    'PASS: member-role migration creates no assignments and preserves all existing domain records.',
  );

  sql(
    roleDatabase,
    "INSERT INTO member_role(member_id, role_code) SELECT member_id, 'ADVISOR' FROM member",
  );
  const beforeSkillRows = domainRows(roleDatabase);
  sql(
    roleDatabase,
    readFileSync(
      'prisma/migrations/20261015210000_skill_registry/migration.sql',
      'utf8',
    ),
  );
  assertTables(roleDatabase, [
    ...beforeSkillRows.map(([table]) => table),
    'skill',
  ]);
  assert.deepEqual(
    domainRows(roleDatabase).filter(([table]) => table !== 'skill'),
    beforeSkillRows,
  );
  assert.deepEqual(
    JSON.parse(
      sql(
        roleDatabase,
        'SELECT jsonb_agg(to_jsonb(s) ORDER BY skill_id) FROM skill s',
      ),
    ),
    approvedSkills,
  );
  console.log(
    'PASS: skill migration preserves all previous records and inserts only the 32 approved reference skills.',
  );

  const beforeMemberSkillRows = domainRows(roleDatabase);
  sql(
    roleDatabase,
    readFileSync(
      'prisma/migrations/20261015220000_member_skill/migration.sql',
      'utf8',
    ),
  );
  assertTables(roleDatabase, [
    ...beforeMemberSkillRows.map(([table]) => table),
    'member_skill',
  ]);
  assert.equal(sql(roleDatabase, 'SELECT count(*) FROM member_skill'), '0');
  assert.deepEqual(
    domainRows(roleDatabase).filter(([table]) => table !== 'member_skill'),
    beforeMemberSkillRows,
  );
  console.log(
    'PASS: member-skill migration creates no links and preserves all previous domain records.',
  );

  const permissionSQL = readFileSync(
    'prisma/migrations/20261015230000_permission_registry/migration.sql',
    'utf8',
  );
  for (const [table, insert] of [
    ['permissions', null], // Preserved permission fixture already exists at this boundary.
    [
      'role_permissions',
      "INSERT INTO role_permissions(role_code, permission_id) VALUES ('ADVISOR', 1)",
    ],
  ]) {
    if (insert)
      sql(roleDatabase, `SET session_replication_role=replica; ${insert}`);
    const beforeSchema = schemaDump(roleDatabase);
    const beforeRows = domainRows(roleDatabase);
    assert.throws(
      () => sql(roleDatabase, permissionSQL),
      /permission_registry_requires_empty_permission_tables/,
    );
    assert.equal(schemaDump(roleDatabase), beforeSchema);
    assert.deepEqual(domainRows(roleDatabase), beforeRows);
    // Only runner-owned synthetic records are removed to exercise the next isolated case.
    sql(
      roleDatabase,
      `SET session_replication_role=replica; DELETE FROM "${table}"`,
    );
  }
  const beforePermissionRows = domainRows(roleDatabase);
  sql(roleDatabase, permissionSQL);
  assertTables(
    roleDatabase,
    beforePermissionRows.map(([table]) =>
      table === 'permissions' ? 'permission' : table,
    ),
  );
  assert.deepEqual(
    domainRows(roleDatabase),
    beforePermissionRows
      .map(([table, rows]) => [
        table === 'permissions' ? 'permission' : table,
        rows,
      ])
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  console.log(
    'PASS: permission migration rejects each populated old permission table and preserves unrelated records with no permission seeds.',
  );

  const rolePermissionSQL = readFileSync(
    'prisma/migrations/20261015233000_role_permission/migration.sql',
    'utf8',
  );
  sql(
    roleDatabase,
    "INSERT INTO permission(code, description, scope) VALUES ('test.preserved', 'Preserved permission', 'global'); INSERT INTO role_permissions(role_code, code) VALUES ('ADVISOR', 'test.preserved')",
  );
  const populatedLinkSchema = schemaDump(roleDatabase);
  const populatedLinkRows = domainRows(roleDatabase);
  assert.throws(
    () => sql(roleDatabase, rolePermissionSQL),
    /role_permission_requires_empty_link_table/,
  );
  assert.equal(schemaDump(roleDatabase), populatedLinkSchema);
  assert.deepEqual(domainRows(roleDatabase), populatedLinkRows);
  sql(roleDatabase, 'DELETE FROM role_permissions'); // Runner-owned synthetic link only.
  const beforeRolePermissionRows = domainRows(roleDatabase);
  sql(roleDatabase, rolePermissionSQL);
  assertTables(
    roleDatabase,
    expectedTables.filter((table) => table !== 'committee_permission'),
  );
  assert.equal(sql(roleDatabase, 'SELECT count(*) FROM role_permission'), '0');
  assert.deepEqual(
    domainRows(roleDatabase),
    beforeRolePermissionRows
      .map(([table, rows]) => [
        table === 'role_permissions' ? 'role_permission' : table,
        rows,
      ])
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  console.log(
    'PASS: role-permission migration rejects populated legacy links and preserves all other records without seeding assignments.',
  );

  const permissionReferenceSQL = readFileSync(
    'prisma/migrations/20261016220000_permission_reference_values/migration.sql',
    'utf8',
  );
  sql(
    roleDatabase,
    "INSERT INTO role_permission(role_code, code) VALUES ('ADVISOR', 'test.preserved')",
  );
  const beforeReferenceSchema = schemaDump(roleDatabase);
  const collision = approvedPermissions.at(-1);
  for (const description of [
    collision.description,
    'Existing local definition',
  ]) {
    const row = JSON.stringify({ ...collision, description }).replaceAll(
      "'",
      "''",
    );
    sql(
      roleDatabase,
      `INSERT INTO permission SELECT * FROM jsonb_populate_record(NULL::permission, '${row}'::jsonb)`,
    );
    const beforeRows = domainRows(roleDatabase);
    assert.throws(
      () => sql(roleDatabase, permissionReferenceSQL),
      /permission_pkey/,
    );
    assert.equal(schemaDump(roleDatabase), beforeReferenceSchema);
    assert.deepEqual(
      domainRows(roleDatabase),
      beforeRows,
      'A colliding permission definition must roll back the whole migration',
    );
    sql(roleDatabase, `DELETE FROM permission WHERE code='${collision.code}'`); // Runner-owned collision fixture only.
  }
  const beforeReferenceRows = domainRows(roleDatabase);
  sql(roleDatabase, permissionReferenceSQL);
  assert.equal(
    schemaDump(roleDatabase),
    beforeReferenceSchema,
    'Reference insertion must not change schema',
  );
  assert.deepEqual(
    domainRows(roleDatabase).filter(([table]) => table !== 'permission'),
    beforeReferenceRows.filter(([table]) => table !== 'permission'),
    'Reference insertion must preserve all other records and existing role links',
  );
  assert.deepEqual(
    JSON.parse(
      sql(
        roleDatabase,
        'SELECT jsonb_agg(to_jsonb(p) ORDER BY code) FROM permission p',
      ),
    ),
    [
      ...JSON.parse(
        beforeReferenceRows.find(([table]) => table === 'permission')[1],
      ),
      ...approvedPermissions,
    ].sort((a, b) => a.code.localeCompare(b.code)),
  );
  console.log(
    'PASS: permission reference migration inserts exactly the approved definitions, preserves unrelated records and role links, and rejects identical/conflicting codes atomically.',
  );

  const committeeSQL = readFileSync(
    'prisma/migrations/20261016230000_committee_permissions/migration.sql',
    'utf8',
  );
  sql(
    roleDatabase,
    "INSERT INTO committee(committee_code,committee_name) VALUES ('NAME_COLLISION','Data')",
  );
  let beforeCommitteeRows = domainRows(roleDatabase);
  let beforeCommitteeSchema = schemaDump(roleDatabase);
  assert.throws(
    () => sql(roleDatabase, committeeSQL),
    /committee_committee_name_key/,
  );
  assert.deepEqual(domainRows(roleDatabase), beforeCommitteeRows);
  assert.equal(schemaDump(roleDatabase), beforeCommitteeSchema);
  sql(
    roleDatabase,
    "DELETE FROM committee WHERE committee_code='NAME_COLLISION'",
  ); // Runner-owned synthetic collision only.
  sql(
    roleDatabase,
    "INSERT INTO committee(committee_id,committee_code,committee_name) VALUES (-201,'DATA','Data'),(-202,'PR','Public Relations'),(-203,'PRESERVED','Preserved committee')",
  );
  for (const committee of ['DATA', 'PR'])
    for (const conflict of ['name', 'parent']) {
      sql(
        roleDatabase,
        conflict === 'name'
          ? `UPDATE committee SET committee_name='Conflicting ${committee}' WHERE committee_code='${committee}'`
          : `UPDATE committee SET parent_committee_id=-203 WHERE committee_code='${committee}'`,
      );
      beforeCommitteeRows = domainRows(roleDatabase);
      beforeCommitteeSchema = schemaDump(roleDatabase);
      assert.throws(
        () => sql(roleDatabase, committeeSQL),
        /committee_permission_requires_matching_committees/,
      );
      assert.deepEqual(domainRows(roleDatabase), beforeCommitteeRows);
      assert.equal(schemaDump(roleDatabase), beforeCommitteeSchema);
      sql(
        roleDatabase,
        `UPDATE committee SET committee_name='${committee === 'DATA' ? 'Data' : 'Public Relations'}',parent_committee_id=NULL WHERE committee_code='${committee}'`,
      );
    }
  const missingPermission = approvedPermissions.find(
    (row) => row.code === 'events.create',
  );
  sql(roleDatabase, "DELETE FROM permission WHERE code='events.create'"); // Runner-owned missing-reference fixture only.
  beforeCommitteeRows = domainRows(roleDatabase);
  beforeCommitteeSchema = schemaDump(roleDatabase);
  assert.throws(
    () => sql(roleDatabase, committeeSQL),
    /committee_permission_code_fkey/,
  );
  assert.deepEqual(domainRows(roleDatabase), beforeCommitteeRows);
  assert.equal(schemaDump(roleDatabase), beforeCommitteeSchema);
  sql(
    roleDatabase,
    `INSERT INTO permission SELECT * FROM jsonb_populate_record(NULL::permission,'${JSON.stringify(missingPermission).replaceAll("'", "''")}'::jsonb)`,
  );
  beforeCommitteeRows = domainRows(roleDatabase);
  sql(roleDatabase, committeeSQL);
  assertTables(roleDatabase, expectedTables);
  assert.deepEqual(
    domainRows(roleDatabase).filter(
      ([table]) => table !== 'committee_permission',
    ),
    beforeCommitteeRows,
    'Compatible committee IDs and all existing records/links must remain unchanged',
  );
  assert.deepEqual(
    committeePolicy(roleDatabase).permissions,
    approvedCommitteePolicy.permissions,
  );
  assert.equal(
    sql(
      roleDatabase,
      'SELECT count(*) FROM committee_permission WHERE committee_id NOT IN (-201,-202)',
    ),
    '0',
  );
  console.log(
    'PASS: committee permissions preserve compatible local IDs and all previous records, reject committee name/parent conflicts and missing permissions atomically, and insert exactly eight rules.',
  );

  const clubRoleSQL = readFileSync(
    'prisma/migrations/20261016233000_club_role_permissions/migration.sql',
    'utf8',
  );
  const beforeClubSchema = schemaDump(roleDatabase);
  // All collision/missing-reference fixtures belong only to this disposable database.
  for (const roleCode of ['GROUP_LEADER', 'GROUP_CO_LEADER']) {
    sql(
      roleDatabase,
      `INSERT INTO role_permission(role_code,code) VALUES ('${roleCode}','members.manage')`,
    );
    const before = domainRows(roleDatabase);
    assert.throws(() => sql(roleDatabase, clubRoleSQL), /role_permission_pkey/);
    assert.deepEqual(
      domainRows(roleDatabase),
      before,
      'A duplicate pair must roll back both grants',
    );
    assert.equal(schemaDump(roleDatabase), beforeClubSchema);
    sql(
      roleDatabase,
      `DELETE FROM role_permission WHERE role_code='${roleCode}' AND code='members.manage'`,
    );
  }
  for (const roleCode of ['GROUP_LEADER', 'GROUP_CO_LEADER']) {
    const role = sql(
      roleDatabase,
      `SELECT to_jsonb(r) FROM role r WHERE role_code='${roleCode}'`,
    );
    sql(roleDatabase, `DELETE FROM role WHERE role_code='${roleCode}'`);
    const before = domainRows(roleDatabase);
    assert.throws(
      () => sql(roleDatabase, clubRoleSQL),
      /role_permission_role_code_fkey/,
    );
    assert.deepEqual(domainRows(roleDatabase), before);
    sql(
      roleDatabase,
      `INSERT INTO role SELECT * FROM jsonb_populate_record(NULL::role,'${role.replaceAll("'", "''")}'::jsonb)`,
    );
  }
  const managePermission = sql(
    roleDatabase,
    "SELECT to_jsonb(p) FROM permission p WHERE code='members.manage'",
  );
  sql(roleDatabase, "DELETE FROM permission WHERE code='members.manage'");
  const beforeMissingPermission = domainRows(roleDatabase);
  assert.throws(
    () => sql(roleDatabase, clubRoleSQL),
    /role_permission_code_fkey/,
  );
  assert.deepEqual(domainRows(roleDatabase), beforeMissingPermission);
  sql(
    roleDatabase,
    `INSERT INTO permission SELECT * FROM jsonb_populate_record(NULL::permission,'${managePermission.replaceAll("'", "''")}'::jsonb)`,
  );
  const beforeClubRows = domainRows(roleDatabase);
  sql(roleDatabase, clubRoleSQL);
  assert.equal(schemaDump(roleDatabase), beforeClubSchema);
  assert.deepEqual(
    domainRows(roleDatabase).filter(([table]) => table !== 'role_permission'),
    beforeClubRows.filter(([table]) => table !== 'role_permission'),
    'Club policy insertion must preserve all other data, including committee rules and member roles',
  );
  assert.deepEqual(
    JSON.parse(
      sql(
        roleDatabase,
        'SELECT jsonb_agg(to_jsonb(r) ORDER BY role_code,code) FROM role_permission r',
      ),
    ),
    [
      { role_code: 'ADVISOR', code: 'test.preserved' },
      ...approvedRolePermissions,
    ],
    'Insert only two approved pairs and retain unrelated local policy',
  );
  console.log(
    'PASS: club role migration inserts only two approved links, preserves schema/all other records/existing links, and rejects duplicate pairs and missing references atomically.',
  );

  function verifyFailure(source, history, database, expected) {
    run('docker', ['exec', name, 'createdb', '-U', 'postgres', database]);
    const target = history.at(-1);
    const predecessors = history.slice(0, -1);
    const failureRoot = join(scratch, database, 'prisma');
    copyMigrationHistory(source, failureRoot, predecessors);
    const config = join(scratch, database, 'prisma.config.ts');
    // Config contains no credentials and uses only the runner-owned URL.
    writeFileSync(
      config,
      `export default { schema: ${JSON.stringify(join(failureRoot, 'schema.prisma'))}, migrations: { path: ${JSON.stringify(join(failureRoot, 'migrations'))} }, datasource: { url: process.env.DATABASE_URL } };\n`,
    );
    const args = ['exec', 'prisma', 'migrate', 'deploy', '--config', config];
    if (predecessors.length) {
      run('pnpm', args, { DATABASE_URL: url(database) });
      // Separate schema: the sentinel never changes the expected project-table manifest.
      sql(
        database,
        "CREATE SCHEMA runner_fixture; CREATE TABLE runner_fixture.preserved(id integer PRIMARY KEY, value text NOT NULL); INSERT INTO runner_fixture.preserved VALUES (1, 'preserved')",
      );
    }
    const beforeSchema = schemaDump(database);
    const beforeRows = domainRows(database);
    const original = readFileSync(
      join(source, 'migrations', target, 'migration.sql'),
      'utf8',
    );
    const targetDirectory = join(failureRoot, 'migrations', target);
    mkdirSync(targetDirectory, { recursive: true });
    const targetFile = join(targetDirectory, 'migration.sql');
    const injected = injectMigrationFailure(original);
    writeFileSync(
      targetFile,
      predecessors.length
        ? injected.replace(
            'SELECT 1 / 0;',
            "UPDATE runner_fixture.preserved SET value = 'changed';\nSELECT 1 / 0;",
          )
        : injected,
    );
    let failed = false;
    try {
      run('pnpm', args, { DATABASE_URL: url(database) });
    } catch (error) {
      assert.match(
        error.message,
        /division by zero|current transaction is aborted/,
      );
      failed = true;
    }
    assert(failed, 'Injected migration failure must be observed');
    assert.equal(
      schemaDump(database),
      beforeSchema,
      'Failed migration changed the previous schema',
    );
    assert.deepEqual(
      domainRows(database),
      beforeRows,
      'Failed migration changed previous domain data',
    );
    if (predecessors.length)
      assert.equal(
        sql(database, 'SELECT value FROM runner_fixture.preserved WHERE id=1'),
        'preserved',
      );

    function assertHistory(recovered) {
      for (const migration of history) {
        // Names come only from repository migration directories or the runner-owned probe.
        const escaped = migration.replaceAll("'", "''");
        assert.equal(
          sql(
            database,
            `SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) || ':' || count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) || ':' || count(*) FILTER (WHERE rolled_back_at IS NOT NULL) FROM _prisma_migrations WHERE migration_name='${escaped}'`,
          ),
          migration === target ? (recovered ? '1:0:1' : '0:1:0') : '1:0:0',
          `Unexpected history for ${migration}`,
        );
      }
    }
    assertHistory(false);
    console.log(
      `PASS: ${target} failure preserved predecessor schema/data and recorded failed history.`,
    );
    writeFileSync(targetFile, original);
    run(
      'pnpm',
      [
        'exec',
        'prisma',
        'migrate',
        'resolve',
        '--rolled-back',
        target,
        '--config',
        config,
      ],
      { DATABASE_URL: url(database) },
    );
    run('pnpm', args, { DATABASE_URL: url(database) });
    assertHistory(true);
    assertTables(database, expected);
    if (predecessors.length)
      assert.equal(
        sql(database, 'SELECT value FROM runner_fixture.preserved WHERE id=1'),
        'preserved',
      );
    assert.match(
      run('pnpm', args, { DATABASE_URL: url(database) }),
      /No pending migrations/,
    );
    console.log(
      `PASS: ${target} recovery succeeded; repeat deploy is a no-op.`,
    );
  }

  verifyFailure(
    'prisma',
    migrations.slice(0, 1),
    'gdg_schema_test_initial_failure',
    initialTables,
  );
  if (migrations.length > 1) {
    verifyFailure(
      'prisma',
      migrations,
      'gdg_schema_test_latest_failure',
      expectedTables,
    );
  }
  // Exercise multiple migrations even while the repository has only its initial migration.
  const probeRoot = join(scratch, 'probe');
  copyMigrationHistory('prisma', probeRoot, migrations);
  const probe = '99999999999999_runner_probe';
  assert(
    probe > migrations.at(-1),
    'Probe must sort after committed migrations',
  );
  mkdirSync(join(probeRoot, 'migrations', probe));
  writeFileSync(
    join(probeRoot, 'migrations', probe, 'migration.sql'),
    'BEGIN;\nCREATE TABLE runner_probe(id integer PRIMARY KEY);\nINSERT INTO runner_probe VALUES (1);\nCOMMIT;\n',
  );
  verifyFailure(
    probeRoot,
    [...migrations, probe],
    'gdg_schema_test_probe_failure',
    [...expectedTables, 'runner_probe'],
  );
  assert.equal(
    sql('gdg_schema_test_probe_failure', 'SELECT id FROM runner_probe'),
    '1',
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
    assert.equal(
      sql(
        database,
        "SELECT count(*) FROM events e JOIN committee c USING(committee_id) WHERE c.committee_code='SYNTHETIC'",
      ),
      '103',
      'Performance events must use their own generated committee ID',
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
        `SELECT min(registration_id) FROM event_registrations WHERE person_id=1`,
      );
      const queries = {
        'PR status page': `SELECT registration_id,person_id,status FROM event_registrations WHERE event_id=${eventId} AND status='PENDING' ORDER BY registered_at,registration_id LIMIT 50`,
        'My Events cursor page': `SELECT registration_id,event_id,status FROM event_registrations WHERE person_id=1 AND (registered_at,registration_id) > (SELECT registered_at,registration_id FROM event_registrations WHERE registration_id=${cursor}) ORDER BY registered_at,registration_id LIMIT 50`,
        'Reserved seats': `SELECT count(*) FROM event_registrations WHERE event_id=${eventId} AND status IN ('AWAITING_CONFIRMATION','CONFIRMED')`,
        'Next waitlist entry': `SELECT registration_id,person_id FROM event_registrations WHERE event_id=${eventId} AND status='WAITLISTED' ORDER BY waitlist_position LIMIT 1`,
        'Expiry batch': `SELECT registration_id,event_id FROM event_registrations WHERE status='AWAITING_CONFIRMATION' AND confirmation_deadline <= now() ORDER BY confirmation_deadline,registration_id LIMIT 50`,
        'Due events': `SELECT event_id FROM events WHERE status='published' AND ends_at<=now() ORDER BY ends_at,event_id LIMIT 50`,
        'Token lookup': `SELECT registration_id,event_id,status FROM event_registrations WHERE attendance_token_hash=md5('${eventId}:5')`,
        Questions: `SELECT question_id,question_text,question_type FROM event_questions WHERE event_id=${eventId} ORDER BY position`,
        'Warning flags page': `SELECT r.registration_id,r.person_id,COALESCE((SELECT true FROM event_registrations history JOIN registration_blacklist_entries b ON b.registration_id=history.registration_id WHERE history.person_id=r.person_id AND b.resolved_at IS NULL LIMIT 1),false) AS has_notice FROM event_registrations r WHERE r.event_id=${eventId} ORDER BY r.registered_at,r.registration_id LIMIT 50`,
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
    assertTables(startupDb, expectedTables);
    let startupSeedRows;
    if (process.argv.includes('--seed')) {
      console.log(
        run(
          'docker',
          [
            'exec',
            '-e',
            'DATABASE_URL',
            '-e',
            'NODE_ENV=test',
            backendName,
            'pnpm',
            'seed:dev',
          ],
          {
            DATABASE_URL: url(startupDb).replace(
              `127.0.0.1:${port}`,
              'db:5432',
            ),
          },
        ),
      );
      sql(
        startupDb,
        'DELETE FROM member_skill WHERE id=(SELECT min(id) FROM member_skill)',
      );
      startupSeedRows = domainRows(startupDb);
    }

    sql(
      startupDb,
      "INSERT INTO person(full_name,email_personal) VALUES ('Preserved fixture','preserved@example.test')",
    );
    stopBackend();
    await waitForHttp(startBackend());
    if (startupSeedRows) {
      const withoutSentinel = domainRows(startupDb).map(([table, rows]) => [
        table,
        table === 'person'
          ? JSON.stringify(
              JSON.parse(rows).filter(
                (row) => row.email_personal !== 'preserved@example.test',
              ),
            )
          : rows,
      ]);
      // Compare parsed records because jsonb text formatting differs from JSON.stringify.
      assert.deepEqual(
        withoutSentinel.map(([table, rows]) => [table, JSON.parse(rows)]),
        startupSeedRows.map(([table, rows]) => [table, JSON.parse(rows)]),
        'Ordinary startup must not rerun the optional seed or repair deleted demo links',
      );
    }
    assert.equal(
      sql(
        startupDb,
        "SELECT count(*) FROM person WHERE email_personal='preserved@example.test'",
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
