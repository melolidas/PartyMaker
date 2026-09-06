import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';

type NestErrorBody = {
  code?: unknown;
  error?: unknown;
  message?: unknown;
};

type ApiErrorBody = {
  statusCode: number;
  error: {
    code: string;
    message: string;
    details?: string[];
  };
  path: string;
  timestamp: string;
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = exception instanceof HttpException
      ? exception.getResponse()
      : undefined;
    const normalized = this.normalizeBody(status, body);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const trace = exception instanceof Error ? exception.stack : undefined;
      this.logger.error('Unhandled API exception', trace);
    }

    const payload: ApiErrorBody = {
      statusCode: status,
      error: normalized,
      path: request.originalUrl || request.url,
      timestamp: new Date().toISOString(),
    };

    response.status(status).json(payload);
  }

  private normalizeBody(
    status: number,
    body: string | object | undefined,
  ): ApiErrorBody['error'] {
    if (typeof body === 'string') {
      return {
        code: this.defaultCode(status),
        message: body,
      };
    }

    const errorBody = this.isRecord(body) ? body as NestErrorBody : {};
    const messages = Array.isArray(errorBody.message)
      ? errorBody.message.filter((item): item is string => typeof item === 'string')
      : undefined;

    if (messages?.length) {
      return {
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        details: messages,
      };
    }

    const message = typeof errorBody.message === 'string'
      ? errorBody.message
      : status >= HttpStatus.INTERNAL_SERVER_ERROR
        ? 'Internal server error'
        : 'Request failed';
    const explicitCode = typeof errorBody.code === 'string'
      ? errorBody.code
      : typeof errorBody.error === 'string'
        ? errorBody.error
        : undefined;

    return {
      code: explicitCode ? this.toConstantCase(explicitCode) : this.defaultCode(status),
      message,
    };
  }

  private defaultCode(status: number): string {
    const statusName = HttpStatus[status];
    return typeof statusName === 'string'
      ? statusName
      : `HTTP_${status}`;
  }

  private toConstantCase(value: string): string {
    return value
      .trim()
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase();
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
