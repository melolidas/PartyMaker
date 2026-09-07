import {
  createMissingRefreshTokenError,
  createSessionInvalidatedError,
  createSessionStorageError,
} from './errors';
import type { AuthResponse, RefreshTokenStorage } from './types';

export type SessionLease = Readonly<{
  id: number;
  type: 'session';
}>;

export type AuthAttempt = Readonly<{
  id: number;
  type: 'auth-attempt';
  mode: 'explicit' | 'restore';
  sourceSession: SessionLease;
  canRecoverFence: boolean;
}>;

export type CredentialCommitResult =
  | { status: 'committed'; session: SessionLease }
  | { status: 'stale' }
  | {
    status: 'storage-error';
    sessionCleared: boolean;
    clearedSession: SessionLease | null;
  };

export type SessionCleanupResult =
  | { status: 'cleared'; session: SessionLease }
  | { status: 'stale' }
  | { status: 'storage-error' };

export type SessionRecoveryResult =
  | { status: 'ready'; session: SessionLease }
  | { status: 'stale' }
  | { status: 'storage-error' };

export type LogoutAttempt = Readonly<{
  id: number;
  cleanup: Promise<SessionCleanupResult>;
}>;

export type LogoutServerContext = {
  inFlightRefresh: Promise<AuthResponse> | null;
};

type SharedRefreshOperation = {
  sourceSession: SessionLease;
  response: Promise<AuthResponse>;
  sessionCommit: Promise<CredentialCommitResult> | null;
};

type LogoutOperation = {
  id: number;
  cleanup: Promise<SessionCleanupResult>;
  status: 'pending' | 'cleared' | 'storage-error';
  resultingSession: SessionLease;
  inFlightRefresh: Promise<AuthResponse> | null;
  serverContextClaimed: boolean;
};

type CredentialWriteTransition = Readonly<{
  attempt: AuthAttempt;
}>;

type StorageWriteResult =
  | { status: 'written' }
  | { status: 'failed' }
  | { status: 'timed-out' };

type StorageWriteQuarantine = {
  initialInvalidation: Promise<boolean>;
  cleanup: Promise<void>;
  readyToReconcile: boolean;
  reconciling: boolean;
};

const DEFAULT_STORAGE_WRITE_TIMEOUT_MS = 5_000;

const coordinators = new WeakMap<RefreshTokenStorage, SessionCoordinator>();

export function getSessionCoordinator(
  storage: RefreshTokenStorage,
): SessionCoordinator {
  const existing = coordinators.get(storage);
  if (existing) return existing;

  const coordinator = new SessionCoordinator(storage);
  coordinators.set(storage, coordinator);
  return coordinator;
}

export class SessionCoordinator {
  private nextGenerationId = 0;
  private publishedSession: SessionLease;
  private activeAuthAttempt: AuthAttempt | null = null;
  private credentialWriteTransition: CredentialWriteTransition | null = null;
  private recoveryFence = false;
  // Unlike revocation failure, this fence cannot be recovered by blindly
  // starting a new login. Only a successful, explicit readiness check clears it.
  private storageReadinessFence = false;
  private blockingCleanup: object | null = null;
  private storageMutationTail: Promise<void> = Promise.resolve();
  private storageWriteQuarantine: StorageWriteQuarantine | null = null;
  private refreshOperation: SharedRefreshOperation | null = null;
  private logoutOperation: LogoutOperation | null = null;
  private storageRecoveryOperation: Promise<SessionRecoveryResult> | null = null;
  private readonly logoutAttempts = new WeakMap<
    LogoutAttempt,
    LogoutOperation
  >();

  constructor(private readonly storage: RefreshTokenStorage) {
    this.publishedSession = this.createSessionLease();
  }

  startRestoreAttempt(): AuthAttempt {
    return this.startAuthAttempt('restore', false);
  }

  startExplicitAuthAttempt(): AuthAttempt {
    return this.startAuthAttempt('explicit', true);
  }

  abandonAuthAttempt(attempt: AuthAttempt): void {
    if (this.activeAuthAttempt === attempt) this.activeAuthAttempt = null;
  }

  isAttemptCurrent(attempt: AuthAttempt): boolean {
    return this.blockingCleanup === null
      && this.activeAuthAttempt === attempt;
  }

  assertAttemptActive(attempt: AuthAttempt): void {
    if (this.storageWriteQuarantine || this.storageReadinessFence) throw createSessionStorageError();
    if (!this.isAttemptCurrent(attempt)) {
      throw createSessionInvalidatedError();
    }
    if (this.recoveryFence && !attempt.canRecoverFence) {
      throw createSessionStorageError();
    }
  }

