import type { PlayerEngineSettingsEventsPort } from '../application/settingsSectionPorts';

export const browserPlayerEngineSettingsEventsAdapter: PlayerEngineSettingsEventsPort = {
  notifyChanged: () => window.dispatchEvent(new Event('winbox:engines-changed')),
};
