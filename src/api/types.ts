export type Avatar = { id: string; width: number; height: number; mimeType: 'image/jpeg' };
export type AvatarUpload = { uri: string; mimeType: 'image/jpeg' | 'image/png'; file?: Blob };

export type UserProfile = {
  avatar: Avatar | null;
  id: string;
  email: string;
  handle: string;
  displayName: string;
  bio: string | null;
  city: string | null;
  countryCode: string | null;
  extroversionLevel: number;
  createdAt: string;
  updatedAt: string;
};

export type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  accessTokenExpiresIn: number;
  user: UserProfile;
};

export type ApiErrorResponse = {
  statusCode: number;
  error: {
    code: string;
    message: string;
    details?: string[];
  };
  path: string;
  timestamp: string;
};

export type LoginInput = {
  email: string;
  password: string;
};

export type RegisterInput = LoginInput & {
  handle: string;
  displayName: string;
};

export type UpdateProfileInput = {
  displayName?: string;
  bio?: string | null;
  city?: string | null;
  countryCode?: string | null;
};

export type RefreshTokenStorage = {
  get: () => Promise<string | null>;
  set: (refreshToken: string) => Promise<void>;
  clear: () => Promise<void>;
  // Read-only readiness proof, separate from revocation. Persistent adapters
  // must reject unresolved/unknown operation records, even in a fresh runtime.
  assertReadyForNewSession?: () => Promise<void>;
  // Injectable deadline for deterministic tests; production uses five seconds.
  createWriteDeadline?: () => {
    expired: Promise<void>;
    cancel: () => void;
  };
  // Cancel publication synchronously, before returning any pending durable I/O.
  // Persistent implementations must confirm a write-ahead record BEFORE token set.
  quarantinePendingWrite?: () => Promise<void>;
  // Only called after set/clear AND quarantine I/O settle; must reconcile the
  // exact old operation and preserve credentials owned by a different runtime.
  resolvePendingWrite?: () => Promise<void>;
};
