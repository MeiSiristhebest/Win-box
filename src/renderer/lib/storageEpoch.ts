export const STORAGE_EPOCH_KEY = 'winbox:storage-epoch';

function readEpoch(): string {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  if (!Object.hasOwn(globalThis, 'window') && descriptor && !('value' in descriptor)) return '';
  try { return globalThis.localStorage?.getItem(STORAGE_EPOCH_KEY) ?? ''; } catch { return ''; }
}

const initialEpoch = readEpoch();
let restoring = false;

/** Old windows must not merge their memory into a restored snapshot. */
export function canWriteRendererStorage(): boolean {
  return !restoring && readEpoch() === initialEpoch;
}

/** Synchronous replacement: no unload handler or storage callback can interleave these writes. */
export function prepareRendererBackupRestore(values: Record<string, string>): { rollback(): void } {
  const storage = globalThis.localStorage;
  if (!storage) throw new Error('浏览器存储不可用，备份尚未还原');
  const before = Object.fromEntries(Array.from({ length: storage.length }, (_, index) => {
    const key = storage.key(index)!;
    return [key, storage.getItem(key)!];
  }));
  const replace = (next: Record<string, string>) => {
    storage.setItem(STORAGE_EPOCH_KEY, globalThis.crypto.randomUUID());
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)!);
    for (const key of keys) if (key !== STORAGE_EPOCH_KEY) storage.removeItem(key);
    for (const [key, value] of Object.entries(next)) if (key !== STORAGE_EPOCH_KEY) storage.setItem(key, value);
    if (Object.hasOwn(next, STORAGE_EPOCH_KEY)) storage.setItem(STORAGE_EPOCH_KEY, next[STORAGE_EPOCH_KEY]);
    else storage.removeItem(STORAGE_EPOCH_KEY);
  };
  restoring = true;
  try {
    replace({ ...values, [STORAGE_EPOCH_KEY]: globalThis.crypto.randomUUID() });
  } catch (error) {
    try { replace(before); } finally { restoring = false; }
    throw error;
  }
  return { rollback() { try { replace(before); } finally { restoring = false; } } };
}
