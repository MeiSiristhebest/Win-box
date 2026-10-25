import type { PluginDialogPort } from '../application/pluginDialogPort';

type PluginDialogApi = Pick<Window['api']['plugins'], 'dialogReady' | 'replyDialog' | 'onDialog' | 'onDialogCancel'>;

export function createPluginDialogAdapter(getApi: () => PluginDialogApi | undefined): PluginDialogPort {
  return {
    connect(onRequest, onCancel) {
      const api = getApi();
      if (!api) return null;

      const unsubscribeRequest = api.onDialog(onRequest);
      const unsubscribeCancel = api.onDialogCancel(onCancel);
      api.dialogReady();

      return () => {
        unsubscribeRequest();
        unsubscribeCancel();
      };
    },
    reply(reply) {
      getApi()?.replyDialog(reply);
    },
  };
}

export const pluginDialogAdapter = createPluginDialogAdapter(() => window.api?.plugins);
