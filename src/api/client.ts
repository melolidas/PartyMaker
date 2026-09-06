import { getApiBaseUrl } from './config';
import { getLobbyInvalidation } from './lobbyInvalidation';
import { isLobbyResponse } from './lobbyResponse';
import { isNotificationRead, isNotificationUnreadCount, type NotificationPage, type NotificationRead, type NotificationUnreadCount } from './notificationTypes';
import { getNotificationInvalidation } from './notificationInvalidation';
import type { UpdateLobbyInput } from './lobbyTypes';
import type { CreateLobbyInput, Lobby, LobbyPage, LobbyScope, LobbyMessage, LobbyMessagePage, SendLobbyMessageInput, ChatPage, CancelLobbyResult, LobbyMemberPage } from './lobbyTypes';
import {
  ApiClientError,
  createApiConfigurationError,
  createNetworkError,
  createSessionInvalidatedError,
  createSessionStorageError,
  isInvalidAccessTokenError,
  normalizeApiError,
} from './errors';
import {
  getSessionCoordinator,
  type AuthAttempt,
  type CredentialCommitResult,
  type LogoutAttempt,
  type LogoutServerContext,
  type SessionCoordinator,
  type SessionLease,
} from './sessionCoordinator';
import type {
  Avatar,
  AvatarUpload,
  AuthResponse,
  LoginInput,
  RefreshTokenStorage,
  RegisterInput,
  UpdateProfileInput,
  UserProfile,
} from './types';

type ApiClientOptions = {
  refreshTokenStorage: RefreshTokenStorage;
  baseUrl?: () => string;
  fetchImpl?: typeof fetch;
  onSessionCleared?: (state: { storageRecoveryRequired: boolean }) => void;
};

type RequestOptions = {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  // Rebuild for every actual fetch, including the existing single auth rejection retry.
  formData?: () => FormData;
};

export class ApiClient {
  private readonly sessionCoordinator: SessionCoordinator;
  private readonly baseUrl: () => string;
  private readonly fetchImpl: typeof fetch;
  private readonly onSessionCleared?: ApiClientOptions['onSessionCleared'];
  private accessToken: { session: SessionLease; value: string } | null = null;
  private logoutPromise: Promise<void> | null = null;
  private storageRecoveryPromise: Promise<void> | null = null;

  constructor(options: ApiClientOptions) {
    this.sessionCoordinator = getSessionCoordinator(options.refreshTokenStorage);
    this.baseUrl = options.baseUrl ?? getApiBaseUrl;
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
    this.onSessionCleared = options.onSessionCleared;
  }

  async restoreSession(): Promise<UserProfile | null> {
    const attempt = this.sessionCoordinator.startRestoreAttempt();
    let restoredSession: SessionLease | null = null;

    if (!this.sessionCoordinator.hasRefreshOperationForAttempt(attempt)) {
      let storedRefreshToken: string | null;
      try {
        storedRefreshToken = await this.sessionCoordinator.readRefreshToken(
          attempt,
        );
      } catch {
        if (!this.sessionCoordinator.isAttemptCurrent(attempt)) {
          throw createSessionInvalidatedError();
        }
        this.sessionCoordinator.abandonAuthAttempt(attempt);
        await this.clearLocalSessionIfCurrent(attempt.sourceSession);
        throw createSessionStorageError();
      }

      this.sessionCoordinator.assertAttemptActive(attempt);
      if (!storedRefreshToken) {
        const commit = await this.sessionCoordinator
          .completeRestoreWithoutSession(attempt);
        if (commit.status !== 'committed') {
          throw createSessionInvalidatedError();
        }
        this.accessToken = null;
        return null;
      }
    }

    try {
      const { response, commit } = await this.sessionCoordinator
        .rotateRefreshTokenForAttempt(
          attempt,
          (refreshToken) => this.request<AuthResponse>('/auth/refresh', {
            method: 'POST',
            body: { refreshToken },
          }),
        );
      restoredSession = this.applyCredentialCommit(response, commit);
      if (!restoredSession) throw createSessionInvalidatedError();

      const user = await this.protectedRequestForSession<UserProfile>(
        restoredSession,
        '/users/me',
        { method: 'GET' },
      );
      this.sessionCoordinator.assertSessionActive(restoredSession);
      return user;
    } catch (error: unknown) {
      if (this.isSessionStorageError(error)) throw error;

      if (restoredSession) {
        if (!this.sessionCoordinator.isSessionCurrent(restoredSession)) {
          throw createSessionInvalidatedError();
        }
        await this.clearLocalSessionIfCurrent(restoredSession);
      } else {
        if (!this.sessionCoordinator.isAttemptCurrent(attempt)) {
          throw createSessionInvalidatedError();
        }
        this.sessionCoordinator.abandonAuthAttempt(attempt);
        await this.clearLocalSessionIfCurrent(attempt.sourceSession);
      }
      throw error;
    }
  }

