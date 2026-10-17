// src/renderer/components/UcTvBind.tsx
// ★ 2026-10-14 UC TV Token（非会员 UC 原画）绑定块 —— 挂在 DriveBindModal 的「UC 网盘」页签下。
//
// 为什么单独一个：wex 族 jar（虎斑/玩偶…）的 UC 取流在 `MyPan$UcMineProvider.player()` 里按
//   `member_type` 分流；**非高会（NORMAL）走的是 `Wex_ucpan_token`**（UC 电视端开放平台 OAuth
//   的 token 对），而不是 cookie —— 只绑 cookie 时必报
//   「非高会需要配置 UC TV Token，请到配置中心扫码获取」。桌面端没有 jar 的配置中心扫码页，
//   故这里直接复刻该扫码流（主进程侧见 src/main/net/ucTvToken.ts）。
import { useCallback, useEffect, useRef, useState } from 'react';
import { client } from '../api/client';

interface Props {
  /** 绑定成功后通知外层（DrivBindModal 会刷新已绑列表） */
  onBound: () => void;
  /** 已绑 cookie 的网盘（仅当 uc 已绑时提示价值；缺省不影响功能） */
  cookieBound?: boolean;
}

const POLL_INTERVAL_MS = 3000;

export default function UcTvBind({ onBound, cookieBound }: Props) {
  const [bound, setBound] = useState(false);
  const [qr, setQr] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 组件卸载/重新取码后停止轮询（避免回调落到已失效的会话上） */
  const alive = useRef(true);

  const stopPolling = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void client.ucTvStatus().then((r) => setBound(!!r.bound)).catch(() => undefined);
    return () => {
      alive.current = false;
      stopPolling();
    };
  }, [stopPolling]);

  const poll = useCallback(async function poll(): Promise<void> {
    if (!alive.current) return;
    try {
      const r = await client.ucTvQrPoll();
      if (!alive.current) return;
      if (r.state === 'ok') {
        setQr('');
        setBound(true);
        setMsg('✓ UC TV Token 已绑定。回到源内重新进一次详情即可生效（蜘蛛已重置）。');
        onBound();
        return;
      }
      if (r.state === 'expired' || r.state === 'error') {
        setQr('');
        setMsg(`✗ ${r.hint || (r.state === 'expired' ? '二维码已过期，请重新获取' : '轮询失败')}`);
        return;
      }
      timer.current = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    } catch (e) {
      if (!alive.current) return;
      setQr('');
      setMsg(`✗ 轮询失败：${(e as Error).message}`);
    }
  }, [onBound]);

  async function create(): Promise<void> {
    stopPolling();
    setBusy(true);
    setMsg('请用手机上的「UC 浏览器」扫描二维码并确认授权');
    try {
      const r = await client.ucTvQrCreate();
      if (!alive.current) return;
      setQr(r.imageDataUrl);
      timer.current = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    } catch (e) {
      setMsg(`✗ 取码失败：${(e as Error).message}`);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function unbind(): Promise<void> {
    stopPolling();
    setBusy(true);
    setMsg('');
    try {
      await client.ucTvRemove();
      setBound(false);
      setQr('');
      setMsg('已解绑 UC TV Token');
      onBound();
    } catch (e) {
      setMsg(`解绑失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line, #333)' }}>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>UC 原画 · TV Token</span>
        <span className="muted" style={{ fontSize: 11 }}>
          {bound ? '已绑定' : '未绑定（非会员云盘账号的「UC原画」线路需要它）'}
        </span>
        {bound && (
          <button className="linkbtn" style={{ marginLeft: 'auto' }} disabled={busy} onClick={() => void unbind()}>
            解绑
          </button>
        )}
      </div>

      <div className="muted" style={{ fontSize: 11, lineHeight: 1.7, marginTop: 4 }}>
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
          <span className="muted" style={{ fontSize: 11, lineHeight: 1.8 }}>
            扫码后请在手机上确认「TV Token」授权
            <br />
            确认后本窗口会自动完成绑定
          </span>
        </div>
      ) : (
        <div className="row" style={{ gap: 10, marginTop: 8, alignItems: 'center' }}>
          <button className="primary" disabled={busy} onClick={() => void create()}>
            {busy ? '获取中…' : bound ? '重新扫码获取' : '扫码获取 TV Token'}
          </button>
        </div>
      )}

      {msg && <div className="muted" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.7 }}>{msg}</div>}
    </div>
  );
}
