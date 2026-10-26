import { useCallback } from 'react';
import { useAppDialog } from '../../components/AppDialog';
import type { BackupOperationsPort } from './application/backupOperationsPort';
import type { BackupStoragePort } from './application/backupStoragePort';
import { BackupSettingsView } from './BackupSettingsView';
import { useBackupSettingsPresenter } from './useBackupSettingsPresenter';

const IMPORT_CONFIRMATION = '导入备份会覆盖当前的设置、凭据、收藏与观看历史，并关闭播放、详情和搜索窗口。确定继续？';

export function BackupSettingsSection({ backup, storage }: { backup: BackupOperationsPort; storage: BackupStoragePort }) {
  const dialog = useAppDialog();
  const confirmImport = useCallback(
    () => dialog.confirm(IMPORT_CONFIRMATION, { title: '导入设置备份', confirmLabel: '继续导入', tone: 'danger' }),
    [dialog],
  );
  const { model, actions } = useBackupSettingsPresenter({ backup, storage, confirmImport });
  return <BackupSettingsView model={model} onExport={actions.onExport} onImport={actions.onImport} />;
}
