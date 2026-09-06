const API_PATH_SUFFIX = '/api/v1';

declare const process: {
  env: {
    EXPO_PUBLIC_API_BASE_URL?: string;
  };
};

export function getApiBaseUrl(
  configuredUrl = process.env.EXPO_PUBLIC_API_BASE_URL,
): string {
  const normalized = configuredUrl?.trim().replace(/\/+$/, '');
  if (!normalized) {
    throw new Error('EXPO_PUBLIC_API_BASE_URL is required');
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error('EXPO_PUBLIC_API_BASE_URL must be an absolute URL');
  }

  if (
    !['http:', 'https:'].includes(parsed.protocol)
    || parsed.search
    || parsed.hash
    || !parsed.pathname.endsWith(API_PATH_SUFFIX)
  ) {
    throw new Error(
      'EXPO_PUBLIC_API_BASE_URL must be an HTTP(S) URL ending with /api/v1',
    );
  }

  return normalized;
}
