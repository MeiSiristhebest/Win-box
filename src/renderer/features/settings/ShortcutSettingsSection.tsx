import { PluginKeymapList } from './PluginKeymapList';
import type { PluginKeymapListPort, ShortcutSettingsPort } from './application/settingsSectionPorts';
import { ShortcutSettingsView } from './ShortcutSettingsView';
import { useShortcutSettingsPresenter } from './useShortcutSettingsPresenter';

export function ShortcutSettingsSection({ active, port, keymaps }: { active: boolean; port: ShortcutSettingsPort; keymaps: PluginKeymapListPort }) {
  const { model, actions } = useShortcutSettingsPresenter(active, port);

  if (!active) return null;

  return (
    <>
      <PluginKeymapList active={active} port={keymaps} />
      <ShortcutSettingsView model={model} actions={actions} />
    </>
  );
}
