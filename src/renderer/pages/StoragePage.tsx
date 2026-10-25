import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { storageBrowserAdapter } from '../features/storage/adapters/storageBrowserAdapter';
import { useStorageBrowserPresenter } from '../features/storage/useStorageBrowserPresenter';
import { StoragePageView } from './StoragePageView';

/** Route composition root for the WebDAV browser. */
export default function StoragePage() {
  const navigate = useNavigate();
  const presenter = useStorageBrowserPresenter(useMemo(() => storageBrowserAdapter, []));

  return (
    <StoragePageView
      servers={presenter.servers}
      serverId={presenter.serverId}
      currentServer={presenter.currentServer}
      path={presenter.path}
      entries={presenter.entries}
      busy={presenter.busy}
      error={presenter.error}
      message={presenter.message}
      playUrl={presenter.playUrl}
      breadcrumbs={presenter.breadcrumbs}
      onManage={() => navigate('/config?section=storage')}
      onSelectServer={presenter.selectServer}
      onRefresh={presenter.refresh}
      onBrowse={presenter.goToPath}
      onGoToParent={presenter.goToParent}
      onOpenEntry={(entry) => { void presenter.openEntry(entry); }}
    />
  );
}
