import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/** Only serialized origins: no credentials, path (even '/'), query or fragment. */
export function parseCorsAllowedOrigins(value: string): Set<string> {
  if (!value.trim()) return new Set();

  return new Set(value.split(',').map((entry) => {
    const origin = entry.trim();
    const url = new URL(origin);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:')
      || origin.indexOf('*') !== -1
      || url.origin !== origin
    ) {
      throw new Error('CORS_ALLOWED_ORIGINS must contain explicit serialized HTTP(S) origins');
    }
    return origin;
  }));
}

export function createCorsOptions(value: string): CorsOptions {
  const allowedOrigins = parseCorsAllowedOrigins(value);
  return {
    origin: (origin, callback) => {
      callback(null, origin !== undefined && allowedOrigins.has(origin));
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    credentials: false,
    optionsSuccessStatus: 204,
  };
}
