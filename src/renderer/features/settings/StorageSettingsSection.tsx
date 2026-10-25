import type { StorageSettingsPort } from './application/settingsSectionPorts';
import { StorageSettingsView } from './StorageSettingsView';
import { useStorageSettingsPresenter } from './useStorageSettingsPresenter';

type ConfirmStorageRemoval = (message: string, options: { title: string; confirmLabel: string; tone: 'danger' }) => Promise<boolean>;

interface StorageSettingsSectionProps {
  active: boolean;
  port: StorageSettingsPort;
  confirmRemoval: ConfirmStorageRemoval;
}

export function StorageSettingsSection({ active, port, confirmRemoval }: StorageSettingsSectionProps) {
  const { model, actions } = useStorageSettingsPresenter(active, port, confirmRemoval);
  if (!active) return null;
  return <StorageSettingsView model={model} actions={actions} />;
}
