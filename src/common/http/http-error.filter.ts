import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Inject,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { type ApiFailure, apiValidationDetails } from './api-response.js';

const ERROR_CATALOG: Partial<Record<number, readonly [string, string]>> = {
  400: ['BAD_REQUEST', 'The request is invalid.'],
  401: ['UNAUTHORIZED', 'Authentication is required.'],
  403: ['FORBIDDEN', 'You do not have permission to perform this action.'],
  404: ['NOT_FOUND', 'The requested resource was not found.'],
  409: ['CONFLICT', 'The request conflicts with the current state.'],
  500: ['INTERNAL_ERROR', 'An unexpected error occurred.'],
};
// Domain codes an endpoint may send instead of the generic code for its
// status. Only these pass through, together with their exception message.
const DOMAIN_ERROR_CODES: ReadonlyMap<string, number> = new Map([
  ['CAPACITY_REACHED', 409],
  ['INVALID_STATUS_TRANSITION', 409],
  ['REGISTRATION_NOT_FOUND', 404],
  ['EVENT_NOT_FOUND', 404],
  ['REGISTRATION_BUSY', 503],
  ['EVENT_STARTED', 409],
  ['REGISTRATION_CLOSED', 409],
  ['ALREADY_REGISTERED', 409],
  ['CONFIRMATION_EXPIRED', 409],
  ['EVENT_HAS_REGISTRATIONS', 409],
  ['QUESTION_HAS_ANSWERS', 409],
  ['INVALID_QR_CODE', 400],
  ['ALREADY_CHECKED_IN', 409],
  ['CHECK_IN_CLOSED', 409],
]);
const DIAGNOSTIC_METHODS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);

function domainErrorOf(
  exception: unknown,
  status: number,
): readonly [string, string] | undefined {
  if (
    exception instanceof HttpException &&
    exception.errorCode !== undefined &&
    DOMAIN_ERROR_CODES.get(exception.errorCode) === status
  ) {
    return [exception.errorCode, exception.message];
  }
  return undefined;
}

function isFailureStatus(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 400 &&
    value <= 599
  );
}

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name);

  constructor(
    @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const adapter = this.adapterHost.httpAdapter;
    const context = host.switchToHttp();
    const response = context.getResponse();
    let status = 500;
    let category = 'UNEXPECTED_EXCEPTION';

    if (exception instanceof HttpException) {
      const candidate = exception.getStatus();
      if (isFailureStatus(candidate)) {
        status = candidate;
        category = 'HTTP_SERVER_ERROR';
      }
    } else if (
      exception instanceof Error &&
      'statusCode' in exception &&
      isFailureStatus(exception.statusCode) &&
      'status' in exception &&
      exception.status === exception.statusCode &&
      'expose' in exception &&
      typeof exception.expose === 'boolean'
    ) {
      status = exception.statusCode;
      category = 'ADAPTER_ERROR';
    }

    const details =
      status === 400 &&
      exception instanceof HttpException &&
      exception.errorCode === 'VALIDATION_ERROR'
        ? apiValidationDetails(exception)
        : undefined;
    const domainError = domainErrorOf(exception, status);
    const [code, message] =
      details !== undefined
        ? ['VALIDATION_ERROR', 'Some fields are invalid.']
        : (domainError ??
          ERROR_CATALOG[status] ?? [
            'HTTP_ERROR',
            'The request could not be completed.',
          ]);
    const body: ApiFailure = {
      success: false,
      message,
      data: null,
      error: { code, details: details ?? [] },
    };

    if (status >= 500) {
      const method: unknown = adapter.getRequestMethod(context.getRequest());
      this.logger.error({
        event: 'http_request_failed',
        category,
        method:
          typeof method === 'string' && DIAGNOSTIC_METHODS.has(method)
            ? method
            : 'OTHER',
        status,
        code,
      });
    }

    if (adapter.isHeadersSent(response)) {
      adapter.end(response);
      return;
    }
    adapter.setHeader(response, 'Content-Type', 'application/json');
    adapter.reply(response, body, status);
  }
}
