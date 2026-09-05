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
import type {
  LoginInput,
  RegisterInput,
  UpdateProfileInput,
  UserProfile,
} from '../api/types';
import { refreshTokenStorage } from './refreshTokenStorage';

export type AuthStatus = 'restoring' | 'authenticated' | 'unauthenticated';

type AuthContextValue = {
  status: AuthStatus;
  user: UserProfile | null;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  updateProfile: (input: UpdateProfileInput) => Promise<UserProfile>;
  updateExtroversion: (level: number) => Promise<UserProfile>;
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
    const updatedUser = await client.updateProfile(input);
    setUser(updatedUser);
    return updatedUser;
  }, [client]);

  const updateExtroversion = useCallback(async (level: number) => {
    const updatedUser = await client.updateExtroversion(level);
    setUser(updatedUser);
    return updatedUser;
  }, [client]);

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
    status,
    user,
    login,
    register,
    updateProfile,
    updateExtroversion,
    logout,
    storageRecoveryRequired,
    recoveringSessionStorage,
    recoverSessionStorage,
  }), [
    status,
    user,
    login,
    register,
    updateProfile,
    updateExtroversion,
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
