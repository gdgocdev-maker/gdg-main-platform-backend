import { schemaTestTarget } from './schema-test-target.js';

const safe =
  'postgresql://tester:example@127.0.0.1:5432/gdg_schema_test_a?schema=public';

describe('isolated schema database guard', () => {
  it('accepts an explicitly named local disposable database', () => {
    expect(schemaTestTarget(safe)).toBe(safe);
  });

  it.each([
    undefined,
    '',
    'not-a-url',
    'mysql://tester:example@localhost:5432/gdg_schema_test_a',
    'postgresql://tester:example@remote.example:5432/gdg_schema_test_a',
    'postgresql://tester:example@127.0.0.1:5432/gdg_platform',
    'postgresql://tester:example@127.0.0.1:5432/gdg_schema_test_',
    'postgresql://tester:example@127.0.0.1:5432/gdg_schema_test_a?schema=private',
    'postgresql://tester:example@127.0.0.1:5432/gdg_schema_test_a?options=anything',
  ])(
    'rejects unsafe or missing targets without echoing credentials',
    (value) => {
      expect(() => schemaTestTarget(value)).toThrow(
        'Use a separate local gdg_schema_test_ database with schema=public',
      );
    },
  );

  it('rejects the application database even with a different host alias', () => {
    expect(() =>
      schemaTestTarget(
        safe,
        'postgresql://user:secret@localhost:1234/gdg_schema_test_a',
      ),
    ).toThrow('separate');
  });
});
