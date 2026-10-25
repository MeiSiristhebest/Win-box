import type { NavigateFunction } from 'react-router-dom';
import { client } from '../../../api/client';
import { clearUiMemory, deleteWatch, loadLatestWatch, loadUiMemory, recentWatch, restoreWatch } from '../../../lib/uiMemory';
import { resolveHistorySource } from '../../../lib/historySource';
import { openDetailRoute } from '../../../lib/detailWin';
import { playVodExternal } from '../../../lib/externalPlay';
import { detectHistoryUpdates } from '../application/detectHistoryUpdates';
import { historyUpdateAdapter } from './historyUpdateAdapter';
import type { HistoryPagePorts } from '../application/historyPage';

export function createHistoryPageAdapters(navigate: NavigateFunction): Omit<HistoryPagePorts, 'confirmations' | 'playback'> & {
  playback: Omit<HistoryPagePorts['playback'], 'confirmBuiltinFallback'>;
} {
  return {
    catalog: {
      load: async () => {
        const [config, view] = await Promise.all([client.cfgGet(), client.cfgProfileSites()]);
        if (!view.profiles.some((profile) => profile.id === config.activeProfileId)) {
          view.profiles.push({ id: config.activeProfileId, name: '当前配置', sites: config.sources });
        }
        return { ...view, activeId: config.activeProfileId };
      },
      subscribe: (onChanged) => {
        window.addEventListener('winbox:sources-changed', onChanged);
        return () => window.removeEventListener('winbox:sources-changed', onChanged);
      },
    },
    storage: {
      hydrate: loadUiMemory,
      list: () => recentWatch(100),
      latest: (key) => loadLatestWatch(key) || null,
      remove: deleteWatch,
      restore: restoreWatch,
      clear: clearUiMemory,
      subscribe: (onChanged) => {
        window.addEventListener('winbox:history-refresh', onChanged);
        return () => window.removeEventListener('winbox:history-refresh', onChanged);
      },
    },
    updates: {
      detect: (candidates, alreadyChecked) => detectHistoryUpdates(candidates, alreadyChecked, historyUpdateAdapter),
    },
    playback: {
      resolveSource: (ref) => resolveHistorySource(client, ref),
      playExternally: playVodExternal,
      openBuiltinPlayer: (request) => client.playerOpen(request),
      openDetail: (source, vodId) => {
        const query = new URLSearchParams({ profileId: source.profileId }).toString();
        return openDetailRoute((to) => navigate(to), source.key, vodId, query);
      },
    },
  };
}
