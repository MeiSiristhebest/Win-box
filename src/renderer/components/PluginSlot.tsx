import { useMemo } from 'react';
import type { UiSlotId } from '../../shared/plugin';
import { createPluginSlotAdapter } from '../features/plugins/adapters/pluginSlotAdapter';
import { usePluginSlotPresenter } from '../features/plugins/usePluginSlotPresenter';
import { useAppDialog } from './AppDialog';
import PluginSlotView from './PluginSlotView';

/** Composition root for the host-controlled plugin slot. */
export default function PluginSlot({ slot }: { slot: UiSlotId }) {
  const dialog = useAppDialog();
  const port = useMemo(
    () => createPluginSlotAdapter((message, title) => dialog.confirm(message, { title })),
    [dialog],
  );
  const { views, runAction } = usePluginSlotPresenter(slot, port);
  return <PluginSlotView views={views} onAction={runAction} />;
}
