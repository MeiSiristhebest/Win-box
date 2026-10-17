import { useEffect, useState } from 'react';
import { client } from '../../api/client';

export function NetworkSection({ active }: { active: boolean }) {
  const [proxy, setProxy] = useState<{ enabled: boolean; url: string } | null>(null);
  const [proxyUrlDraft, setProxyUrlDraft] = useState('');
  const [proxyMsg, setProxyMsg] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);

  useEffect(() => {
    client.proxyGet().then((settings) => {
      setProxy(settings);
      setProxyUrlDraft(settings.url);
    }).catch(() => setProxy({ enabled: false, url: '' }));
  }, []);

  async function saveProxy() {
    try {
      const next = await client.proxySet({ enabled: proxy?.enabled ?? false, url: proxyUrlDraft.trim() });
      setProxy(next);
      setProxyUrlDraft(next.url);
      const invalidAddress = proxyUrlDraft.trim() && !next.url;
      setProxyMsg(
        invalidAddress
          ? { text: '代理地址无法解析（应形如 http://127.0.0.1:7890）', kind: 'err' }
          : { text: next.enabled && next.url ? '已启用，立即生效（本机地址不走代理）' : '已保存（当前未启用）', kind: 'ok' },
      );
    } catch (error) {
      setProxyMsg({ text: `保存失败：${(error as Error).message}`, kind: 'err' });
    }
  }

  if (!active) return null;

  return (
    <div className="card" style={{ padding: 12, marginBottom: 16 }}>
      {proxy ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="row" style={{ alignItems: 'center', gap: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={proxy.enabled}
                onChange={(event) => setProxy((current) => current ? { ...current, enabled: event.target.checked } : current)}
              />
              <span style={{ fontWeight: 600 }}>启用网络代理</span>
            </label>
            <span className="muted" style={{ fontSize: 11 }}>
              当前：{proxy.enabled && proxy.url ? proxy.url : '未启用（直连）'}
            </span>
          </div>
          <div className="row" style={{ alignItems: 'center', gap: 8 }}>
            <span className="muted" style={{ fontSize: 11, flex: 'none' }}>代理地址：</span>
            <input
              style={{ width: 300, fontFamily: 'monospace' }}
              placeholder="http://127.0.0.1:7890"
              value={proxyUrlDraft}
              onChange={(event) => setProxyUrlDraft(event.target.value)}
            />
            <span className="muted" style={{ fontSize: 11 }}>http 代理（Clash / V2Ray 等本机代理常见为 7890）</span>
          </div>
          <div className="row" style={{ alignItems: 'center', gap: 10 }}>
            <button className="primary" onClick={() => void saveProxy()}>保存代理</button>
            {proxyMsg && (
              <span className={proxyMsg.kind === 'err' ? 'err' : 'status'} style={{ margin: 0 }}>
                {proxyMsg.text}
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="empty"><span className="spinner" aria-hidden="true" />加载中…</div>
      )}
    </div>
  );
}
