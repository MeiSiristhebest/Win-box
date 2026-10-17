// 网盘绑定只保留网页登录，由主进程抓取完整凭据并落盘。
import { useState } from 'react';
import { client } from '../api/client';
import { driveProviderLabel, WEB_LOGIN_PROVIDERS } from '../../shared/driveProvider';

interface Props {
  provider: string;
  onBound: (savedProvider: string) => void;
}

export default function DriveLogin({ provider, onBound }: Props) {
  const [webBusy, setWebBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const label = driveProviderLabel(provider);
  const viaWeb = WEB_LOGIN_PROVIDERS.includes(provider);

  async function doWebLogin(): Promise<void> {
    setMsg('');
    setWebBusy(true);
    try {
      await client.driveWebLogin(provider);
      onBound(provider);
      setMsg(`✓ 已通过网页扫码保存「${label}」绑定`);
    } catch (e) {
      setMsg(`登录失败：${(e as Error).message}`);
    } finally {
      setWebBusy(false);
    }
  }

  return (
    <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
      {viaWeb ? (
        <button className="primary" disabled={webBusy} onClick={() => void doWebLogin()}
          title={`${label}：打开网页登录页，扫码后自动保存完整凭据`}>
          {webBusy ? '登录中…' : '🌐 网页扫码登录'}
        </button>
      ) : (
        <span className="muted" style={{ fontSize: 11 }}>该网盘暂不支持网页扫码，请手动粘贴凭据</span>
      )}
      {msg && <output className="muted" style={{ fontSize: 11 }}>{msg}</output>}
    </div>
  );
}
