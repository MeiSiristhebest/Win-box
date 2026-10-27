import type { PluginKeymapListPort } from './application/settingsSectionPorts';
import { PluginKeymapListView } from './PluginKeymapListView';
import { usePluginKeymapListPresenter } from './usePluginKeymapListPresenter';

export function PluginKeymapList({ active, port }: { active: boolean; port: PluginKeymapListPort }) {
  const presenter = usePluginKeymapListPresenter(active, port);
  if (!active) return null;
  return <PluginKeymapListView model={presenter.model} onRetry={() => void presenter.reload()} />;
}
