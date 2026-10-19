import { useCallback, useEffect, useState } from 'react';
import type { PluginDialogRequest } from '../../../shared/pluginDialog';
import { useAppDialog } from '../../components/AppDialog';

function PluginDialog({ request, finish }: { request: PluginDialogRequest; finish(id: string, accepted: boolean): void }) {
  const dialog = useAppDialog();
  useEffect(() => {
    let alive = true;
    const title = `${request.pluginId} · ${request.title || '插件提示'}`;
    const answer = request.op === 'confirm'
      ? dialog.confirm(request.message, { title })
      : dialog.alert(request.message, { title }).then(() => false);
    void answer.then(accepted => { if (alive) finish(request.id, accepted); });
    return () => { alive = false; };
  }, [dialog, request, finish]);
  return null;
}

export function PluginDialogBridge() {
  const [requests, setRequests] = useState<PluginDialogRequest[]>([]);
  const finish = useCallback((id: string, accepted: boolean) => {
    window.api?.plugins?.replyDialog?.({ id, accepted });
    setRequests(items => items.filter(item => item.id !== id));
  }, []);
  useEffect(() => {
    const api = window.api?.plugins;
    if (!api?.onDialog || !api.onDialogCancel || !api.dialogReady) return;
    const off = api.onDialog(request => setRequests(items => items.some(item => item.id === request.id) ? items : [...items, request]));
    const offCancel = api.onDialogCancel(id => setRequests(items => items.filter(item => item.id !== id)));
    api.dialogReady();
    return () => { off(); offCancel(); };
  }, []);
  return <>{requests.map(request => <PluginDialog key={request.id} request={request} finish={finish} />)}</>;
}
