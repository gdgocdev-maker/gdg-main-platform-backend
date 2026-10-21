import {
  type ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { apiValidationError } from './api-response.js';
import { HttpErrorFilter } from './http-error.filter.js';

const secret = 'never-public-token-SQL';

function createHarness() {
  const request = {
    method: 'GET' as unknown,
    originalUrl: `/missing?token=${secret}`,
    headers: { authorization: secret },
    body: { password: secret },
  };
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    headersSent: false,
    ended: false,
    writes: [] as string[],
  };
  const adapter = {
    getRequestMethod: (req: typeof request) => req.method,
    isHeadersSent: (res: typeof response) => res.headersSent,
    setHeader(res: typeof response, name: string, value: string) {
      res.headers[name.toLowerCase()] = value;
      res.writes.push('header');
    },
    reply(res: typeof response, body: unknown, status: number) {
      res.body = body;
      res.statusCode = status;
      res.headersSent = true;
      res.writes.push('reply');
    },
    end(res: typeof response) {
      res.ended = true;
      res.writes.push('end');
    },
  };
  const adapterHost = { httpAdapter: adapter } as unknown as HttpAdapterHost;
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  return { request, response, host, filter: new HttpErrorFilter(adapterHost) };
}

describe('HttpErrorFilter', () => {
  let h: ReturnType<typeof createHarness>;
  let logs: unknown[][];

  beforeEach(() => {
    h = createHarness();
    logs = [];
    vi.spyOn(Logger.prototype, 'error').mockImplementation(
      (...args: unknown[]) => {
        logs.push(args);
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    expect(JSON.stringify({ body: h.response.body, logs })).not.toContain(
      secret,
    );
  });

  it.each([
    {
      exception: new BadRequestException(secret),
      status: 400,
      code: 'BAD_REQUEST',
      message: 'The request is invalid.',
    },
    {
      exception: new UnauthorizedException(secret),
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication is required.',
    },
    {
      exception: new ForbiddenException(secret),
      status: 403,
      code: 'FORBIDDEN',
      message: 'You do not have permission to perform this action.',
    },
    {
      exception: new NotFoundException(secret),
      status: 404,
      code: 'NOT_FOUND',
      message: 'The requested resource was not found.',
    },
    {
      exception: new ConflictException(secret),
      status: 409,
      code: 'CONFLICT',
      message: 'The request conflicts with the current state.',
    },
    {
      exception: new InternalServerErrorException(secret),
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
    },
    ...[413, 429, 503].map((status) => ({
      exception: new HttpException(secret, status),
      status,
      code: 'HTTP_ERROR',
      message: 'The request could not be completed.',
    })),
  ])('formats $status as $code', ({ exception, status, code, message }) => {
    h.filter.catch(exception, h.host);

    expect(h.response.statusCode).toBe(status);
    expect(h.response.headers['content-type']).toBe('application/json');
    expect(h.response.body).toEqual({
      success: false,
      message,
      data: null,
      error: { code, details: [] },
    });
    if (status < 500) expect(logs).toEqual([]);
  });

  it.each([
    [
      'EVENT_HAS_REGISTRATIONS',
      'An event with registrations cannot be deleted.',
    ],
    [
      'QUESTION_HAS_ANSWERS',
      'A question with submitted answers cannot be removed.',
    ],
  ])('preserves the approved event conflict code %s', (errorCode, message) => {
    h.filter.catch(new ConflictException(message, { errorCode }), h.host);

    expect(h.response.statusCode).toBe(409);
    expect(h.response.body).toEqual({
      success: false,
      message,
      data: null,
      error: { code: errorCode, details: [] },
    });
  });

  it.each(['FORBIDDEN', 'UNKNOWN_CODE', 'VALIDATION_ERROR', 'BAD_REQUEST'])(
    'uses the 400 fallback for unowned or mismatched code %s',
    (errorCode) => {
      h.filter.catch(
        new BadRequestException(
          { message: secret, details: [{ pointer: secret, message: secret }] },
          { errorCode },
        ),
        h.host,
      );
      expect(h.response.statusCode).toBe(400);
      expect(h.response.body).toEqual({
        success: false,
        message: 'The request is invalid.',
        data: null,
        error: { code: 'BAD_REQUEST', details: [] },
      });
    },
  );

  it('recognizes owned validation details at status 400', () => {
    h.filter.catch(
      apiValidationError([
        { pointer: '/email', message: 'Email must be valid.' },
      ]),
      h.host,
    );
    expect(h.response.statusCode).toBe(400);
    expect(h.response.body).toEqual({
      success: false,
      message: 'Some fields are invalid.',
      data: null,
      error: {
        code: 'VALIDATION_ERROR',
        details: [{ pointer: '/email', message: 'Email must be valid.' }],
      },
    });
  });

  it('ignores owned validation metadata at a mismatched status', () => {
    const exception = apiValidationError([
      { pointer: secret, message: secret },
    ]);
    vi.spyOn(exception, 'getStatus').mockReturnValue(403);
    h.filter.catch(exception, h.host);
    expect(h.response.statusCode).toBe(403);
    expect(h.response.body).toEqual({
      success: false,
      message: 'You do not have permission to perform this action.',
      data: null,
      error: { code: 'FORBIDDEN', details: [] },
    });
  });

  it('ignores owned validation metadata with a mismatched code', () => {
    const exception = apiValidationError([
      { pointer: secret, message: secret },
    ]);
    exception.errorCode = 'FORBIDDEN';
    h.filter.catch(exception, h.host);
    expect(h.response.body).toEqual({
      success: false,
      message: 'The request is invalid.',
      data: null,
      error: { code: 'BAD_REQUEST', details: [] },
    });
  });

  it.each([
    new Error(secret, { cause: new Error(secret) }),
    secret,
    null,
    undefined,
    { statusCode: 401, message: secret },
    { statusCode: 401, status: 401, expose: true, message: secret },
    Object.assign(new Error(secret), { statusCode: 401 }),
    Object.assign(new Error(secret), {
      statusCode: 401,
      status: 403,
      expose: true,
    }),
    Object.assign(new Error(secret), {
      statusCode: 401,
      status: 401,
      expose: 'true',
    }),
    Object.assign(new Error(secret), {
      statusCode: 400.5,
      status: 400.5,
      expose: true,
    }),
    Object.assign(new Error(secret), {
      statusCode: 600,
      status: 600,
      expose: false,
    }),
  ])('uses safe 500 for untrusted thrown value %#', (exception) => {
    h.filter.catch(exception, h.host);
    expect(h.response.statusCode).toBe(500);
    expect(h.response.body).toEqual({
      success: false,
      message: 'An unexpected error occurred.',
      data: null,
      error: { code: 'INTERNAL_ERROR', details: [] },
    });
  });

  it.each([200, 399, 600, 400.5, NaN, Infinity])(
    'rejects invalid exception status %s',
    (status) => {
      h.filter.catch(new HttpException(secret, status), h.host);
      expect(h.response.statusCode).toBe(500);
      expect(h.response.body).toEqual({
        success: false,
        message: 'An unexpected error occurred.',
        data: null,
        error: { code: 'INTERNAL_ERROR', details: [] },
      });
    },
  );

  it.each([
    {
      status: 413,
      expose: true,
      code: 'HTTP_ERROR',
      message: 'The request could not be completed.',
    },
    {
      status: 429,
      expose: false,
      code: 'HTTP_ERROR',
      message: 'The request could not be completed.',
    },
    {
      status: 500,
      expose: false,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
    },
    {
      status: 503,
      expose: true,
      code: 'HTTP_ERROR',
      message: 'The request could not be completed.',
    },
  ])(
    'preserves valid adapter error status $status',
    ({ status, expose, code, message }) => {
      const exception = Object.assign(new Error(secret), {
        statusCode: status,
        status,
        expose,
      });
      h.filter.catch(exception, h.host);
      expect(h.response.statusCode).toBe(status);
      expect(h.response.body).toEqual({
        success: false,
        message,
        data: null,
        error: { code, details: [] },
      });
    },
  );

  it('overrides stale content type while preserving existing headers', () => {
    h.response.headers = {
      'content-type': 'text/plain',
      'www-authenticate': 'Bearer',
      'retry-after': '60',
      'x-existing': 'keep',
    };
    h.filter.catch(new UnauthorizedException(secret), h.host);
    expect(h.response.headers).toEqual({
      'content-type': 'application/json',
      'www-authenticate': 'Bearer',
      'retry-after': '60',
      'x-existing': 'keep',
    });
    expect(h.response.writes).toEqual(['header', 'reply']);
  });

  it('ends an already-sent response without another status, header or body write', () => {
    h.response.headersSent = true;
    h.response.body = 'Existing stream';
    h.response.headers = { 'content-type': 'text/plain' };
    h.filter.catch(new Error(secret), h.host);
    expect(h.response.body).toBe('Existing stream');
    expect(h.response.statusCode).toBe(200);
    expect(h.response.headers).toEqual({ 'content-type': 'text/plain' });
    expect(h.response.writes).toEqual(['end']);
    expect(h.response.ended).toBe(true);
  });

  it.each([
    {
      exception: new Error(secret),
      category: 'UNEXPECTED_EXCEPTION',
      status: 500,
      code: 'INTERNAL_ERROR',
    },
    {
      exception: new HttpException(secret, 503),
      category: 'HTTP_SERVER_ERROR',
      status: 503,
      code: 'HTTP_ERROR',
    },
    {
      exception: Object.assign(new Error(secret), {
        statusCode: 503,
        status: 503,
        expose: false,
      }),
      category: 'ADAPTER_ERROR',
      status: 503,
      code: 'HTTP_ERROR',
    },
  ])(
    'logs only safe fields for $category',
    ({ exception, category, status, code }) => {
      h.filter.catch(exception, h.host);
      expect(logs).toEqual([
        [
          {
            event: 'http_request_failed',
            category,
            method: 'GET',
            status,
            code,
          },
        ],
      ]);
    },
  );

  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])(
    'allows diagnostic method %s',
    (method) => {
      h.request.method = method;
      h.filter.catch(new Error(secret), h.host);
      expect(logs).toEqual([
        [
          {
            event: 'http_request_failed',
            category: 'UNEXPECTED_EXCEPTION',
            method,
            status: 500,
            code: 'INTERNAL_ERROR',
          },
        ],
      ]);
    },
  );

  it.each([secret, 'get', null, undefined, 42, { method: secret }])(
    'replaces unapproved diagnostic method %#',
    (method) => {
      h.request.method = method;
      h.filter.catch(new Error(secret), h.host);
      expect(logs).toEqual([
        [
          {
            event: 'http_request_failed',
            category: 'UNEXPECTED_EXCEPTION',
            method: 'OTHER',
            status: 500,
            code: 'INTERNAL_ERROR',
          },
        ],
      ]);
    },
  );
});
