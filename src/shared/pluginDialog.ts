export interface PluginDialogRequest {
  id: string;
  pluginId: string;
  op: 'alert' | 'confirm';
  message: string;
  title?: string;
}

export interface PluginDialogReply { id: string; accepted: boolean }
