import type { UserConfig } from '../../shared/types';

/** Runtime-impact category emitted after a durable configuration commit. */
export type ConfigChangeKind = 'content' | 'ui';

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

  setOnChange(callback: ((snapshot: UserConfig, kind: ConfigChangeKind) => void) | null): void {
    this.onChange = callback;
  }

  snapshot(): UserConfig {
    return structuredClone(this.state);
  }

  load(normalize: (raw: UserConfig) => UserConfig): boolean {
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

  /** Commit a prepared aggregate; failed writes restore memory and attempt to restore the durable snapshot. */
  commit(next: UserConfig, kind: ConfigChangeKind): void {
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
    this.onChange?.(this.snapshot(), kind);
  }

  private persist(): void {
    this.persistence.setObject(USER_CONFIG_KEY, this.state);
    this.persistence.flushStrict();
  }
}
