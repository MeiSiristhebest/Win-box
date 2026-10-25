import { client } from '../../../api/client';
import type { UiSlotItemView } from '../../../../shared/plugin';
import { slotsFor } from '../../../lib/pluginSlots';
import { createPluginCommandRunner, type PluginActionSpec } from '../application/pluginCommand';
import { pluginCommandAdapter } from './pluginCommandAdapter';
import type { PluginSlotPort } from '../application/pluginSlots';

const runPluginCommand = createPluginCommandRunner(pluginCommandAdapter);

export function createPluginSlotAdapter(confirm: (message: string, title: string) => Promise<boolean>): PluginSlotPort {
  return {
    async load(slot) {
      const all = await client.pluginSlots();
      return slotsFor(all, slot);
    },
    async runAction(item: UiSlotItemView) {
      if (!item.action) return;
      const title = String(item.label ?? '插件动作');
      const command: PluginActionSpec = {
        label: String(item.label ?? ''),
        action: item.action,
        ...(item.url != null ? { url: item.url } : {}),
        ...(item.to != null ? { to: item.to } : {}),
        ...(item.section != null ? { section: item.section } : {}),
        ...(item.template != null ? { template: item.template } : {}),
        ...(item.theme != null ? { theme: item.theme } : {}),
        ...(item.confirm != null ? { confirm: item.confirm } : {}),
      };
      await runPluginCommand(command, (message) => confirm(message, title));
    },
  };
}

