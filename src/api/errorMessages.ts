import { ApiClientError } from './errors';

export type RequestErrorTranslationKey =
  | 'auth.error.emailAlreadyExists'
  | 'auth.error.handleAlreadyExists'
  | 'auth.error.invalidCredentials'
  | 'common.error.tooManyRequests'
  | 'common.error.validation'
  | 'common.error.network'
  | 'common.error.apiConfiguration'
  | 'common.error.sessionStorage'
  | 'common.error.sessionExpired'
  | 'common.error.unexpected';

export function getRequestErrorTranslationKey(
  error: unknown,
): RequestErrorTranslationKey {
  if (!(error instanceof ApiClientError)) return 'common.error.unexpected';
  if (error.statusCode >= 500) return 'common.error.network';

  switch (error.code) {
    case 'EMAIL_ALREADY_EXISTS':
      return 'auth.error.emailAlreadyExists';
    case 'HANDLE_ALREADY_EXISTS':
      return 'auth.error.handleAlreadyExists';
    case 'INVALID_CREDENTIALS':
      return 'auth.error.invalidCredentials';
    case 'TOO_MANY_REQUESTS':
      return 'common.error.tooManyRequests';
    case 'VALIDATION_FAILED':
      return 'common.error.validation';
    case 'NETWORK_ERROR':
      return 'common.error.network';
    case 'API_CONFIGURATION_ERROR':
      return 'common.error.apiConfiguration';
    case 'SESSION_STORAGE_ERROR':
      return 'common.error.sessionStorage';
    case 'INVALID_ACCESS_TOKEN':
    case 'INVALID_REFRESH_TOKEN':
      return 'common.error.sessionExpired';
    default:
      return 'common.error.unexpected';
  }
}

export function isRetryableRequestError(error: unknown): boolean {
  return error instanceof ApiClientError
    && (error.code === 'NETWORK_ERROR' || error.statusCode >= 500);
}
