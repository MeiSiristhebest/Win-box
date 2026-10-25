import { useMemo, type ReactNode } from 'react';
import { isDetailWinHash } from '../../shared/detailWin';
import { isSearchWinHash } from '../../shared/searchWin';
import { createUpdateGateAdapter } from '../features/updates/adapters/updateGateAdapter';
import { useUpdateGatePresenter } from '../features/updates/useUpdateGatePresenter';
import { UpdateGateView } from './UpdateGateView';

/** Update prompts are coordinated in the primary application window only. */
export default function UpdateGate({ children }: { children: ReactNode }) {
  const hash = window.location.hash;
  const skip = hash.startsWith('#/player') || isDetailWinHash(hash) || isSearchWinHash(hash);
  const port = useMemo(() => createUpdateGateAdapter(), []);
  const presenter = useUpdateGatePresenter(skip, port);

  return (
    <UpdateGateView
      {...presenter}
      onDismiss={presenter.dismiss}
      onCancel={presenter.cancelDownload}
      onDownload={() => { void presenter.downloadAndInstall(); }}
      onOpenBackupDownload={presenter.openBackupDownload}
    >
      {children}
    </UpdateGateView>
  );
}
