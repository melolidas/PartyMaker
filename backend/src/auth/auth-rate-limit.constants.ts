export const AUTH_RATE_LIMIT_WINDOW_MS = 60_000;

export const AUTH_RATE_LIMITS = {
  register: 5,
  login: 10,
} as const;