  capturePublishedSession(): SessionLease {
    const session = this.publishedSession;
    this.assertSessionActive(session);
    return session;
  }

  isSessionCurrent(session: SessionLease): boolean {
    return this.storageWriteQuarantine === null
      && this.blockingCleanup === null
      && this.credentialWriteTransition === null
      && this.publishedSession === session;
  }

  assertSessionActive(session: SessionLease): void {
    if (this.storageWriteQuarantine || this.storageReadinessFence) throw createSessionStorageError();
    if (!this.isSessionCurrent(session)) {
      throw createSessionInvalidatedError();
    }
    if (this.recoveryFence) throw createSessionStorageError();
  }

  shouldNotifySessionCleared(session: SessionLease): boolean {
    return this.blockingCleanup === null
      && this.credentialWriteTransition === null
      && this.publishedSession === session;
  }

  requiresStorageRecovery(): boolean {
    return this.storageReadinessFence || this.recoveryFence || this.storageWriteQuarantine !== null;
  }

  hasRefreshOperationForAttempt(attempt: AuthAttempt): boolean {
    return this.refreshOperation?.sourceSession === attempt.sourceSession;
  }

  async readRefreshToken(attempt: AuthAttempt): Promise<string | null> {
    this.assertAttemptActive(attempt);
    return this.runStorageRead(async () => {
      this.assertAttemptActive(attempt);
      let refreshToken: string | null;
      try {
        refreshToken = await this.storage.get();
      } catch (error: unknown) {
        // A superseded restore must not fence a newer explicit auth attempt.
        this.assertAttemptActive(attempt);
        if (this.storage.assertReadyForNewSession) this.storageReadinessFence = true;
        throw error;
      }
      this.assertAttemptActive(attempt);
      return refreshToken;
    });
  }

  completeRestoreWithoutSession(
    attempt: AuthAttempt,
  ): Promise<CredentialCommitResult> {
    return this.runStorageMutation(async () => {
      if (!this.isAttemptEligible(attempt)) return { status: 'stale' };

      const session = this.createSessionLease();
      this.publishedSession = session;
      this.activeAuthAttempt = null;
      this.refreshOperation = null;
      this.logoutOperation = null;
      return { status: 'committed', session };
    });
  }

  async rotateRefreshTokenForAttempt(
    attempt: AuthAttempt,
    rotate: (refreshToken: string) => Promise<AuthResponse>,
  ): Promise<{ response: AuthResponse; commit: CredentialCommitResult }> {
    const operation = await this.getOrCreateRefreshOperation(
      attempt.sourceSession,
      () => this.assertAttemptActive(attempt),
      rotate,
    );

    let response: AuthResponse;
    try {
      response = await operation.response;
    } catch (error: unknown) {
      if (!this.isAttemptCurrent(attempt)) {
        throw createSessionInvalidatedError();
      }
      throw error;
    }

    this.assertAttemptActive(attempt);
    const commit = await this.commitAuthCredentials(
      attempt,
      response.refreshToken,
    );
    if (commit.status !== 'stale' && this.refreshOperation === operation) {
      this.refreshOperation = null;
    }
    return { response, commit };
  }

  async rotateRefreshTokenForSession(
    session: SessionLease,
    rotate: (refreshToken: string) => Promise<AuthResponse>,
  ): Promise<{ response: AuthResponse; commit: CredentialCommitResult }> {
    const operation = await this.getOrCreateRefreshOperation(
      session,
      () => this.assertSessionActive(session),
      rotate,
    );

    let response: AuthResponse;
    try {
      response = await operation.response;
    } catch (error: unknown) {
      if (!this.isSessionCurrent(session)) {
        throw createSessionInvalidatedError();
      }
      throw error;
    }

    this.assertSessionActive(session);
    operation.sessionCommit ??= this.commitSessionCredentials(
      session,
      response.refreshToken,
    );
    const commit = await operation.sessionCommit;
    if (commit.status !== 'stale' && this.refreshOperation === operation) {
      this.refreshOperation = null;
    }
    return { response, commit };
  }

