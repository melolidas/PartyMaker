import Joi from 'joi';

import { parseCorsAllowedOrigins } from './cors.config';

export const JWT_ACCESS_SECRET_PLACEHOLDER =
  'replace_with_at_least_32_random_characters';

export const environmentValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  CORS_ALLOWED_ORIGINS: Joi.string().allow('').default('').custom((value: string, helpers) => {
    try {
      parseCorsAllowedOrigins(value);
      return value;
    } catch {
      return helpers.error('any.custom');
    }
  }).messages({
    'any.custom': '{{#label}} must be a comma-separated list of explicit serialized HTTP(S) origins (no wildcard, credentials, path, query or fragment)',
  }),
  JWT_ACCESS_SECRET: Joi.string()
    .min(32)
    .invalid(JWT_ACCESS_SECRET_PLACEHOLDER)
    .required(),
  JWT_ACCESS_TTL_SECONDS: Joi.number().integer().positive().default(900),
  JWT_REFRESH_TTL_DAYS: Joi.number().integer().positive().default(30),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required(),
});