  async register(input: RegisterInput): Promise<AuthResponse> {
    const attempt = this.sessionCoordinator.startExplicitAuthAttempt();
    let response: AuthResponse;
    try {
      response = await this.request<AuthResponse>('/auth/register', {
        method: 'POST',
        body: input,
      });
    } catch (error: unknown) {
      if (!this.sessionCoordinator.isAttemptCurrent(attempt)) {
        throw createSessionInvalidatedError();
      }
      this.sessionCoordinator.abandonAuthAttempt(attempt);
      throw error;
    }

    const accepted = await this.acceptSessionIfCurrent(response, attempt);
    if (!accepted) throw createSessionInvalidatedError();
    return response;
  }

  async login(input: LoginInput): Promise<AuthResponse> {
    const attempt = this.sessionCoordinator.startExplicitAuthAttempt();
    let response: AuthResponse;
    try {
      response = await this.request<AuthResponse>('/auth/login', {
        method: 'POST',
        body: input,
      });
    } catch (error: unknown) {
      if (!this.sessionCoordinator.isAttemptCurrent(attempt)) {
        throw createSessionInvalidatedError();
      }
      this.sessionCoordinator.abandonAuthAttempt(attempt);
      throw error;
    }

    const accepted = await this.acceptSessionIfCurrent(response, attempt);
    if (!accepted) throw createSessionInvalidatedError();
    return response;
  }

  getMe(): Promise<UserProfile> {
    return this.protectedRequest<UserProfile>('/users/me', { method: 'GET' });
  }

  listLobbies(after?: string, scope: LobbyScope = 'all', q?: string): Promise<LobbyPage> {
    const query = after === undefined ? '' : `&after=${encodeURIComponent(after)}`;
    const search = q === undefined ? '' : `&q=${encodeURIComponent(q.trim())}`;
    return this.protectedRequest<LobbyPage>(`/lobbies?limit=20&scope=${scope}${query}${search}`, { method: 'GET' });
  }

  getLobby(id: string): Promise<Lobby> {
    return this.protectedRequest<Lobby>(`/lobbies/${encodeURIComponent(id)}`, { method: 'GET' });
  }

  listLobbyMessages(id: string, before?: string): Promise<LobbyMessagePage> {
    const query = before === undefined ? '' : `&before=${encodeURIComponent(before)}`;
    return this.protectedRequest<LobbyMessagePage>(`/lobbies/${encodeURIComponent(id)}/messages?limit=30${query}`, { method: 'GET' });
  }

  listChats(after?: string): Promise<ChatPage> {
    const query = after === undefined ? '' : `&after=${encodeURIComponent(after)}`;
    return this.protectedRequest<ChatPage>(`/chats?limit=20${query}`, { method: 'GET' });
  }

  listLobbyMembers(id: string, after?: string): Promise<LobbyMemberPage> {
    const query = after === undefined ? '' : `&after=${encodeURIComponent(after)}`;
    return this.protectedRequest<LobbyMemberPage>(`/lobbies/${encodeURIComponent(id)}/members?limit=20${query}`, { method: 'GET' });
  }

  sendLobbyMessage(id: string, input: SendLobbyMessageInput): Promise<LobbyMessage> {
    // Only the existing bounded auth rejection retry, never an automatic network retry.
    return this.protectedRequest<LobbyMessage>(`/lobbies/${encodeURIComponent(id)}/messages`, { method: 'POST', body: input });
  }

  joinLobby(id: string): Promise<Lobby> { return this.changeLobbyMembership(id, 'join'); }
  leaveLobby(id: string): Promise<Lobby> { return this.changeLobbyMembership(id, 'leave'); }

