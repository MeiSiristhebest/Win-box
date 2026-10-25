// src/renderer/components/UcTvBind.tsx
// ★ 2026-10-14 UC TV Token（非会员 UC 原画）绑定块 —— 挂在 DriveBindModal 的「UC 网盘」页签下。
//
// 为什么单独一个：wex 族 jar（虎斑/玩偶…）的 UC 取流在 `MyPan$UcMineProvider.player()` 里按
//   `member_type` 分流；**非高会（NORMAL）走的是 `Wex_ucpan_token`**（UC 电视端开放平台 OAuth
//   的 token 对），而不是 cookie —— 只绑 cookie 时必报
//   「非高会需要配置 UC TV Token，请到配置中心扫码获取」。桌面端没有 jar 的配置中心扫码页，
//   故这里直接复刻该扫码流（主进程侧见 src/main/net/ucTvToken.ts）。
import type { UcTvTokenPort } from '../features/driveBinding/application/driveBindingPorts';
import { useUcTvTokenBinding } from '../features/driveBinding/useUcTvTokenBinding';

interface Props {
  /** 绑定成功后通知外层（DrivBindModal 会刷新已绑列表） */
  onBound: () => void;
  /** 已绑 cookie 的网盘（仅当 uc 已绑时提示价值；缺省不影响功能） */
  cookieBound?: boolean;
  port: UcTvTokenPort;
}

export default function UcTvBind({ onBound, cookieBound, port }: Props) {
  const { model, actions } = useUcTvTokenBinding({ port, onBound });
  const { bound, qr, busy, message: msg } = model;

  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line, #333)' }}>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>UC 原画 · TV Token</span>
        <span className="muted" style={{ fontSize: 12 }}>
          {bound ? '已绑定' : '未绑定（非会员云盘账号的「UC原画」线路需要它）'}
        </span>
        {bound && (
          <button className="linkbtn" style={{ marginLeft: 'auto' }} disabled={busy} onClick={() => void actions.unbind()}>
            解绑
          </button>
        )}
      </div>

      <div className="muted" style={{ fontSize: 12, lineHeight: 1.7, marginTop: 4 }}>
        用手机「UC 浏览器」扫码授权一次即可（与 jar 配置中心的「UC 网盘 TV Token」同一流程）。
        {!bound && cookieBound ? ' 当前只绑了 UC Cookie：会员线路可用，非会员的原画线路会提示缺 TV Token。' : ''}
      </div>

      {qr ? (
        <div className="row" style={{ gap: 12, alignItems: 'flex-start', marginTop: 8 }}>
          <img
            src={qr}
            alt="UC TV Token 二维码"
            style={{ width: 180, height: 180, background: '#fff', padding: 6, borderRadius: 8 }}
          />
          <span className="muted" style={{ fontSize: 12, lineHeight: 1.8 }}>
            扫码后请在手机上确认「TV Token」授权
            <br />
            确认后本窗口会自动完成绑定
          </span>
        </div>
      ) : (
        <div className="row" style={{ gap: 10, marginTop: 8, alignItems: 'center' }}>
          <button className="primary" disabled={busy} onClick={() => void actions.create()}>
            {busy ? '获取中…' : bound ? '重新扫码获取' : '扫码获取 TV Token'}
          </button>
        </div>
      )}

      {msg && <div className="muted" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.7 }}>{msg}</div>}
    </div>
  );
}