  commitAuthCredentials(
    attempt: AuthAttempt,
    refreshToken: string,
  ): Promise<CredentialCommitResult> {
    return this.runStorageMutation(async () => {
      if (this.storageWriteQuarantine) {
        if (this.activeAuthAttempt === attempt) this.activeAuthAttempt = null;
        return {
          status: 'storage-error',
          sessionCleared: false,
          clearedSession: null,
        };
      }
      if (!this.isAttemptEligible(attempt)) return { status: 'stale' };

      const transition = this.beginCredentialWrite(attempt);
      try {
        const writeResult = await this.writeRefreshToken(refreshToken);
        if (writeResult.status === 'failed') {
          const attemptWasCurrent = this.isAttemptCurrent(attempt);
          const invalidation = await this.invalidateCredentialWrite(
            attempt.sourceSession,
          );
          if (this.activeAuthAttempt === attempt && this.storage.assertReadyForNewSession) {
            this.storageReadinessFence = true;
          }
          if (this.activeAuthAttempt === attempt) this.activeAuthAttempt = null;
          if (!attemptWasCurrent) return { status: 'stale' };
          return {
            status: 'storage-error',
            sessionCleared: invalidation.storageSafe
              && invalidation.clearedSession !== null,
            clearedSession: invalidation.clearedSession,
          };
        }
        if (writeResult.status === 'timed-out') {
          const attemptWasCurrent = this.isAttemptCurrent(attempt);
          const clearedSession = this.invalidateAfterTimedOutWrite(
            attempt.sourceSession,
          );
          this.activeAuthAttempt = null;
          if (!attemptWasCurrent) return { status: 'stale' };
          return {
            status: 'storage-error',
            sessionCleared: false,
            clearedSession,
          };
        }

        if (!this.isAttemptEligible(attempt)) {
          await this.invalidateCredentialWrite(attempt.sourceSession);
          return { status: 'stale' };
        }

        const session = this.createSessionLease();
        this.publishedSession = session;
        this.activeAuthAttempt = null;
        this.refreshOperation = null;
        this.logoutOperation = null;
        if (attempt.canRecoverFence) this.recoveryFence = false;
        return { status: 'committed', session };
      } finally {
        this.endCredentialWrite(transition);
      }
    });
  }

  async clearSessionIfCurrent(
    session: SessionLease,
  ): Promise<SessionCleanupResult> {
    if (!this.isSessionCurrent(session)) return { status: 'stale' };

    const cleanup = {};
    this.blockingCleanup = cleanup;
    const resultingSession = this.createSessionLease();
    this.publishedSession = resultingSession;
    if (
      this.activeAuthAttempt?.mode === 'restore'
      && this.activeAuthAttempt.sourceSession === session
    ) {
      this.activeAuthAttempt = null;
    }
    this.refreshOperation = null;

    const storageSafe = await this.runStorageMutation(
      () => this.tryDurableInvalidation(),
    );
    this.recoveryFence = !storageSafe;
    if (this.blockingCleanup === cleanup) this.blockingCleanup = null;
    return storageSafe
      ? { status: 'cleared', session: resultingSession }
      : { status: 'storage-error' };
  }

  beginLogoutAttempt(): LogoutAttempt {
    const quarantine = this.storageWriteQuarantine;
    if (quarantine?.readyToReconcile) this.reconcileStorageWrite(quarantine);
    const existing = this.logoutOperation;
    if (
      existing?.status === 'pending'
      || (
        existing?.status === 'cleared'
        && this.activeAuthAttempt === null
        && this.publishedSession === existing.resultingSession
      )
    ) {
      return existing;
    }
    if (this.blockingCleanup !== null) {
      throw createSessionInvalidatedError();
    }

    const sourceSession = this.publishedSession;
    const resultingSession = this.createSessionLease();
    const operation: LogoutOperation = {
      id: this.nextId(),
      cleanup: Promise.resolve({ status: 'stale' }),
      status: 'pending',
      resultingSession,
      inFlightRefresh: this.refreshOperation?.sourceSession === sourceSession
        ? this.refreshOperation.response
        : null,
      serverContextClaimed: false,
    };

    this.activeAuthAttempt = null;
    this.publishedSession = resultingSession;
    this.refreshOperation = null;
    this.blockingCleanup = operation;
    this.logoutOperation = operation;

    const cleanup = async (): Promise<SessionCleanupResult> => {
      if (this.storageWriteQuarantine) {
        operation.status = 'storage-error';
        this.recoveryFence = true;
        if (this.blockingCleanup === operation) this.blockingCleanup = null;
        return { status: 'storage-error' };
      }
      const storageSafe = await this.tryDurableInvalidation();
      operation.status = storageSafe ? 'cleared' : 'storage-error';
      this.recoveryFence = !storageSafe;
      if (this.blockingCleanup === operation) this.blockingCleanup = null;
      return storageSafe
        ? { status: 'cleared', session: resultingSession }
        : { status: 'storage-error' };
    };
    operation.cleanup = this.storageWriteQuarantine
      ? cleanup()
      : this.runStorageMutation(cleanup);
    this.logoutAttempts.set(operation, operation);
    return operation;
  }

