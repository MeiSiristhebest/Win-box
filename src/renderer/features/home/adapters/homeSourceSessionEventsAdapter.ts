import type { HomeSourceSessionEventsPort } from '../application/homePorts';

function stringDetail(event: Event): string | null {
  const detail = (event as CustomEvent<unknown>).detail;
  return typeof detail === 'string' ? detail : null;
}

export const homeSourceSessionEventsAdapter: HomeSourceSessionEventsPort = {
  subscribe(listener) {
    const onProfileChanged = (event: Event): void => {
      listener({ type: 'profile-changed', preferredSourceKey: stringDetail(event) ?? '' });
    };
    const onSourcesChanged = (): void => listener({ type: 'sources-changed' });
    const onSourceChanged = (event: Event): void => {
      listener({ type: 'source-changed', sourceKey: stringDetail(event) });
    };
    const onFocus = (): void => listener({ type: 'focus' });

    window.addEventListener('winbox:profile-changed', onProfileChanged);
    window.addEventListener('winbox:sources-changed', onSourcesChanged);
    window.addEventListener('winbox:source-changed', onSourceChanged);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('winbox:profile-changed', onProfileChanged);
      window.removeEventListener('winbox:sources-changed', onSourcesChanged);
      window.removeEventListener('winbox:source-changed', onSourceChanged);
      window.removeEventListener('focus', onFocus);
    };
  },
};
