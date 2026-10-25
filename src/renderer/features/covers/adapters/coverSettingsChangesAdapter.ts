import type { CoverSettingsChangesPort } from '../application/coverLookupPort';

export const coverSettingsChangesAdapter: CoverSettingsChangesPort = {
  subscribe(listener) {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === 'winbox-meta-revision') listener();
    };
    window.addEventListener('focus', listener);
    window.addEventListener('winbox:meta-changed', listener);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('focus', listener);
      window.removeEventListener('winbox:meta-changed', listener);
      window.removeEventListener('storage', onStorage);
    };
  },
};
