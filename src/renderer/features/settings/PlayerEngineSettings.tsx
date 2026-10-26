import { useAppDialog } from '../../components/AppDialog';
import type { PlayerEngineView } from '../../../shared/plugin';
import type { PlayerEngineSettingsEventsPort } from './application/settingsSectionPorts';
import type { PlayerEngineActivationPort, PlayerEngineCatalogPort, PlayerEnginePathSettingsPort } from './application/playerEngineSettingsPorts';
import { PlayerEngineSettingsView } from './PlayerEngineSettingsView';
import { usePlayerEngineSettingsPresenter } from './usePlayerEngineSettingsPresenter';

export function PlayerEngineSettings({ active, catalog, activation, pathSettings, events }: {
  active: boolean;
  catalog: PlayerEngineCatalogPort;
  activation: PlayerEngineActivationPort;
  pathSettings: PlayerEnginePathSettingsPort;
  events: PlayerEngineSettingsEventsPort;
}) {
  const dialog = useAppDialog();
  const presenter = usePlayerEngineSettingsPresenter({
    active,
    catalog,
    activation,
    pathSettings,
    events,
    confirmEnable: (item: PlayerEngineView) => dialog.confirm(
      '启用插件播放内核「' + item.label + '」后，应用会运行该内核提供的本机程序' + (item.path ? '（' + item.path + '）' : '') + '。继续吗？',
      { title: '启用插件播放内核', confirmLabel: '启用' },
    ),
  });
  if (!active) return null;
  return (
    <PlayerEngineSettingsView
      model={presenter.model}
      onToggle={(item, enabled) => { void presenter.toggle(item, enabled); }}
      onPathChange={presenter.changePath}
      onSavePath={(item) => { void presenter.savePath(item); }}
    />
  );
}
