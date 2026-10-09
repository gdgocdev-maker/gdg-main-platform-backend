import { defineConfig } from 'vitest/config';
import base from './vitest.config.e2e.js';
import { schemaTestTarget } from './test/schema-test-target.js';

schemaTestTarget(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);

export default defineConfig({
  ...base,
  test: { ...base.test, include: ['test/database-schema.e2e-spec.ts'] },
});
