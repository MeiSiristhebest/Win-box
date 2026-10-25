import type { KeymapView } from '../../../../shared/plugin';

export interface PluginKeymapPort {
  loadKeymaps(): Promise<KeymapView[]>;
}