  claimLogoutServerContext(
    attempt: LogoutAttempt,
  ): LogoutServerContext | null {
    const operation = this.logoutAttempts.get(attempt);
    if (!operation || operation.serverContextClaimed) return null;

    operation.serverContextClaimed = true;
    const context = {
      inFlightRefresh: operation.inFlightRefresh,
    };
    operation.inFlightRefresh = null;
    return context;
  }

  recoverSessionStorage(): Promise<SessionRecoveryResult> {
    if (this.storageRecoveryOperation) return this.storageRecoveryOperation;
    this.storageReadinessFence = true;

    const operation = Promise.resolve().then(async (): Promise<SessionRecoveryResult> => {
      const quarantine = this.storageWriteQuarantine;
      if (quarantine) {
        // A retry is not permission to bypass any unresolved original I/O.
        if (!quarantine.readyToReconcile) return { status: 'storage-error' };
        this.reconcileStorageWrite(quarantine);
        const completed = await this.observeRecoveryStep(quarantine.cleanup);
        if (!completed || this.storageWriteQuarantine || this.recoveryFence) {
          return { status: 'storage-error' };
        }
      } else {
        const cleanup = await this.beginLogoutAttempt().cleanup;
        if (cleanup.status !== 'cleared') return cleanup;
      }

      const sourceSession = this.publishedSession;
      // Read lane only: timeout abandons this observation, not a mutation.
      // A late read has no continuation that can release a newer fence/session.
      const ready = await this.observeRecoveryStep(this.runStorageRead(async () => {
        await this.storage.assertReadyForNewSession?.();
      }));
      if (!ready || this.storageWriteQuarantine || this.recoveryFence) {
        return { status: 'storage-error' };
      }
      if (this.publishedSession !== sourceSession || this.blockingCleanup !== null) {
        return { status: 'stale' };
      }
      const session = this.createSessionLease();
      this.publishedSession = session;
      this.activeAuthAttempt = null;
      this.refreshOperation = null;
      this.logoutOperation = null;
      this.storageReadinessFence = false;
      return { status: 'ready', session };
    }).finally(() => {
      if (this.storageRecoveryOperation === operation) this.storageRecoveryOperation = null;
    });
    this.storageRecoveryOperation = operation;
    return operation;
  }

  private async observeRecoveryStep(step: Promise<void>): Promise<boolean> {
    const deadline = this.createStorageWriteDeadline();
    try {
      return await Promise.race([
        step.then(() => true, () => false),
        deadline.expired.then(() => false, () => false),
      ]);
    } finally {
      deadline.cancel();
    }
  }

  private startAuthAttempt(
    mode: AuthAttempt['mode'],
    canRecoverFence: boolean,
  ): AuthAttempt {
    if (this.storageWriteQuarantine !== null || this.storageRecoveryOperation !== null
      || this.storageReadinessFence) {
      throw createSessionStorageError();
    }
    if (this.blockingCleanup !== null) {
      throw createSessionInvalidatedError();
    }
    if (
      mode === 'restore'
      && (
        this.activeAuthAttempt?.mode === 'explicit'
        || this.credentialWriteTransition?.attempt.mode === 'explicit'
      )
    ) {
      throw createSessionInvalidatedError();
    }
    if (this.recoveryFence && !canRecoverFence) {
      throw createSessionStorageError();
    }

    const attempt = Object.freeze({
      id: this.nextId(),
      type: 'auth-attempt' as const,
      mode,
      sourceSession: this.publishedSession,
      canRecoverFence,
    });
    this.activeAuthAttempt = attempt;
    return attempt;
  }

  private isAttemptEligible(attempt: AuthAttempt): boolean {
    return this.isAttemptCurrent(attempt)
      && !this.storageReadinessFence
      && (attempt.canRecoverFence || !this.recoveryFence);
  }

