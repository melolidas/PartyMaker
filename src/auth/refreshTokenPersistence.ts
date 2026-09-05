import type { RefreshTokenStorage } from '../api/types';

export type DurableStringStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  deleteItem: (key: string) => Promise<void>;
};

type RefreshTokenStorageKeys = { token: string; invalidated: string };
type OperationRecord = { version: 1; id: string; barrier: string | null; state: 'pending' };
type LocalWrite = { record: OperationRecord; cancelled: boolean; settled: boolean };

// Non-secret identifiers must not be reused by a new runtime while an old
// operation-specific terminal record could still be written.
let sequence = 0;
function operationId(): string {
  sequence += 1;
  return `${Date.now().toString(36)}-${sequence.toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function parseObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function parseOperation(value: string | null): OperationRecord | null {
  const record = parseObject(value);
  return record?.version === 1
    && record.state === 'pending'
    && typeof record.id === 'string'
    && /^[a-z0-9-]+$/.test(record.id)
    && (record.barrier === null || typeof record.barrier === 'string')
    ? record as OperationRecord
    : null;
}

function storageError(): Error {
  return new Error('Refresh token persistence requires reconciliation');
}

export function createFailClosedRefreshTokenStorage(
  storage: DurableStringStorage,
  keys: RefreshTokenStorageKeys,
): RefreshTokenStorage {
  const headKey = `${keys.token}.operation`;
  const terminalKey = (id: string) => `${headKey}.${id}.result`;
  const revokedKey = (id: string) => `${headKey}.${id}.revoked`;
  let activeWrite: LocalWrite | null = null;
  let quarantined = false;

  async function terminal(record: OperationRecord): Promise<string | null> {
    const result = parseObject(await storage.getItem(terminalKey(record.id)));
    return result?.version === 1 && result.id === record.id
      && (result.state === 'committed' || result.state === 'aborted')
      ? result.state
      : null;
  }

  async function assertWritable(): Promise<void> {
    if (quarantined || activeWrite) throw storageError();
    const rawHead = await storage.getItem(headKey);
    if (rawHead !== null) {
      const head = parseOperation(rawHead);
      // Missing/unknown terminal is durable evidence of an unresolved writer.
      // A new wrapper never grants permission to replace it.
      if (!head || await terminal(head) === null) throw storageError();
    }
    if (quarantined || activeWrite || await storage.getItem(headKey) !== rawHead) {
      throw storageError();
    }
  }

  async function assertWriteOwned(write: LocalWrite): Promise<void> {
    if (write.cancelled || quarantined) throw storageError();
    const head = parseOperation(await storage.getItem(headKey));
    const barrier = await storage.getItem(keys.invalidated);
    const revoked = await storage.getItem(revokedKey(write.record.id));
    if (write.cancelled || quarantined
      || revoked !== null || head?.id !== write.record.id || barrier !== write.record.barrier) {
      throw storageError();
    }
  }

  async function revoke(): Promise<boolean> {
    try {
      // Writers never delete or overwrite this barrier. Only invalidation does.
      await storage.setItem(keys.invalidated, operationId());
      return true;
    } catch {
      return false;
    }
  }

  async function removeToken(): Promise<boolean> {
    try {
      await storage.deleteItem(keys.token);
      return true;
    } catch {
      return false;
    }
  }

  async function clear(): Promise<void> {
    const write = activeWrite;
    if (write) write.cancelled = true;
    if (write?.settled) {
      const head = parseOperation(await storage.getItem(headKey));
      if (head && head.id !== write.record.id) {
        // Another runtime has already reconciled/replaced this operation.
        // Its credentials and revocation barrier are not ours to mutate, and
        // leaving them untouched must not be reported as a confirmed logout.
        throw storageError();
      }
    }
    // No read precedes invalidation: a hanging get cannot hold up logout.
    const barrierConfirmed = await revoke();
    await removeToken();
    // Deletion alone cannot revoke a writer owned by another runtime. Its
    // delayed token/commit may still arrive after this wrapper has returned.
    if (!barrierConfirmed || (write && !write.settled)) {
      throw storageError();
    }

    if (write) {
      const head = parseOperation(await storage.getItem(headKey));
      if (head?.id === write.record.id) {
        // All original sub-writes have settled. This is the LAST mutation:
        // a restarted writer may now reconcile the aborted operation.
        await storage.setItem(terminalKey(write.record.id), JSON.stringify({
          version: 1, id: write.record.id, state: 'aborted',
        }));
      }
      if (activeWrite === write) activeWrite = null;
    }
    quarantined = false;
  }

  return {
    async get() {
      if (quarantined) throw storageError();
      const rawHead = await storage.getItem(headKey);
      if (rawHead === null) return null; // Legacy tokens alone are not proof.
      const head = parseOperation(rawHead);
      if (!head) throw storageError();
      const state = await terminal(head);
      if (state === null) throw storageError();
      if (state === 'aborted') return null;
      if (await storage.getItem(revokedKey(head.id)) !== null) return null;

      const barrier = await storage.getItem(keys.invalidated);
      if (barrier !== head.barrier) return null;
      const token = parseObject(await storage.getItem(keys.token));
      if (quarantined
        || await storage.getItem(headKey) !== rawHead
        || await storage.getItem(keys.invalidated) !== barrier
        || await storage.getItem(revokedKey(head.id)) !== null
        || await terminal(head) !== 'committed') throw storageError();
      return token?.version === 1 && token.operationId === head.id
        && typeof token.refreshToken === 'string' && token.refreshToken.length > 0
        ? token.refreshToken
        : null;
    },

    async set(refreshToken) {
      await assertWritable();
      const record: OperationRecord = {
        version: 1, id: operationId(), state: 'pending',
        barrier: await storage.getItem(keys.invalidated),
      };
      if (quarantined || activeWrite) throw storageError();
      const write: LocalWrite = { record, cancelled: false, settled: false };
      activeWrite = write;
      try {
        // Write-ahead: no token write until the pending record is acknowledged.
        await storage.setItem(headKey, JSON.stringify(record));
        await assertWriteOwned(write);
        await storage.setItem(keys.token, JSON.stringify({
          version: 1, operationId: record.id, refreshToken,
        }));
        await assertWriteOwned(write);
        // Publication is operation-specific; it cannot overwrite a revocation.
        await storage.setItem(terminalKey(record.id), JSON.stringify({
          version: 1, id: record.id, state: 'committed',
        }));
        await assertWriteOwned(write);
        activeWrite = null;
      } finally {
        write.settled = true;
      }
    },

    clear,
    assertReadyForNewSession: assertWritable,

    async quarantinePendingWrite() {
      // Cancellation is synchronous, before any possibly hanging I/O.
      quarantined = true;
      if (activeWrite) {
        activeWrite.cancelled = true;
        // Append-only, operation-specific tombstone. Even a late quarantine
        // acknowledgement cannot replace a newer operation's revocation.
        await storage.setItem(revokedKey(activeWrite.record.id), '1');
      } else if (!await revoke()) {
        throw storageError();
      }
    },

    async resolvePendingWrite() {
      if (activeWrite && !activeWrite.settled) throw storageError();
      await clear();
    },
  };
}
