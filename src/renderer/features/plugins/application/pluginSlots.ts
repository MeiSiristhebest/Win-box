import type { UiSlotId, UiSlotView } from '../../../../shared/plugin';
import type { UiSlotItemView } from '../../../../shared/plugin';

export interface PluginSlotPort {
  load(slot: UiSlotId): Promise<UiSlotView[]>;
  runAction(item: UiSlotItemView): Promise<void>;
}
