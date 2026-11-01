const DEFAULT_FRONTEND_ORIGIN = 'http://localhost:3000';

function normalizeOrigin(value: string): string {
  try {
    const url = new URL(value.trim());
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin === 'null' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new Error();
    }
    return url.origin;
  } catch {
    throw new Error('Frontend origins must be bare HTTP or HTTPS origins.');
  }
}

export function getAllowedFrontendOrigins(): string[] {
  const configuredOrigins = process.env.FRONTEND_ORIGINS?.split(',') ?? [];
  const primaryOrigin = process.env.FRONTEND_URL?.trim();
  const defaultOrigins = primaryOrigin
    ? [primaryOrigin]
    : process.env.NODE_ENV === 'production'
      ? []
      : [DEFAULT_FRONTEND_ORIGIN];
  const origins = [...defaultOrigins, ...configuredOrigins]
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map(normalizeOrigin);

  return [...new Set(origins)];
}
