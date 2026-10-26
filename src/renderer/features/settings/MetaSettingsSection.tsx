import type { MetaSettingsEventsPort } from './application/metaSettingsEventsPort';
import type { MetaSettingsPort } from './application/metaSettingsPort';
import { MetaSettingsView } from './MetaSettingsView';
import { useMetaSettingsPresenter } from './useMetaSettingsPresenter';

export function MetaSettingsSection({ port, events }: { port: MetaSettingsPort; events: MetaSettingsEventsPort }) {
  const presenter = useMetaSettingsPresenter(port, events.notifyChanged);
  return <MetaSettingsView model={presenter.model} onChange={presenter.change} onSave={() => { void presenter.save(); }} />;
}
