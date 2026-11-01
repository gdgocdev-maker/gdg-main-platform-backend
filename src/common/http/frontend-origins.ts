const DEFAULT_FRONTEND_ORIGIN = 'http://localhost:3000';
const RENDER_FRONTEND_ORIGIN = 'https://gdg-leeniverse.onrender.com';

function normalizeOrigin(value: string): string {
  try {
    return new URL(value.trim()).origin;
  } catch {
    throw new Error('Frontend origins must be valid absolute URLs.');
  }
}

export function getAllowedFrontendOrigins(): string[] {
  const configuredOrigins = process.env.FRONTEND_ORIGINS?.split(',') ?? [];
  const primaryOrigin = process.env.FRONTEND_URL ?? DEFAULT_FRONTEND_ORIGIN;
  const origins = [primaryOrigin, ...configuredOrigins, RENDER_FRONTEND_ORIGIN]
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map(normalizeOrigin);

  return [...new Set(origins)];
}
