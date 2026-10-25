import { useCallback, useEffect, useState } from 'react';
import type { NetworkSettingsPort } from './application/settingsSectionPorts';
import type { NetworkSettingsViewModel } from './networkSettingsViewModel';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useNetworkSettingsPresenter(active: boolean, port: NetworkSettingsPort) {
  const [loadState, setLoadState] = useState<NetworkSettingsViewModel['loadState']>('loading');
  const [proxy, setProxy] = useState<{ enabled: boolean; url: string } | null>(null);
  const [urlDraft, setUrlDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<NetworkSettingsViewModel['message']>(null);
  const [loadRevision, setLoadRevision] = useState(0);

  useEffect(() => {
    if (!active) return;
    let current = true;
    setLoadState('loading');
    setMessage(null);
    void port.loadProxy().then((settings) => {
      if (!current) return;
      setProxy(settings);
      setUrlDraft(settings.url);
      setLoadState('ready');
    }).catch((error: unknown) => {
      if (!current) return;
      setProxy(null);
      setLoadState('error');
      setMessage({ text: `代理设置读取失败：${errorMessage(error)}`, kind: 'err' });
    });
    return () => { current = false; };
  }, [active, loadRevision, port]);

  const setEnabled = useCallback((enabled: boolean) => {
    setProxy((current) => current ? { ...current, enabled } : current);
    setMessage(null);
  }, []);

  const setUrl = useCallback((url: string) => {
    setUrlDraft(url);
    setMessage(null);
  }, []);

  const save = useCallback(async () => {
    if (!proxy || loadState !== 'ready' || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const next = await port.saveProxy({ enabled: proxy.enabled, url: urlDraft.trim() });
      setProxy(next);
      setUrlDraft(next.url);
      const invalidAddress = urlDraft.trim().length > 0 && next.url.length === 0;
      setMessage(invalidAddress
        ? { text: '代理地址无法解析（应形如 http://127.0.0.1:7890）', kind: 'err' }
        : { text: next.enabled && next.url ? '已启用，立即生效（本机地址不走代理）' : '已保存（当前未启用）', kind: 'ok' });
    } catch (error) {
      setMessage({ text: `保存失败：${errorMessage(error)}`, kind: 'err' });
    } finally {
      setSaving(false);
    }
  }, [loadState, port, proxy, saving, urlDraft]);

  const retryLoad = useCallback(() => setLoadRevision((revision) => revision + 1), []);

  return {
    model: {
      loadState,
      enabled: proxy?.enabled ?? false,
      url: urlDraft,
      saving,
      message,
    } satisfies NetworkSettingsViewModel,
    actions: { setEnabled, setUrl, save, retryLoad },
  };
}
