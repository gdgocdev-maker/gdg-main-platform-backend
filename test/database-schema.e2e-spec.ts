import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../src/generated/prisma/client.js';
import { schemaTestTarget } from './schema-test-target.js';

type Tx = Prisma.TransactionClient;
type Patch = Record<string, string | number | boolean | Date | null>;
const approved = new Date('2030-01-01T10:00:00Z');
const deadline = new Date('2030-01-01T12:00:00Z');
const confirmed = new Date('2030-01-01T11:00:00Z');
const cancelled = new Date('2030-01-01T11:30:00Z');
const approval = { approved_at: approved, confirmation_deadline: deadline };
const confirmation = {
  ...approval,
  confirmed_at: confirmed,
  attendance_token_hash: 'synthetic-hash',
  attendance_token_encrypted: 'synthetic-ciphertext',
};
const excuse = {
  excused_at: cancelled,
  excused_by: 0,
  excuse_reason: 'Documented excuse',
};
const rollback = new Error('rollback successful fixture');

// Normal app e2e runs do not connect to a schema target unless explicitly supplied.
describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'PostgreSQL schema integrity',
  () => {
    let db: PrismaClient;

    beforeAll(async () => {
      const connectionString = schemaTestTarget(
        process.env.TEST_DATABASE_URL,
        process.env.DATABASE_URL,
      );
      db = new PrismaClient({
        adapter: new PrismaPg({
          connectionString,
          max: 4,
          connectionTimeoutMillis: 5000,
        }),
      });
      await db.$connect();
    });
    afterAll(async () => {
      await db?.$disconnect();
    });

    async function fixture(tx: Tx) {
      const code = randomUUID();
      const user = await tx.user.create({
        data: {
          fullName: 'Synthetic participant',
          email: `${code}@example.test`,
        },
      });
      const committee = await tx.committee.create({
        data: { committeeCode: code, committeeName: code },
      });
      const event = await tx.event.create({
        data: {
          name: 'Synthetic event',
          capacity: 1,
          startsAt: new Date('2030-01-02T10:00:00Z'),
          endsAt: new Date('2030-01-02T12:00:00Z'),
          registrationDeadline: deadline,
          createdBy: user.userId,
          committeeId: committee.committeeId,
        },
      });
      const question = await tx.eventQuestion.create({
        data: {
          eventId: event.eventId,
          questionText: 'Why attend?',
          questionType: 'TEXT',
          position: 0,
        },
      });
      const registration = await tx.eventRegistration.create({
        data: { eventId: event.eventId, userId: user.userId },
      });
      return { user, committee, event, question, registration };
    }
    type Fixture = Awaited<ReturnType<typeof fixture>>;

    async function patch(
      tx: Tx,
      table: string,
      key: string,
      id: number,
      values: Patch,
    ) {
      const entries = Object.entries(values);
      // Identifiers come only from literal test cases; all values are parameters.
      await tx.$executeRawUnsafe(
        `UPDATE "${table}" SET ${entries.map(([name], i) => `"${name}" = $${i + 1}`).join(', ')} WHERE "${key}" = $${entries.length + 1}`,
        ...entries.map(([, value]) => value),
        id,
      );
    }

    async function valid(action: (tx: Tx, f: Fixture) => Promise<void>) {
      try {
        await db.$transaction(async (tx) => {
          await action(tx, await fixture(tx));
          throw rollback;
        });
      } catch (error) {
        if (error !== rollback) throw error;
      }
    }

    async function invalid(
      action: (tx: Tx, f: Fixture) => Promise<void>,
      constraint: string,
    ) {
      await expect(
        db.$transaction(async (tx) => {
          await action(tx, await fixture(tx));
        }),
      ).rejects.toThrow(constraint);
    }

    it('installs all sixteen custom checks through migration history', async () => {
      const rows = await db.$queryRaw<
        { conname: string }[]
      >`SELECT conname FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace ORDER BY conname`;
      expect(rows.map((row) => row.conname)).toEqual([
        'blacklist_resolution_check',
        'committee_parent_not_self_check',
        'event_questions_options_check',
        'event_questions_position_check',
        'events_capacity_check',
        'events_confirmation_window_check',
        'events_schedule_check',
        'member_branch_check',
        'registrations_approval_check',
        'registrations_cancellation_check',
        'registrations_check_in_check',
        'registrations_confirmation_check',
        'registrations_excuse_check',
        'registrations_token_check',
        'registrations_waitlist_position_check',
        'users_email_canonical_check',
      ]);
    });

    it.each<[string, Patch]>([
      ['PENDING', {}],
      ['WAITLISTED', { waitlist_position: 1 }],
      ['AWAITING_CONFIRMATION', approval],
      ['CONFIRMED', confirmation],
      ['DECLINED', {}],
      ['CANCELLED', { ...confirmation, cancelled_at: cancelled }],
      ['LATE_CANCELLATION', { ...confirmation, cancelled_at: cancelled }],
      ['NOT_SELECTED', {}],
      ['REJECTED', {}],
      ['EXPIRED', approval],
      ['NO_CHECK_IN', confirmation],
      ['EXCUSED', { ...approval, ...excuse }],
    ])(
      'allows valid %s records, including optional membership',
      async (status, fields) => {
        await valid(async (tx, f) => {
          expect(f.user.memberId).toBeNull();
          await patch(
            tx,
            'event_registrations',
            'registration_id',
            f.registration.registrationId,
            {
              status,
              ...fields,
              ...(status === 'EXCUSED' ? { excused_by: f.user.userId } : {}),
            },
          );
        });
      },
    );

    it.each(['CANCELLED', 'LATE_CANCELLATION', 'NO_CHECK_IN'])(
      'retains %s confirmation and QR history when excused',
      async (prior) => {
        await valid(async (tx, f) => {
          await patch(
            tx,
            'event_registrations',
            'registration_id',
            f.registration.registrationId,
            {
              status: prior,
              ...confirmation,
              ...(prior !== 'NO_CHECK_IN' ? { cancelled_at: cancelled } : {}),
            },
          );
          await patch(
            tx,
            'event_registrations',
            'registration_id',
            f.registration.registrationId,
            { status: 'EXCUSED', ...excuse, excused_by: f.user.userId },
          );
          const record = await tx.eventRegistration.findUniqueOrThrow({
            where: { registrationId: f.registration.registrationId },
          });
          expect(record.confirmedAt).toEqual(confirmed);
          expect(record.attendanceTokenHash).toBe('synthetic-hash');
        });
      },
    );

    const registrationFailures: [string, Patch, string][] = [
      [
        'waitlist without position',
        { status: 'WAITLISTED' },
        'registrations_waitlist_position_check',
      ],
      [
        'zero waitlist position',
        { status: 'WAITLISTED', waitlist_position: 0 },
        'registrations_waitlist_position_check',
      ],
      [
        'position on pending',
        { waitlist_position: 1 },
        'registrations_waitlist_position_check',
      ],
      [
        'missing approval',
        { status: 'AWAITING_CONFIRMATION' },
        'registrations_approval_check',
      ],
      [
        'partial approval',
        { approved_at: approved },
        'registrations_approval_check',
      ],
      [
        'equal deadline',
        { ...approval, confirmation_deadline: approved },
        'registrations_approval_check',
      ],
      [
        'missing confirmation',
        { status: 'CONFIRMED', ...approval },
        'registrations_confirmation_check',
      ],
      [
        'expired with confirmation',
        { status: 'EXPIRED', ...confirmation },
        'registrations_confirmation_check',
      ],
      [
        'confirmation at deadline',
        { status: 'CONFIRMED', ...confirmation, confirmed_at: deadline },
        'registrations_confirmation_check',
      ],
      [
        'confirmation before approval',
        {
          status: 'CONFIRMED',
          ...confirmation,
          confirmed_at: new Date('2030-01-01T09:00:00Z'),
        },
        'registrations_confirmation_check',
      ],
      [
        'missing cancellation',
        { status: 'CANCELLED', ...confirmation },
        'registrations_cancellation_check',
      ],
      [
        'cancellation before confirmation',
        { status: 'CANCELLED', ...confirmation, cancelled_at: approved },
        'registrations_cancellation_check',
      ],
      [
        'cancellation on confirmed',
        { status: 'CONFIRMED', ...confirmation, cancelled_at: cancelled },
        'registrations_cancellation_check',
      ],
      ['missing excuse', { status: 'EXCUSED' }, 'registrations_excuse_check'],
      [
        'partial excuse',
        { status: 'EXCUSED', excused_at: cancelled },
        'registrations_excuse_check',
      ],
      [
        'excuse on pending',
        { excuse_reason: 'Reason' },
        'registrations_excuse_check',
      ],
      [
        'missing token pair',
        {
          status: 'CONFIRMED',
          ...confirmation,
          attendance_token_hash: null,
          attendance_token_encrypted: null,
        },
        'registrations_token_check',
      ],
      [
        'partial token pair',
        { status: 'CONFIRMED', ...confirmation, attendance_token_hash: null },
        'registrations_token_check',
      ],
      [
        'empty token',
        { status: 'CONFIRMED', ...confirmation, attendance_token_hash: ' ' },
        'registrations_token_check',
      ],
      [
        'token before confirmation',
        { attendance_token_hash: 'hash', attendance_token_encrypted: 'cipher' },
        'registrations_token_check',
      ],
      [
        'partial check-in',
        { status: 'CONFIRMED', ...confirmation, checked_in_at: cancelled },
        'registrations_check_in_check',
      ],
      [
        'check-in before confirmation',
        {
          status: 'CONFIRMED',
          ...confirmation,
          checked_in_at: approved,
          checked_in_by: 0,
        },
        'registrations_check_in_check',
      ],
      [
        'NO_CHECK_IN with scan',
        {
          status: 'NO_CHECK_IN',
          ...confirmation,
          checked_in_at: cancelled,
          checked_in_by: 0,
        },
        'registrations_check_in_check',
      ],
      [
        'cancelled and scanned',
        {
          status: 'CANCELLED',
          ...confirmation,
          cancelled_at: cancelled,
          checked_in_at: cancelled,
          checked_in_by: 0,
        },
        'registrations_check_in_check',
      ],
    ];
    it.each(registrationFailures)(
      'rejects %s',
      async (_name, fields, constraint) => {
        await invalid(
          (tx, f) =>
            patch(
              tx,
              'event_registrations',
              'registration_id',
              f.registration.registrationId,
              {
                ...fields,
                ...('checked_in_by' in fields
                  ? { checked_in_by: f.user.userId }
                  : {}),
              },
            ),
          constraint,
        );
      },
    );

    it.each<[string, string, Patch, string]>([
      [
        'noncanonical email',
        'users',
        { email: ' Upper@Example.test ' },
        'users_email_canonical_check',
      ],
      ['empty email', 'users', { email: '' }, 'users_email_canonical_check'],
      ['self parent', 'committee', {}, 'committee_parent_not_self_check'],
      ['zero capacity', 'events', { capacity: 0 }, 'events_capacity_check'],
      [
        'negative window',
        'events',
        { confirmation_window_hours: -1 },
        'events_confirmation_window_check',
      ],
      [
        'end before start',
        'events',
        { ends_at: approved },
        'events_schedule_check',
      ],
      [
        'late registration deadline',
        'events',
        { registration_deadline: new Date('2031-01-01T00:00:00Z') },
        'events_schedule_check',
      ],
      [
        'negative question position',
        'event_questions',
        { position: -1 },
        'event_questions_position_check',
      ],
      [
        'text with choices',
        'event_questions',
        { options: '["A"]' },
        'event_questions_options_check',
      ],
      [
        'choice without options',
        'event_questions',
        { question_type: 'select' },
        'event_questions_options_check',
      ],
      [
        'empty choices',
        'event_questions',
        { question_type: 'select', options: '[]' },
        'event_questions_options_check',
      ],
      [
        'JSON null choices',
        'event_questions',
        { question_type: 'select', options: 'null' },
        'event_questions_options_check',
      ],
      [
        'object choices',
        'event_questions',
        { question_type: 'checkbox', options: '{}' },
        'event_questions_options_check',
      ],
      [
        'scalar choices',
        'event_questions',
        { question_type: 'radio', options: '"A"' },
        'event_questions_options_check',
      ],
    ])('rejects %s', async (_name, table, fields, constraint) => {
      await invalid(async (tx, f) => {
        const target = {
          users: ['user_id', f.user.userId],
          committee: ['committee_id', f.committee.committeeId],
          events: ['event_id', f.event.eventId],
          event_questions: ['question_id', f.question.questionId],
        }[table] as [string, number];
        await patch(
          tx,
          table,
          target[0],
          target[1],
          table === 'committee' ? { parent_committee_id: target[1] } : fields,
        );
      }, constraint);
    });

    it('accepts nullable branches and rejects undocumented branch values', async () => {
      await valid(async (tx) => {
        const member = await tx.member.create({
          data: { fullName: 'Synthetic member' },
        });
        expect(member.branch).toBeNull();
        await patch(tx, 'member', 'member_id', member.memberId, {
          branch: 'MAIN_F',
        });
      });
      await invalid(async (tx) => {
        await tx.member.create({
          data: { fullName: 'Synthetic member', branch: 'OTHER' },
        });
      }, 'member_branch_check');
    });

    it('accepts choices and both complete/absent check-in groups', async () => {
      await valid(async (tx, f) => {
        await patch(
          tx,
          'event_questions',
          'question_id',
          f.question.questionId,
          { question_type: 'checkbox', options: '["A","B"]' },
        );
        await patch(
          tx,
          'event_registrations',
          'registration_id',
          f.registration.registrationId,
          {
            status: 'CONFIRMED',
            ...confirmation,
            checked_in_at: cancelled,
            checked_in_by: f.user.userId,
          },
        );
      });
    });

    it('resolves only one blacklist incident and retains its reason/history', async () => {
      await valid(async (tx, f) => {
        const first = await tx.registrationBlacklistEntry.create({
          data: {
            registrationId: f.registration.registrationId,
            reason: 'CONFIRMATION_EXPIRED',
            createdAt: approved,
          },
        });
        await tx.registrationBlacklistEntry.create({
          data: {
            registrationId: f.registration.registrationId,
            reason: 'NO_CHECK_IN',
            createdAt: approved,
          },
        });
        await tx.registrationBlacklistEntry.update({
          where: { entryId: first.entryId },
          data: {
            resolvedAt: cancelled,
            resolvedBy: f.user.userId,
            resolutionReason: 'Accepted excuse',
          },
        });
        expect(
          await tx.registrationBlacklistEntry.count({
            where: {
              registrationId: f.registration.registrationId,
              resolvedAt: null,
            },
          }),
        ).toBe(1);
        expect(
          (
            await tx.registrationBlacklistEntry.findUniqueOrThrow({
              where: { entryId: first.entryId },
            })
          ).reason,
        ).toBe('CONFIRMATION_EXPIRED');
      });
    });

    it.each<Patch>([
      { resolved_at: cancelled },
      { resolved_by: 0 },
      { resolved_at: cancelled, resolved_by: 0, resolution_reason: ' ' },
      {
        resolved_at: new Date('2029-01-01T00:00:00Z'),
        resolved_by: 0,
        resolution_reason: 'Reason',
      },
    ])('rejects incomplete/invalid blacklist resolution %#', async (fields) => {
      await invalid(async (tx, f) => {
        const entry = await tx.registrationBlacklistEntry.create({
          data: {
            registrationId: f.registration.registrationId,
            reason: 'NO_CHECK_IN',
            createdAt: approved,
          },
        });
        await patch(
          tx,
          'registration_blacklist_entries',
          'entry_id',
          entry.entryId,
          {
            ...fields,
            ...('resolved_by' in fields ? { resolved_by: f.user.userId } : {}),
          },
        );
      }, 'blacklist_resolution_check');
    });

    it('rejects answers belonging to another event and duplicate answers', async () => {
      await invalid(async (tx, f) => {
        const other = await fixture(tx);
        await tx.$executeRawUnsafe(
          'INSERT INTO registration_answers(registration_id, question_id, event_id, answer_text) VALUES ($1,$2,$3,$4)',
          f.registration.registrationId,
          other.question.questionId,
          f.event.eventId,
          'Answer',
        );
      }, 'registration_answers_question_id_event_id_fkey');
      await invalid(async (tx, f) => {
        const data = {
          registrationId: f.registration.registrationId,
          questionId: f.question.questionId,
          eventId: f.event.eventId,
          answerText: 'Answer',
        };
        await tx.registrationAnswer.create({ data });
        await tx.$executeRawUnsafe(
          'INSERT INTO registration_answers(registration_id, question_id, event_id, answer_text) VALUES ($1,$2,$3,$4)',
          data.registrationId,
          data.questionId,
          data.eventId,
          'Other answer',
        );
      }, 'registration_answers_registration_id_question_id_key');
    });

    it('rejects duplicate question positions within an event', async () => {
      await invalid(async (tx, f) => {
        await tx.$executeRawUnsafe(
          "INSERT INTO event_questions(event_id, question_text, question_type, position) VALUES ($1,'Duplicate','text',0)",
          f.event.eventId,
        );
      }, 'event_questions_event_id_position_key');
    });

    it('rejects a reused attendance token hash across registrations', async () => {
      await invalid(async (tx, f) => {
        const other = await fixture(tx);
        for (const registration of [f.registration, other.registration]) {
          await patch(
            tx,
            'event_registrations',
            'registration_id',
            registration.registrationId,
            {
              status: 'CONFIRMED',
              ...confirmation,
            },
          );
        }
      }, 'event_registrations_attendance_token_hash_key');
    });

    it('allows pending applications above capacity', async () => {
      await valid(async (tx, f) => {
        const user = await tx.user.create({
          data: {
            fullName: 'Another applicant',
            email: `${randomUUID()}@example.test`,
          },
        });
        await tx.eventRegistration.create({
          data: { eventId: f.event.eventId, userId: user.userId },
        });
        expect(
          await tx.eventRegistration.count({
            where: { eventId: f.event.eventId },
          }),
        ).toBe(2);
        expect(f.event.capacity).toBe(1);
      });
    });

    it('prevents duplicate membership/provider/email links and duplicate authorization pairs', async () => {
      for (const field of ['member_id', 'auth_user_id', 'email']) {
        await invalid(async (tx, f) => {
          const other = await tx.user.create({
            data: { fullName: 'Other', email: `${randomUUID()}@example.test` },
          });
          let value: number | string;
          if (field === 'member_id') {
            const member = await tx.member.create({
              data: { fullName: 'Member' },
            });
            value = member.memberId;
          } else value = field === 'email' ? f.user.email : randomUUID();
          await patch(tx, 'users', 'user_id', f.user.userId, {
            [field]: value,
          });
          await patch(tx, 'users', 'user_id', other.userId, { [field]: value });
        }, `users_${field}_key`);
      }
      await invalid(async (tx, f) => {
        const role = await tx.role.create({ data: { roleName: randomUUID() } });
        await tx.userRole.create({
          data: { userId: f.user.userId, roleId: role.roleId },
        });
        await tx.$executeRawUnsafe(
          'INSERT INTO user_roles(user_id, role_id) VALUES ($1,$2)',
          f.user.userId,
          role.roleId,
        );
      }, 'user_roles_user_id_role_id_key');
      await invalid(async (tx, f) => {
        const member = await tx.member.create({ data: { fullName: 'Member' } });
        await tx.memberCommittee.create({
          data: {
            memberId: member.memberId,
            committeeId: f.committee.committeeId,
            role: 'MEMBER',
          },
        });
        await tx.$executeRawUnsafe(
          "INSERT INTO member_committee(member_id,committee_id,role) VALUES ($1,$2,'Member')",
          member.memberId,
          f.committee.committeeId,
        );
      }, 'member_committee_member_id_committee_id_key');
      await invalid(async (tx) => {
        const role = await tx.role.create({ data: { roleName: randomUUID() } });
        const permission = await tx.permission.create({
          data: { permissionName: randomUUID() },
        });
        await tx.rolePermission.create({
          data: { roleId: role.roleId, permissionId: permission.permissionId },
        });
        await tx.$executeRawUnsafe(
          'INSERT INTO role_permissions(role_id,permission_id) VALUES ($1,$2)',
          role.roleId,
          permission.permissionId,
        );
      }, 'role_permissions_role_id_permission_id_key');
    });

    it('enforces registration-side composite FK and referenced history deletion restrictions', async () => {
      await invalid(async (tx, f) => {
        const other = await fixture(tx);
        await tx.$executeRawUnsafe(
          'INSERT INTO registration_answers(registration_id,question_id,event_id,answer_text) VALUES ($1,$2,$3,$4)',
          f.registration.registrationId,
          other.question.questionId,
          other.event.eventId,
          'Answer',
        );
      }, 'registration_answers_registration_id_event_id_fkey');
      for (const [table, key, fk] of [
        ['users', 'user_id', 'events_created_by_fkey'],
        ['events', 'event_id', 'event_registrations_event_id_fkey'],
      ]) {
        await invalid(async (tx, f) => {
          await tx.$executeRawUnsafe(
            `DELETE FROM "${table}" WHERE "${key}" = $1`,
            table === 'users' ? f.user.userId : f.event.eventId,
          );
        }, fk);
      }
      await invalid(async (tx, f) => {
        await tx.registrationAnswer.create({
          data: {
            registrationId: f.registration.registrationId,
            questionId: f.question.questionId,
            eventId: f.event.eventId,
            answerText: 'Answer',
          },
        });
        await tx.$executeRawUnsafe(
          'DELETE FROM event_questions WHERE question_id = $1',
          f.question.questionId,
        );
      }, 'registration_answers_question_id_event_id_fkey');
      await invalid(async (tx, f) => {
        await tx.registrationBlacklistEntry.create({
          data: {
            registrationId: f.registration.registrationId,
            reason: 'NO_CHECK_IN',
          },
        });
        await tx.$executeRawUnsafe(
          'DELETE FROM event_registrations WHERE registration_id = $1',
          f.registration.registrationId,
        );
      }, 'registration_blacklist_entries_registration_id_fkey');
      await invalid(async (tx, f) => {
        await patch(
          tx,
          'event_registrations',
          'registration_id',
          f.registration.registrationId,
          { reviewed_by: -1 },
        );
      }, 'event_registrations_reviewed_by_fkey');
    });

    it('reorders waitlist positions using temporary positive positions and rolls back interrupted changes', async () => {
      const f = await db.$transaction(fixture);
      const other = await db.user.create({
        data: {
          fullName: 'Waitlist applicant',
          email: `${randomUUID()}@example.test`,
        },
      });
      try {
        await db.eventRegistration.update({
          where: { registrationId: f.registration.registrationId },
          data: { status: 'WAITLISTED', waitlistPosition: 1 },
        });
        const second = await db.eventRegistration.create({
          data: {
            eventId: f.event.eventId,
            userId: other.userId,
            status: 'WAITLISTED',
            waitlistPosition: 2,
          },
        });
        const order = async () =>
          (
            await db.eventRegistration.findMany({
              where: { eventId: f.event.eventId },
              orderBy: { waitlistPosition: 'asc' },
            })
          ).map((r) => [r.registrationId, r.waitlistPosition]);
        await expect(
          db.$transaction(async (tx) => {
            await tx.eventRegistration.update({
              where: { registrationId: f.registration.registrationId },
              data: { waitlistPosition: 3 },
            });
            throw rollback;
          }),
        ).rejects.toBe(rollback);
        expect(await order()).toEqual([
          [f.registration.registrationId, 1],
          [second.registrationId, 2],
        ]);
        await db.$transaction(async (tx) => {
          await tx.eventRegistration.update({
            where: { registrationId: f.registration.registrationId },
            data: { waitlistPosition: 3 },
          });
          await tx.eventRegistration.update({
            where: { registrationId: second.registrationId },
            data: { waitlistPosition: 1 },
          });
          await tx.eventRegistration.update({
            where: { registrationId: f.registration.registrationId },
            data: { waitlistPosition: 2 },
          });
        });
        expect(await order()).toEqual([
          [second.registrationId, 1],
          [f.registration.registrationId, 2],
        ]);
      } finally {
        await db.eventRegistration.deleteMany({
          where: { eventId: f.event.eventId },
        });
        await db.event.delete({ where: { eventId: f.event.eventId } });
        await db.committee.delete({
          where: { committeeId: f.committee.committeeId },
        });
        await db.user.deleteMany({
          where: { userId: { in: [f.user.userId, other.userId] } },
        });
      }
    });

    it.each(['registration', 'waitlist', 'incident'])(
      'allows only one simultaneous duplicate %s write',
      async (kind) => {
        const f = await db.$transaction(fixture);
        let secondUser: number | undefined;
        try {
          const user = await db.user.create({
            data: {
              fullName: 'Concurrent applicant',
              email: `${randomUUID()}@example.test`,
            },
          });
          secondUser = user.userId;
          let writes: Promise<unknown>[];
          if (kind === 'registration') {
            writes = [1, 2].map(() =>
              db.$executeRawUnsafe(
                'INSERT INTO event_registrations(event_id,user_id) VALUES ($1,$2)',
                f.event.eventId,
                user.userId,
              ),
            );
          } else if (kind === 'waitlist') {
            writes = [
              db.$executeRawUnsafe(
                "UPDATE event_registrations SET status = 'WAITLISTED', waitlist_position = 1 WHERE registration_id = $1",
                f.registration.registrationId,
              ),
              db.$executeRawUnsafe(
                "INSERT INTO event_registrations(event_id,user_id,status,waitlist_position) VALUES ($1,$2,'WAITLISTED',1)",
                f.event.eventId,
                user.userId,
              ),
            ];
          } else {
            writes = [1, 2].map(() =>
              db.$executeRawUnsafe(
                "INSERT INTO registration_blacklist_entries(registration_id,reason) VALUES ($1,'NO_CHECK_IN')",
                f.registration.registrationId,
              ),
            );
          }
          const results = await Promise.allSettled(writes);
          expect(
            results.filter((result) => result.status === 'fulfilled'),
          ).toHaveLength(1);
          expect(
            results.filter((result) => result.status === 'rejected'),
          ).toHaveLength(1);
          const rejected = results.find(
            (result) => result.status === 'rejected',
          );
          if (rejected?.status === 'rejected') {
            expect(String(rejected.reason)).toContain('23505');
          }
        } finally {
          await db.registrationBlacklistEntry.deleteMany({
            where: { registration: { eventId: f.event.eventId } },
          });
          await db.eventRegistration.deleteMany({
            where: { eventId: f.event.eventId },
          });
          await db.event.delete({ where: { eventId: f.event.eventId } });
          await db.committee.delete({
            where: { committeeId: f.committee.committeeId },
          });
          await db.user.deleteMany({
            where: {
              userId: {
                in: [f.user.userId, ...(secondUser ? [secondUser] : [])],
              },
            },
          });
        }
      },
    );
  },
);
