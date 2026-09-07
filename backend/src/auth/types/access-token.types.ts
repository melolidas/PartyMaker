import type { Request } from 'express';

export type AccessTokenPayload = {
  sub: string;
  sid: string;
  iat?: number;
  exp?: number;
};

export type AuthContext = {
  userId: string;
  sessionId: string;
};

export type AuthenticatedRequest = Request & {
  auth: AuthContext;
};
