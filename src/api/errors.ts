type ApiClientErrorOptions = {
  statusCode: number;
  code: string;
  message: string;
  details?: string[];
};

export class ApiClientError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: string[];

  constructor(options: ApiClientErrorOptions) {
    super(options.message);
    this.name = 'ApiClientError';
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.details = options.details;
  }
}

export function normalizeApiError(
  statusCode: number,
  payload: unknown,
): ApiClientError {
  if (isRecord(payload) && isRecord(payload.error)) {
    const code = typeof payload.error.code === 'string'
      ? payload.error.code.trim()
      : '';
    const message = typeof payload.error.message === 'string'
      ? payload.error.message.trim()
      : '';
    const details = Array.isArray(payload.error.details)
      ? payload.error.details.filter(
        (detail): detail is string => typeof detail === 'string',
      )
      : undefined;

    if (code && message) {
      return new ApiClientError({
        statusCode,
        code,
        message,
        ...(details?.length ? { details } : {}),
      });
    }
  }

  return new ApiClientError({
    statusCode,
    code: `HTTP_${statusCode}`,
    message: 'The API returned an unexpected error response',
  });
}

export function createNetworkError(): ApiClientError {
  return new ApiClientError({
    statusCode: 0,
    code: 'NETWORK_ERROR',
    message: 'The API is unavailable',
  });
}

export function createApiConfigurationError(): ApiClientError {
  return new ApiClientError({
    statusCode: 0,
    code: 'API_CONFIGURATION_ERROR',
    message: 'The API base URL is not configured',
  });
}

export function createSessionStorageError(): ApiClientError {
  return new ApiClientError({
    statusCode: 0,
    code: 'SESSION_STORAGE_ERROR',
    message: 'The local session could not be stored securely',
  });
}

export function createMissingRefreshTokenError(): ApiClientError {
  return new ApiClientError({
    statusCode: 401,
    code: 'INVALID_REFRESH_TOKEN',
    message: 'No refresh token is available',
  });
}

export function createSessionInvalidatedError(): ApiClientError {
  return new ApiClientError({
    statusCode: 401,
    code: 'INVALID_REFRESH_TOKEN',
    message: 'The local session is no longer active',
  });
}

export function isInvalidAccessTokenError(error: unknown): boolean {
  return error instanceof ApiClientError
    && error.statusCode === 401
    && error.code === 'INVALID_ACCESS_TOKEN';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