  async cancelLobby(id: string): Promise<CancelLobbyResult> {
    const session = this.sessionCoordinator.capturePublishedSession();
    try {
      const response = await this.protectedRequestForSession<CancelLobbyResult>(session, `/lobbies/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
      if (!response || response.id !== id || response.status !== 'CANCELLED') {
        throw new ApiClientError({ statusCode: 0, code: 'INVALID_API_RESPONSE', message: 'Unconfirmed lobby cancellation' });
      }
      return response;
    } finally {
      // Includes uncertain outcomes, not an assertion of success. Never target the next session.
      if (this.sessionCoordinator.isSessionCurrent(session)) getLobbyInvalidation(this).invalidate();
    }
  }

  private async changeLobbyMembership(id: string, action: 'join' | 'leave'): Promise<Lobby> {
    const session = this.sessionCoordinator.capturePublishedSession();
    try {
      return await this.protectedRequestForSession<Lobby>(session, `/lobbies/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
    } finally {
      // Also refresh after an uncertain response. Never invalidate the next account.
      // List subscribers synchronously advance their generation before old GETs settle.
      if (this.sessionCoordinator.isSessionCurrent(session)) getLobbyInvalidation(this).invalidate();
    }
  }

  createLobby(input: CreateLobbyInput): Promise<Lobby> {
    // The shared transport retries only an explicit INVALID_ACCESS_TOKEN rejection,
    // never an ambiguous network/server failure after a potentially committed POST.
    return this.protectedRequest<Lobby>('/lobbies', { method: 'POST', body: input });
  }

  async updateLobby(id: string, input: UpdateLobbyInput): Promise<Lobby> {
    const session = this.sessionCoordinator.capturePublishedSession();
    try {
      const result = await this.protectedRequestForSession<unknown>(session, `/lobbies/${encodeURIComponent(id)}`, { method: 'PATCH', body: input });
      if (!isLobbyResponse(result, id) || !result.isOrganizer) {
        throw new ApiClientError({ code: 'INVALID_API_RESPONSE', statusCode: 0, message: 'Lobby update is unconfirmed' });
      }
      return result;
    } finally {
      // Refetch after confirmed AND uncertain outcomes, without targeting another session.
      if (this.sessionCoordinator.isSessionCurrent(session)) getLobbyInvalidation(this).invalidate();
    }
  }

  updateProfile(input: UpdateProfileInput): Promise<UserProfile> {
    return this.protectedRequest<UserProfile>('/users/me', {
      method: 'PATCH',
      body: input,
    });
  }

  listNotifications(after?: string): Promise<NotificationPage> {
    const query = new URLSearchParams({ limit: '20', ...(after ? { after } : {}) });
    return this.protectedRequest<NotificationPage>(`/notifications?${query}`, { method: 'GET' });
  }

  async readNotification(id: string): Promise<NotificationRead> {
    const session = this.sessionCoordinator.capturePublishedSession();
    const result = await this.protectedRequestForSession<unknown>(session, `/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
    if (!isNotificationRead(result, id)) throw new ApiClientError({ code: 'INVALID_API_RESPONSE', statusCode: 0, message: 'Notification read is unconfirmed' });
    // Lives above Activity, including a confirmed mark-read finishing after the tab closes.
    if (this.sessionCoordinator.isSessionCurrent(session)) getNotificationInvalidation(this).invalidate();
    return result;
  }

  async getNotificationUnreadCount(): Promise<NotificationUnreadCount> {
    const result = await this.protectedRequest<unknown>('/notifications/unread-count', { method: 'GET' });
    if (!isNotificationUnreadCount(result)) throw new ApiClientError({ code: 'INVALID_API_RESPONSE', statusCode: 0, message: 'Invalid notification count' });
    return result;
  }

  getAvatarUrl(id: string): string {
    return `${this.baseUrl()}/media/avatars/${encodeURIComponent(id)}`;
  }

  async uploadAvatar(input: AvatarUpload): Promise<Avatar> {
    const result = await this.protectedRequest<{ avatar: Avatar }>('/users/me/avatar', {
      method: 'POST', formData: () => {
        const form = new FormData();
        const name = input.mimeType === 'image/png' ? 'avatar.png' : 'avatar.jpg';
        if (input.file) form.append('file', input.file, name);
        else form.append('file', { uri: input.uri, type: input.mimeType, name } as unknown as Blob);
        return form;
      },
    });
    const avatar = result?.avatar;
    if (!avatar || typeof avatar.id !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(avatar.id)
      || avatar.mimeType !== 'image/jpeg' || avatar.width !== 512 || avatar.height !== 512) {
      throw new ApiClientError({ code: 'INVALID_API_RESPONSE', statusCode: 0, message: 'Avatar replacement is unconfirmed' });
    }
    return avatar;
  }

  async removeAvatar(avatarId: string): Promise<void> {
    const result = await this.protectedRequest<unknown>(`/users/me/avatar/${encodeURIComponent(avatarId)}`, { method: 'DELETE' });
    if (!result || typeof result !== 'object' || Array.isArray(result)
      || Object.keys(result).join(',') !== 'avatar' || (result as { avatar: unknown }).avatar !== null) {
      throw new ApiClientError({ code: 'INVALID_API_RESPONSE', statusCode: 0, message: 'Avatar removal is unconfirmed' });
    }
  }

  updateExtroversion(level: number): Promise<UserProfile> {
    return this.protectedRequest<UserProfile>('/users/me/extroversion', {
      method: 'PUT',
      body: { level },
    });
  }

  logout(): Promise<void> {
    if (this.logoutPromise) return this.logoutPromise;

    const initialAccessToken = this.getCurrentAccessToken();
    let attempt: LogoutAttempt;
    try {
      attempt = this.sessionCoordinator.beginLogoutAttempt();
    } catch (error: unknown) {
      return Promise.reject(error);
    }
    this.accessToken = null;

    let operation: Promise<void>;
    operation = this.completeLogout(initialAccessToken, attempt)
      .finally(() => {
        this.accessToken = null;
        if (this.logoutPromise === operation) this.logoutPromise = null;
      });
    this.logoutPromise = operation;
    return operation;
  }

  recoverSessionStorage(): Promise<void> {
    if (this.storageRecoveryPromise) return this.storageRecoveryPromise;
    this.accessToken = null;
    const operation = this.sessionCoordinator.recoverSessionStorage()
      .then((recovery) => {
        if (recovery.status === 'storage-error') throw createSessionStorageError();
        if (recovery.status !== 'ready') throw createSessionInvalidatedError();
        if (this.sessionCoordinator.shouldNotifySessionCleared(recovery.session)) {
          this.onSessionCleared?.({ storageRecoveryRequired: this.sessionCoordinator.requiresStorageRecovery() });
        }
      }).finally(() => {
        if (this.storageRecoveryPromise === operation) this.storageRecoveryPromise = null;
      });
    this.storageRecoveryPromise = operation;
    return operation;
  }

  private async protectedRequest<T>(
    path: string,
    options: RequestOptions,
  ): Promise<T> {
    const session = this.sessionCoordinator.capturePublishedSession();
    return this.protectedRequestForSession(session, path, options);
  }

  private async protectedRequestForSession<T>(
    session: SessionLease,
    path: string,
    options: RequestOptions,
  ): Promise<T> {
    let tokenUsed = this.getAccessToken(session);
    let refreshedBeforeRequest = false;

    if (!tokenUsed) {
      tokenUsed = (await this.refreshSession(session)).accessToken;
      refreshedBeforeRequest = true;
    }

    try {
      const response = await this.request<T>(path, options, tokenUsed);
      this.sessionCoordinator.assertSessionActive(session);
      return response;
    } catch (error: unknown) {
      this.sessionCoordinator.assertSessionActive(session);
      if (!isInvalidAccessTokenError(error)) throw error;
      if (refreshedBeforeRequest) {
        await this.clearLocalSessionIfCurrent(session);
        throw error;
      }

      const currentAccessToken = this.getAccessToken(session);
      const replacementToken = currentAccessToken
        && currentAccessToken !== tokenUsed
        ? currentAccessToken
        : (await this.refreshSession(session)).accessToken;

      try {
        const response = await this.request<T>(
          path,
          options,
          replacementToken,
        );
        this.sessionCoordinator.assertSessionActive(session);
        return response;
      } catch (retryError: unknown) {
        this.sessionCoordinator.assertSessionActive(session);
        if (isInvalidAccessTokenError(retryError)) {
          await this.clearLocalSessionIfCurrent(session);
        }
        throw retryError;
      }
    }
  }

  private async refreshSession(session: SessionLease): Promise<AuthResponse> {
    try {
      const { response, commit } = await this.sessionCoordinator
        .rotateRefreshTokenForSession(
          session,
          (refreshToken) => this.request<AuthResponse>('/auth/refresh', {
            method: 'POST',
            body: { refreshToken },
          }),
        );
      const acceptedSession = this.applyCredentialCommit(response, commit);
      if (!acceptedSession) throw createSessionInvalidatedError();
      this.sessionCoordinator.assertSessionActive(acceptedSession);
      return response;
    } catch (error: unknown) {
      if (this.isSessionStorageError(error)) throw error;
      if (!this.sessionCoordinator.isSessionCurrent(session)) {
        throw createSessionInvalidatedError();
      }
      await this.clearLocalSessionIfCurrent(session);
      throw error;
    }
  }

  private async acceptSessionIfCurrent(
    response: AuthResponse,
    attempt: AuthAttempt,
  ): Promise<SessionLease | null> {
    const commit = await this.sessionCoordinator.commitAuthCredentials(
      attempt,
      response.refreshToken,
    );
    return this.applyCredentialCommit(response, commit);
  }

  private async completeLogout(
    initialAccessToken: string | null,
    attempt: LogoutAttempt,
  ): Promise<void> {
    const cleanup = await attempt.cleanup;
    this.accessToken = null;

    const serverContext = this.sessionCoordinator
      .claimLogoutServerContext(attempt);
    if (serverContext) {
      this.startBestEffortLogout(initialAccessToken, serverContext);
    }

    if (cleanup.status === 'storage-error') {
      throw createSessionStorageError();
    }
    if (cleanup.status !== 'cleared') {
      throw createSessionInvalidatedError();
    }
    if (this.sessionCoordinator.shouldNotifySessionCleared(cleanup.session)) {
      this.onSessionCleared?.({ storageRecoveryRequired: this.sessionCoordinator.requiresStorageRecovery() });
    }
  }

  private startBestEffortLogout(
    initialAccessToken: string | null,
    context: LogoutServerContext,
  ): void {
    void this.revokeSessionForLogout(initialAccessToken, context)
      .catch(() => undefined);
  }

  private async revokeSessionForLogout(
    initialAccessToken: string | null,
    context: LogoutServerContext,
  ): Promise<void> {
    if (initialAccessToken) {
      try {
        await this.request<void>(
          '/auth/logout',
          { method: 'POST' },
          initialAccessToken,
        );
        return;
      } catch (error: unknown) {
        if (!isInvalidAccessTokenError(error)) throw error;
      }
    }

    const refreshed = await this.refreshForLogout(context);
    if (!refreshed) return;
    await this.request<void>(
      '/auth/logout',
      { method: 'POST' },
      refreshed.accessToken,
    );
  }

  private async refreshForLogout(
    context: LogoutServerContext,
  ): Promise<AuthResponse | null> {
    return context.inFlightRefresh;
  }

  private async clearLocalSessionIfCurrent(
    session: SessionLease,
  ): Promise<void> {
    const cleanup = await this.sessionCoordinator.clearSessionIfCurrent(
      session,
    );
    if (cleanup.status === 'stale') return;

    this.accessToken = null;
    if (cleanup.status === 'storage-error') {
      throw createSessionStorageError();
    }
    if (this.sessionCoordinator.shouldNotifySessionCleared(cleanup.session)) {
      this.onSessionCleared?.({ storageRecoveryRequired: this.sessionCoordinator.requiresStorageRecovery() });
    }
  }

  private applyCredentialCommit(
    response: AuthResponse,
    commit: CredentialCommitResult,
  ): SessionLease | null {
    if (commit.status === 'stale') return null;
    if (commit.status === 'storage-error') {
      this.accessToken = null;
      if (
        commit.sessionCleared
        && commit.clearedSession
        && this.sessionCoordinator.shouldNotifySessionCleared(
          commit.clearedSession,
        )
      ) {
        this.onSessionCleared?.({ storageRecoveryRequired: this.sessionCoordinator.requiresStorageRecovery() });
      }
      throw createSessionStorageError();
    }

    this.sessionCoordinator.assertSessionActive(commit.session);
    this.accessToken = {
      session: commit.session,
      value: response.accessToken,
    };
    return commit.session;
  }

  private getAccessToken(session: SessionLease): string | null {
    return this.accessToken?.session === session
      ? this.accessToken.value
      : null;
  }

  private getCurrentAccessToken(): string | null {
    if (!this.accessToken) return null;
    return this.sessionCoordinator.isSessionCurrent(this.accessToken.session)
      ? this.accessToken.value
      : null;
  }

  private isSessionStorageError(error: unknown): boolean {
    return error instanceof ApiClientError
      && error.code === 'SESSION_STORAGE_ERROR';
  }

  private async request<T>(
    path: string,
    options: RequestOptions,
    accessToken?: string,
  ): Promise<T> {
    let apiBaseUrl: string;
    try {
      apiBaseUrl = this.baseUrl();
    } catch {
      throw createApiConfigurationError();
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (!options.formData && options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    let response: Response;
    try {
      response = await this.fetchImpl(`${apiBaseUrl}${path}`, {
        method: options.method,
        headers,
        ...(options.formData ? { body: options.formData() } : options.body !== undefined
          ? { body: JSON.stringify(options.body) }
          : {}),
      });
    } catch (error: unknown) {
      if (error instanceof ApiClientError) throw error;
      throw createNetworkError();
    }

    if (!response.ok) {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }
      throw normalizeApiError(response.status, payload);
    }

    if (response.status === 204) return undefined as T;

    try {
      return await response.json() as T;
    } catch {
      throw new ApiClientError({
        statusCode: response.status,
        code: 'INVALID_API_RESPONSE',
        message: 'The API returned invalid JSON',
      });
    }
  }
}
