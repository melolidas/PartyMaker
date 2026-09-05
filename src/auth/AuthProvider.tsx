import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { ApiClient } from '../api/client';
import { ApiClientError } from '../api/errors';
import type { LobbyApi } from '../api/lobbyTypes';
import type {
  Avatar,
  AvatarUpload,
  LoginInput,
  RegisterInput,
  UpdateProfileInput,
  UserProfile,
} from '../api/types';
import { refreshTokenStorage } from './refreshTokenStorage';

export type AuthStatus = 'restoring' | 'authenticated' | 'unauthenticated';

type AuthContextValue = {
  lobbyApi: LobbyApi;
  status: AuthStatus;
  user: UserProfile | null;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  updateProfile: (input: UpdateProfileInput) => Promise<UserProfile>;
  updateExtroversion: (level: number) => Promise<UserProfile>;
  uploadAvatar: (input: AvatarUpload, stillCurrent: () => boolean) => Promise<Avatar>;
  refreshAvatar: (stillCurrent: () => boolean) => Promise<Avatar | null>;
  getAvatarUrl: (id: string) => string;
  logout: () => Promise<void>;
  storageRecoveryRequired: boolean;
  recoveringSessionStorage: boolean;
  recoverSessionStorage: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('restoring');
  const [user, setUser] = useState<UserProfile | null>(null);
  const [storageRecoveryRequired, setStorageRecoveryRequired] = useState(false);
  const [recoveringSessionStorage, setRecoveringSessionStorage] = useState(false);
  const storageRecoveryPromise = useRef<Promise<void> | null>(null);
  const uiAttemptId = useRef(0);
  // Field ownership prevents full DTO responses from reverting independent profile edits.
  const profileWrites = useRef({ avatar: 0, extroversionLevel: 0, displayName: 0, bio: 0, city: 0, countryCode: 0 });
  const [client] = useState(() => new ApiClient({
    refreshTokenStorage,
    onSessionCleared: ({ storageRecoveryRequired }) => {
      setUser(null);
      setStatus('unauthenticated');
      setStorageRecoveryRequired(storageRecoveryRequired);
    },
  }));

  useEffect(() => {
    let active = true;
    const attemptId = ++uiAttemptId.current;
    void client.restoreSession()
      .then((restoredUser) => {
        if (!active || uiAttemptId.current !== attemptId) return;
        setUser(restoredUser);
        setStatus(restoredUser ? 'authenticated' : 'unauthenticated');
      })
      .catch((error: unknown) => {
        if (!active || uiAttemptId.current !== attemptId) return;
        setStorageRecoveryRequired(isSessionStorageError(error));
        setUser(null);
        setStatus('unauthenticated');
      });

    return () => {
      active = false;
    };
  }, [client]);

  const login = useCallback(async (input: LoginInput) => {
    const attemptId = ++uiAttemptId.current;
    let response;
    try {
      response = await client.login(input);
    } catch (error: unknown) {
      if (uiAttemptId.current === attemptId && isSessionStorageError(error)) {
        setStorageRecoveryRequired(true);
      }
      throw error;
    }
    if (uiAttemptId.current !== attemptId) return;
    setStorageRecoveryRequired(false);
    setUser(response.user);
    setStatus('authenticated');
  }, [client]);

  const register = useCallback(async (input: RegisterInput) => {
    const attemptId = ++uiAttemptId.current;
    let response;
    try {
      response = await client.register(input);
    } catch (error: unknown) {
      if (uiAttemptId.current === attemptId && isSessionStorageError(error)) {
        setStorageRecoveryRequired(true);
      }
      throw error;
    }
    if (uiAttemptId.current !== attemptId) return;
    setStorageRecoveryRequired(false);
    setUser(response.user);
    setStatus('authenticated');
  }, [client]);

  const updateProfile = useCallback(async (input: UpdateProfileInput) => {
    const attempt = uiAttemptId.current;
    const fields = Object.keys(input) as (keyof UpdateProfileInput)[];
    const owners = fields.map(key => ({ key, version: ++profileWrites.current[key] }));
    const updatedUser = await client.updateProfile(input);
    if (attempt === uiAttemptId.current) setUser(previous => {
      if (attempt !== uiAttemptId.current || !previous || previous.id !== updatedUser.id) return previous;
      const patch = Object.fromEntries(owners.filter(({ key, version }) => profileWrites.current[key] === version).map(({ key }) => [key, updatedUser[key]]));
      return { ...previous, ...patch, updatedAt: previous.updatedAt > updatedUser.updatedAt ? previous.updatedAt : updatedUser.updatedAt };
    });
    return updatedUser;
  }, [client]);

  const updateExtroversion = useCallback(async (level: number) => {
    const attempt = uiAttemptId.current, version = ++profileWrites.current.extroversionLevel;
    const updatedUser = await client.updateExtroversion(level);
    if (attempt === uiAttemptId.current && version === profileWrites.current.extroversionLevel) {
      setUser(previous => attempt !== uiAttemptId.current || version !== profileWrites.current.extroversionLevel || !previous || previous.id !== updatedUser.id ? previous : {
        ...previous, extroversionLevel: updatedUser.extroversionLevel,
        updatedAt: previous.updatedAt > updatedUser.updatedAt ? previous.updatedAt : updatedUser.updatedAt,
      });
    }
    return updatedUser;
  }, [client]);

  const uploadAvatar = useCallback(async (input: AvatarUpload, stillCurrent: () => boolean) => {
    const attempt = uiAttemptId.current, version = ++profileWrites.current.avatar;
    const avatar = await client.uploadAvatar(input);
    if (attempt === uiAttemptId.current && version === profileWrites.current.avatar && stillCurrent()) {
      setUser(previous => previous && attempt === uiAttemptId.current && version === profileWrites.current.avatar && stillCurrent() ? { ...previous, avatar } : previous);
    }
    return avatar;
  }, [client]);

  const refreshAvatar = useCallback(async (stillCurrent: () => boolean) => {
    const attempt = uiAttemptId.current, version = ++profileWrites.current.avatar;
    const updatedUser = await client.getMe();
    if (attempt === uiAttemptId.current && version === profileWrites.current.avatar && stillCurrent()) {
      setUser(previous => previous?.id === updatedUser.id && attempt === uiAttemptId.current && version === profileWrites.current.avatar && stillCurrent() ? { ...previous, avatar: updatedUser.avatar } : previous);
    }
    return updatedUser.avatar;
  }, [client]);
  const getAvatarUrl = useCallback((id: string) => client.getAvatarUrl(id), [client]);

  const logout = useCallback(async () => {
    const attemptId = ++uiAttemptId.current;
    try {
      await client.logout();
    } catch (error: unknown) {
      if (uiAttemptId.current === attemptId && isSessionStorageError(error)) {
        setStorageRecoveryRequired(true);
      }
      throw error;
    }
    if (uiAttemptId.current !== attemptId) return;
    setUser(null);
    setStatus('unauthenticated');
  }, [client]);

  const recoverSessionStorage = useCallback((): Promise<void> => {
    if (storageRecoveryPromise.current) return storageRecoveryPromise.current;
    const attemptId = ++uiAttemptId.current;
    setRecoveringSessionStorage(true);
    const operation = client.recoverSessionStorage().then(() => {
      if (uiAttemptId.current !== attemptId) return;
      setStorageRecoveryRequired(false);
      setUser(null);
      setStatus('unauthenticated');
    }).catch((error: unknown) => {
      if (uiAttemptId.current === attemptId) setStorageRecoveryRequired(true);
      throw error;
    }).finally(() => {
      if (storageRecoveryPromise.current === operation) {
        storageRecoveryPromise.current = null;
        setRecoveringSessionStorage(false);
      }
    });
    storageRecoveryPromise.current = operation;
    return operation;
  }, [client]);

  const value = useMemo<AuthContextValue>(() => ({
    lobbyApi: client,
    status,
    user,
    login,
    register,
    updateProfile,
    updateExtroversion,
    uploadAvatar,
    refreshAvatar,
    getAvatarUrl,
    logout,
    storageRecoveryRequired,
    recoveringSessionStorage,
    recoverSessionStorage,
  }), [
    client,
    status,
    user,
    login,
    register,
    updateProfile,
    updateExtroversion,
    uploadAvatar,
    refreshAvatar,
    getAvatarUrl,
    logout,
    storageRecoveryRequired,
    recoveringSessionStorage,
    recoverSessionStorage,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function isSessionStorageError(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === 'SESSION_STORAGE_ERROR';
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

export function useAuthenticatedAuth(): AuthContextValue & { user: UserProfile } {
  const context = useAuth();
  if (!context.user) {
    throw new Error('Authenticated user is unavailable');
  }
  return { ...context, user: context.user };
}
