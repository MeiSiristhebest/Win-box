import type { PluginDialogReply, PluginDialogRequest } from '../../../../shared/pluginDialog';

export interface PluginDialogPort {
  connect(
    onRequest: (request: PluginDialogRequest) => void,
    onCancel: (id: string) => void,
  ): (() => void) | null;
  reply(reply: PluginDialogReply): void;
}
