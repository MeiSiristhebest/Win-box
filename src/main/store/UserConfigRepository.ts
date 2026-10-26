import type { UserConfig } from '../../shared/types';

/** Runtime-impact category emitted after a durable configuration commit. */
export type ConfigChangeKind = 'content' | 'ui';

export interface ConfigRuntimeSyncFailure {
  name: string;
  message: string;
}

/** A durable commit is successful even when its derived runtime projection needs retrying. */
export type ConfigCommitResult =
  | { status: 'committed'; revision: number; runtimeSync: 'synchronized' | 'not-configured' | 'pending' }
  | { status: 'committed-runtime-sync-failed'; revision: number; error: ConfigRuntimeSyncFailure };

export type RuntimeSyncRetryResult =
  | { status: 'synchronized'; revision: number }
  | { status: 'runtime-sync-failed'; revision: number; error: ConfigRuntimeSyncFailure }
  | { status: 'not-pending'; revision: number }
  | { status: 'not-configured'; revision: number };

/** Persistence boundary for the authoritative user-configuration snapshot. */
export interface UserConfigPersistencePort {
  getObject<T>(key: string, fallback: T): T;
  setObject<T>(key: string, value: T): void;
  flushStrict(): void;
}

export const USER_CONFIG_KEY = 'user-config';

/** Owns the in-memory snapshot and its atomic persistence lifecycle. */
export class UserConfigRepository {
  private state: UserConfig;
  private loaded = false;
  private revisionValue = 0;
  private onChange: ((snapshot: UserConfig, kind: ConfigChangeKind) => void) | null = null;
  private pendingRuntimeSync: { revision: number; snapshot: UserConfig; kind: ConfigChangeKind; error: ConfigRuntimeSyncFailure } | null = null;

  constructor(
    private readonly persistence: UserConfigPersistencePort,
    private readonly initialState: UserConfig,
  ) {
    this.state = structuredClone(initialState);
  }

  /** Internal aggregate view. Callers outside the application layer receive clones through snapshot(). */
  get current(): UserConfig {
    return this.state;
  }

  get hasPersisted(): boolean {
    return this.loaded;
  }

  get revision(): number {
    return this.revisionValue;
  }

  get pendingRuntimeSyncRevision(): number | null {
    return this.pendingRuntimeSync?.revision ?? null;
  }

  setOnChange(callback: ((snapshot: UserConfig, kind: ConfigChangeKind) => void) | null): void {
    this.onChange = callback;
  }

  snapshot(): UserConfig {
    return structuredClone(this.state);
  }

  load(normalize: (raw: UserConfig) => UserConfig): boolean {
    this.pendingRuntimeSync = null;
    const raw = this.persistence.getObject<UserConfig | null>(USER_CONFIG_KEY, null);
    if (!raw) {
      this.state = structuredClone(this.initialState);
      this.loaded = false;
      this.revisionValue++;
      return false;
    }

    this.state = normalize(raw);
    this.loaded = true;
    this.revisionValue++;
    return true;
  }

  /** Commit a prepared aggregate; only durable write failures roll back the commit. */
  commit(next: UserConfig, kind: ConfigChangeKind): ConfigCommitResult {
    const previous = this.state;
    const previousLoaded = this.loaded;
    const previousRevision = this.revisionValue;
    this.state = next;
    this.loaded = true;

    try {
      this.persist();
    } catch (error) {
      this.state = previous;
      this.loaded = previousLoaded;
      this.revisionValue = previousRevision;
      try {
        this.persistence.setObject(USER_CONFIG_KEY, previous);
        this.persistence.flushStrict();
      } catch {
        // Atomic file replacement preserves the last committed snapshot if recovery also fails.
      }
      throw error;
    }

    this.revisionValue++;
    const revision = this.revisionValue;
    const snapshot = this.snapshot();
    const pending = this.pendingRuntimeSync;
    const retryKind = pending?.kind === 'content' || kind === 'content' ? 'content' : 'ui';

    if (!this.onChange) {
      if (pending) this.pendingRuntimeSync = { ...pending, revision, snapshot, kind: retryKind };
      return { status: 'committed', revision, runtimeSync: pending ? 'pending' : 'not-configured' };
    }

    try {
      this.onChange(snapshot, kind);
      if (kind === 'content' || !pending || pending.kind === 'ui') {
        this.pendingRuntimeSync = null;
      } else {
        // An UI-only notification cannot repair a failed content projection. Keep
        // the newest full snapshot so retry does not restore stale UI selection.
        this.pendingRuntimeSync = { ...pending, revision, snapshot };
      }
      return { status: 'committed', revision, runtimeSync: this.pendingRuntimeSync ? 'pending' : 'synchronized' };
    } catch (error) {
      const failure = describeRuntimeSyncFailure(error);
      this.pendingRuntimeSync = { revision, snapshot, kind: retryKind, error: failure };
      return { status: 'committed-runtime-sync-failed', revision, error: failure };
    }
  }

  /** Retry only the derived runtime projection; never writes user-config or advances revision. */
  retryRuntimeSync(): RuntimeSyncRetryResult {
    const pending = this.pendingRuntimeSync;
    if (!pending) return { status: 'not-pending', revision: this.revisionValue };
    if (!this.onChange) return { status: 'not-configured', revision: pending.revision };

    try {
      this.onChange(structuredClone(pending.snapshot), pending.kind);
      if (this.pendingRuntimeSync === pending) this.pendingRuntimeSync = null;
      return { status: 'synchronized', revision: pending.revision };
    } catch (error) {
      const failure = describeRuntimeSyncFailure(error);
      this.pendingRuntimeSync = { ...pending, error: failure };
      return { status: 'runtime-sync-failed', revision: pending.revision, error: failure };
    }
  }

  private persist(): void {
    this.persistence.setObject(USER_CONFIG_KEY, this.state);
    this.persistence.flushStrict();
  }
}

function describeRuntimeSyncFailure(error: unknown): ConfigRuntimeSyncFailure {
  if (error instanceof Error) return { name: error.name || 'Error', message: error.message };
  return { name: 'Error', message: String(error) };
}
