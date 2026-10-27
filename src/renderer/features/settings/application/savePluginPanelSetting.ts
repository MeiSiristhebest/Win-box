import type { SettingsPanelView } from '../../../../shared/plugin';
import type { PluginPanelSettingsSaveResult } from './settingsSectionPorts';

export interface PluginPanelSettingsSaveGateway {
  save(input: { id: string; panelId: string; key: string; value: unknown }): Promise<{
    ok: boolean;
    reason?: string;
    panels?: SettingsPanelView[];
  }>;
  loadPanels(): Promise<SettingsPanelView[]>;
}

/** A successful save always returns the latest presentation snapshot to its caller. */
export async function savePluginPanelSetting(
  gateway: PluginPanelSettingsSaveGateway,
  input: { id: string; panelId: string; key: string; value: unknown },
): Promise<PluginPanelSettingsSaveResult> {
  const result = await gateway.save(input);
  if (!result.ok) return { ok: false, reason: result.reason };
  if (result.panels) return { ok: true, panels: result.panels };
  try {
    return { ok: true, panels: await gateway.loadPanels() };
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message : String(error);
    return { ok: true, refreshError: reason };
  }
}