  private async getOrCreateRefreshOperation(
    sourceSession: SessionLease,
    assertCallerActive: () => void,
    rotate: (refreshToken: string) => Promise<AuthResponse>,
  ): Promise<SharedRefreshOperation> {
    assertCallerActive();
    const current = this.refreshOperation;
    if (current?.sourceSession === sourceSession) return current;

    return this.runStorageRead(async () => {
      assertCallerActive();
      const existing = this.refreshOperation;
      if (existing?.sourceSession === sourceSession) return existing;

      let refreshToken: string | null;
      try {
        refreshToken = await this.storage.get();
      } catch (error: unknown) {
        assertCallerActive();
        if (this.storage.assertReadyForNewSession && this.activeAuthAttempt?.mode !== 'explicit') {
          this.storageReadinessFence = true;
        }
        throw error;
      }
      assertCallerActive();
      if (!refreshToken) throw createMissingRefreshTokenError();

      const operationAfterRead = this.refreshOperation;
      if (operationAfterRead?.sourceSession === sourceSession) {
        return operationAfterRead;
      }

      const response = Promise.resolve().then(() => rotate(refreshToken));
      const created: SharedRefreshOperation = {
        sourceSession,
        response,
        sessionCommit: null,
      };
      this.refreshOperation = created;
      void response.then(undefined, () => {
        if (this.refreshOperation === created) this.refreshOperation = null;
      });
      return created;
    });
  }

  private commitSessionCredentials(
    session: SessionLease,
    refreshToken: string,
  ): Promise<CredentialCommitResult> {
    return this.runStorageMutation(async () => {
      if (this.storageWriteQuarantine) {
        return {
          status: 'storage-error',
          sessionCleared: false,
          clearedSession: null,
        };
      }
      if (!this.isSessionEligible(session)) return { status: 'stale' };

      const writeResult = await this.writeRefreshToken(refreshToken);
      if (writeResult.status === 'failed') {
        const sessionWasCurrent = this.isSessionCurrent(session);
        const invalidation = await this.invalidateCredentialWrite(session);
        if (invalidation.clearedSession === this.publishedSession
          && this.activeAuthAttempt?.mode !== 'explicit' && this.storage.assertReadyForNewSession) {
          this.storageReadinessFence = true;
        }
        if (!sessionWasCurrent) return { status: 'stale' };
        return {
          status: 'storage-error',
          sessionCleared: invalidation.storageSafe
            && invalidation.clearedSession !== null,
          clearedSession: invalidation.clearedSession,
        };
      }
      if (writeResult.status === 'timed-out') {
        const sessionWasCurrent = this.publishedSession === session
          && this.blockingCleanup === null;
        const clearedSession = this.invalidateAfterTimedOutWrite(session);
        this.activeAuthAttempt = null;
        if (!sessionWasCurrent) return { status: 'stale' };
        return {
          status: 'storage-error',
          sessionCleared: false,
          clearedSession,
        };
      }

      if (!this.isSessionEligible(session)) {
        await this.invalidateCredentialWrite(session);
        return { status: 'stale' };
      }

      return { status: 'committed', session };
    });
  }

  private isSessionEligible(session: SessionLease): boolean {
    return this.storageWriteQuarantine === null
      && !this.storageReadinessFence
      && this.isSessionCurrent(session)
      && !this.recoveryFence;
  }

  private beginCredentialWrite(
    attempt: AuthAttempt,
  ): CredentialWriteTransition {
    const transition = Object.freeze({ attempt });
    this.credentialWriteTransition = transition;
    return transition;
  }

  private endCredentialWrite(transition: CredentialWriteTransition): void {
    if (this.credentialWriteTransition === transition) {
      this.credentialWriteTransition = null;
    }
  }

  private async invalidateCredentialWrite(
    sourceSession: SessionLease,
  ): Promise<{
    storageSafe: boolean;
    clearedSession: SessionLease | null;
  }> {
    const storageSafe = await this.tryDurableInvalidation();
    this.recoveryFence = !storageSafe;
    let clearedSession: SessionLease | null = null;
    if (this.publishedSession === sourceSession) {
      clearedSession = this.createSessionLease();
      this.publishedSession = clearedSession;
    }
    if (this.refreshOperation?.sourceSession === sourceSession) {
      this.refreshOperation = null;
    }
    return { storageSafe, clearedSession };
  }

  private createSessionLease(): SessionLease {
    return Object.freeze({
      id: this.nextId(),
      type: 'session' as const,
    });
  }

  private nextId(): number {
    this.nextGenerationId += 1;
    return this.nextGenerationId;
  }

  private async tryDurableInvalidation(): Promise<boolean> {
    if (this.storageWriteQuarantine) return false;
    const result = await this.runBoundedStorageMutation(() => this.storage.clear());
    return result.status === 'written';
  }

