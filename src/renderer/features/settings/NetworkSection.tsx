import type { NetworkSettingsPort } from './application/settingsSectionPorts';
import { NetworkSettingsView } from './NetworkSettingsView';
import { useNetworkSettingsPresenter } from './useNetworkSettingsPresenter';

export function NetworkSection({ active, port }: { active: boolean; port: NetworkSettingsPort }) {
  const { model, actions } = useNetworkSettingsPresenter(active, port);

  if (!active) return null;
  return <NetworkSettingsView model={model} actions={actions} />;
}
