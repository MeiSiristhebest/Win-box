import { useCallback } from 'react';
import type { KeymapView } from '../../../shared/plugin';
import { useAppDialog } from '../../components/AppDialog';
import { usePluginCommandRunner } from '../plugins/PluginCommandContext';
import { usePluginKeymaps } from '../plugins/usePluginKeymaps';

/** Owns player-scoped plugin shortcuts, confirmation, and command feedback. */
export function usePlayerPluginCommands(notify: (message: string) => void) {
  const dialog = useAppDialog();
  const runPluginCommand = usePluginCommandRunner();

  const runCommand = useCallback(async (command: KeymapView) => {
    try {
      const result = await runPluginCommand(
        command,
        (message) => dialog.confirm(message, { title: command.label }),
      );
      notify(result.message);
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    }
  }, [dialog, notify, runPluginCommand]);

  const pluginKeys = usePluginKeymaps('player', runCommand);
  return { pluginKeys };
}
