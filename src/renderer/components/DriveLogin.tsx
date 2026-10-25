// 网盘绑定只保留网页登录，由主进程抓取完整凭据并落盘。
import { driveProviderLabel, WEB_LOGIN_PROVIDERS } from '../../shared/driveProvider';
import type { DriveWebLoginPort } from '../features/driveBinding/application/driveBindingPorts';
import { useDriveWebLogin } from '../features/driveBinding/useDriveWebLogin';

interface Props {
  provider: string;
  onBound: (savedProvider: string) => void;
  port: DriveWebLoginPort;
}

export default function DriveLogin({ provider, onBound, port }: Props) {
  const { model, actions } = useDriveWebLogin(port);
  const label = driveProviderLabel(provider);
  const viaWeb = WEB_LOGIN_PROVIDERS.includes(provider);

  return (
    <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
      {viaWeb ? (
        <button className="primary" disabled={model.busy} onClick={() => void actions.login(provider, onBound)}
          title={`${label}：打开网页登录页，扫码后自动保存完整凭据`}>
          {model.busy ? '登录中…' : '🌐 网页扫码登录'}
        </button>
      ) : (
        <span className="muted" style={{ fontSize: 12 }}>该网盘暂不支持网页扫码，请手动粘贴凭据</span>
      )}
      {model.message && <output className="muted" style={{ fontSize: 12 }}>{model.message}</output>}
    </div>
  );
}
