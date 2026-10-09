export function schemaTestTarget(
  value?: string,
  applicationUrl?: string,
): string {
  const message =
    'Use a separate local gdg_schema_test_ database with schema=public';
  try {
    const target = new URL(value ?? '');
    if (
      !['postgresql:', 'postgres:'].includes(target.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
      !/^\/gdg_schema_test_[a-z0-9_]+$/.test(target.pathname) ||
      [...target.searchParams.keys()].some((key) => key !== 'schema') ||
      target.searchParams.getAll('schema').length > 1 ||
      (target.searchParams.has('schema') &&
        target.searchParams.get('schema') !== 'public') ||
      target.hash ||
      (applicationUrl && target.pathname === new URL(applicationUrl).pathname)
    ) {
      throw new Error(message);
    }
    return target.toString();
  } catch {
    throw new Error(message);
  }
}
