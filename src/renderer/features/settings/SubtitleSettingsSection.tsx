import type { SubtitleSettingsPort } from './application/subtitleSettingsPort';
import { SubtitleSettingsView } from './SubtitleSettingsView';
import { useSubtitleSettingsPresenter } from './useSubtitleSettingsPresenter';

export function SubtitleSettingsSection({ port }: { port: SubtitleSettingsPort }) {
  const presenter = useSubtitleSettingsPresenter(port);
  return (
    <SubtitleSettingsView
      model={presenter.model}
      onTokenChange={presenter.changeToken}
      onSaveToken={() => { void presenter.saveToken(); }}
      onToggleProvider={(providerId) => { void presenter.toggleProvider(providerId); }}
    />
  );
}
