import { getAllowedFrontendOrigins } from './frontend-origins.js';

const originalNodeEnv = process.env.NODE_ENV;
const originalFrontendUrl = process.env.FRONTEND_URL;
const originalFrontendOrigins = process.env.FRONTEND_ORIGINS;

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL;
  else process.env.FRONTEND_URL = originalFrontendUrl;
  if (originalFrontendOrigins === undefined) delete process.env.FRONTEND_ORIGINS;
  else process.env.FRONTEND_ORIGINS = originalFrontendOrigins;
});

describe('getAllowedFrontendOrigins', () => {
  it('uses only explicitly configured origins in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.FRONTEND_URL;
    delete process.env.FRONTEND_ORIGINS;

    expect(getAllowedFrontendOrigins()).toEqual([]);
  });

  it('allows the configured frontend and additional origins', () => {
    process.env.NODE_ENV = 'production';
    process.env.FRONTEND_URL = 'https://frontend.example';
    process.env.FRONTEND_ORIGINS = 'http://localhost:3000, https://preview.example/';

    expect(getAllowedFrontendOrigins()).toEqual([
      'https://frontend.example',
      'http://localhost:3000',
      'https://preview.example',
    ]);
  });

  it.each(['file:///tmp/app', 'ftp://frontend.example', 'null', 'https://user:pass@frontend.example'])(
    'rejects unsafe configured origin %s',
    (origin) => {
      process.env.NODE_ENV = 'production';
      process.env.FRONTEND_URL = origin;
      delete process.env.FRONTEND_ORIGINS;

      expect(() => getAllowedFrontendOrigins()).toThrow('bare HTTP or HTTPS origins');
    },
  );
});