  private async writeRefreshToken(
    refreshToken: string,
  ): Promise<StorageWriteResult> {
    return this.runBoundedStorageMutation(() => this.storage.set(refreshToken));
  }

  private async runBoundedStorageMutation(
    operation: () => Promise<void>,
  ): Promise<StorageWriteResult> {
    let write: Promise<{ status: 'written' } | { status: 'failed' }>;
    try {
      write = Promise.resolve(operation()).then(
        () => ({ status: 'written' as const }),
        () => ({ status: 'failed' as const }),
      );
    } catch {
      return { status: 'failed' };
    }

    const deadline = this.createStorageWriteDeadline();
    const result = await Promise.race<StorageWriteResult>([
      write,
      deadline.expired.then(
        () => ({ status: 'timed-out' as const }),
        () => ({ status: 'timed-out' as const }),
      ),
    ]);
    deadline.cancel();
    if (result.status !== 'timed-out') return result;

    // Quarantine owns ALL still-running I/O. Nothing after the deadline is on
    // the API path, including the attempt to persist an additional revocation.
    this.beginStorageWriteQuarantine(write);
    return result;
  }

  private createStorageWriteDeadline(): {
    expired: Promise<void>;
    cancel: () => void;
  } {
    if (this.storage.createWriteDeadline) {
      return this.storage.createWriteDeadline();
    }

    let timeout: ReturnType<typeof setTimeout> | null = null;
    const expired = new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, DEFAULT_STORAGE_WRITE_TIMEOUT_MS);
    });
    return {
      expired,
      cancel() {
        if (timeout !== null) clearTimeout(timeout);
        timeout = null;
      },
    };
  }

  private beginStorageWriteQuarantine(
    write: Promise<{ status: 'written' } | { status: 'failed' }>,
  ): StorageWriteQuarantine {
    const quarantine: StorageWriteQuarantine = {
      initialInvalidation: Promise.resolve(false),
      cleanup: Promise.resolve(),
      readyToReconcile: false,
      reconciling: false,
    };
    this.storageWriteQuarantine = quarantine;
    this.recoveryFence = true;
    quarantine.initialInvalidation = this.tryQuarantinePendingWrite();

    quarantine.cleanup = (async () => {
      await Promise.all([quarantine.initialInvalidation, write]);
      quarantine.readyToReconcile = true;
      this.reconcileStorageWrite(quarantine);
    })();
    void quarantine.cleanup.catch(() => undefined);
    return quarantine;
  }

  private reconcileStorageWrite(quarantine: StorageWriteQuarantine): void {
    if (quarantine.reconciling || this.storageWriteQuarantine !== quarantine) return;
    quarantine.reconciling = true;
    // Retain mutation ordering. Retries return a bounded error even if this
    // cleanup hangs; a later logout may retry a settled, failed cleanup.
    quarantine.cleanup = this.runStorageMutation(async () => {
      const storageSafe = await this.tryResolvePendingWrite();
      if (storageSafe && this.storageWriteQuarantine === quarantine) {
        this.storageWriteQuarantine = null;
        this.recoveryFence = false;
      }
    }).finally(() => { quarantine.reconciling = false; });
    void quarantine.cleanup.catch(() => undefined);
  }

  private invalidateAfterTimedOutWrite(
    sourceSession: SessionLease,
  ): SessionLease | null {
    let clearedSession: SessionLease | null = null;
    if (this.publishedSession === sourceSession) {
      clearedSession = this.createSessionLease();
      this.publishedSession = clearedSession;
    }
    if (this.refreshOperation?.sourceSession === sourceSession) {
      this.refreshOperation = null;
    }
    return clearedSession;
  }

  private async tryQuarantinePendingWrite(): Promise<boolean> {
    try {
      if (this.storage.quarantinePendingWrite) {
        await this.storage.quarantinePendingWrite();
      } else {
        await this.storage.clear();
      }
      return true;
    } catch {
      return false;
    }
  }

  private async tryResolvePendingWrite(): Promise<boolean> {
    try {
      if (this.storage.resolvePendingWrite) {
        await this.storage.resolvePendingWrite();
      } else {
        await this.storage.clear();
      }
      return true;
    } catch {
      return false;
    }
  }

  private runStorageRead<T>(operation: () => Promise<T>): Promise<T> {
    const precedingMutations = this.storageMutationTail;
    return precedingMutations.then(operation, operation);
  }

  private runStorageMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.storageMutationTail.then(operation, operation);
    this.storageMutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
