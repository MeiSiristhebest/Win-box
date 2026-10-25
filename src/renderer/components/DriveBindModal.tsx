// src/renderer/components/DriveBindModal.tsx
// ★ 2026-09-26（用户要求）：**源内网盘绑定** —— 打开网盘类源（如 fty「🗂我的云盘┃配置」、
//   玩偶/立播/抠搜/YpanSo 等 ext 带 `Cloud-drive` 的转存源）时，直接在源主页完成 cookie 配置，
//   不用再进「配置 → 账号与凭据」，也不用去点源里那个「配置」源。
//
// 写盘事实（与 jar 侧对齐，见 docs/design/源内绑定_设计方案.md 与 driveExt.ts）：
//   · 夸克/UC → 应用凭据（DriveStore，DPAPI 加密）+ fty 约定配置文件
//     `<userData>/tvfan/Cloud-drive.txt` 的 `quarkCookie`/`ucCookie`
//     （Cloud_quark/Cloud_uc 在 init 时读它；不含 `pus` 的 cookie 会被蜘蛛置空）；
//   · 其余网盘（百度/阿里/115/哔哩）→ 应用凭据 + 注入蜘蛛 ext（ext.baidu/ali/bili…）。
//   保存后主进程会丢弃常驻蜘蛛进程 → 下次请求按新 cookie 重新 init（否则仍用旧 cookie）。
import { Tab as FluentTab, TabList as FluentTabList } from '@fluentui/react-components';
import { CheckmarkCircle20Filled, Circle20Regular } from '@fluentui/react-icons';
import { driveProviderLabel } from '../../shared/driveProvider';
import { AppModal } from './AppDialog';
import DriveLogin from './DriveLogin';
import UcTvBind from './UcTvBind';
import type { DriveBindingPorts } from '../features/driveBinding/application/driveBindingPorts';
import { useDriveCredentialManagement } from '../features/driveBinding/useDriveCredentialManagement';

/** 可绑定网盘（key = DriveStore provider 键；与 fty 绑定页的「夸克/百度/阿里/哔哩」菜单口径一致） */
const PROVIDERS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'quark', label: '夸克网盘' },
  { key: 'uc', label: 'UC 网盘' },
  { key: 'baidu', label: '百度网盘' },
  { key: 'ali', label: '阿里云盘' },
  { key: '115', label: '115 网盘' },
  { key: 'bili', label: '哔哩哔哩' },
];

export interface DriveBindModalProps {
  /** 当前源名（文案用） */
  siteName: string;
  /**
   * ★ 2026-09-29：**预选网盘**（解析到某网盘专用链接、但未绑定时自动弹窗时传入）——
   *   直接把用户要绑的那家选中，省掉"自己找是哪一家"。
   */
  initialProvider?: string;
  /** 自动弹窗场景的一句上下文（如「该资源来自」），显示在标题下方 */
  reason?: string;
  onClose: () => void;
  /** 保存成功后通知外层（刷新源主页，让新 cookie 立刻生效） */
  onSaved: () => void;
  ports: DriveBindingPorts;
}

export default function DriveBindModal({ siteName, initialProvider, reason, onClose, onSaved, ports }: DriveBindModalProps) {
  const initProv = (initialProvider || '').trim().toLowerCase();
  const selectedInitialProvider = PROVIDERS.some((item) => item.key === initProv) ? initProv : 'quark';
  const { model, actions } = useDriveCredentialManagement({ port: ports.credentials, initialProvider: selectedInitialProvider, onSaved });
  const { provider, cookie, credentials: tokens, busy, message: msg, validation: check, isBound: bound } = model;

  return (
    <AppModal
      open
      className="app-dialog card modal-in drive-bind-dialog"
      titleId="drive-bind-title"
      closeOnBackdrop
      onClose={onClose}
    >
        <div className="app-dialog-heading">
          <h2 id="drive-bind-title">全局网盘账号</h2>
          <button className="app-dialog-close" onClick={onClose}>关闭</button>
        </div>

        <div className="muted" style={{ fontSize: 12, lineHeight: 1.7, marginBottom: 10 }}>
          {initProv
            ? `检测到该资源来自「${driveProviderLabel(initProv)}」网盘的专用链接，未绑定对应 Cookie 时无法取流。绑定后回到播放页会自动重新解析。`
            : `使用场景：${siteName}。`}
          <p>登录状态独立保存在本机，所有支持该网盘的子仓和站点共享；切换线路无需重复登录。</p>
          {reason ? <div style={{ marginTop: 4 }}>{reason}</div> : null}
        </div>

        <FluentTabList
          className="drive-provider-list"
          aria-label="选择网盘服务"
          appearance="subtle-circular"
          selectedValue={provider}
          onTabSelect={(_event, data) => actions.selectProvider(String(data.value))}
        >
          {PROVIDERS.map((p) => (
            <FluentTab
              key={p.key}
              id={`drive-provider-${p.key}`}
              aria-controls="drive-provider-panel"
              value={p.key}
              icon={tokens[p.key] ? <CheckmarkCircle20Filled className="drive-provider-bound-icon" /> : <Circle20Regular className="drive-provider-unbound-icon" />}
              className="drive-provider-tab"
            >
              <span className="drive-provider-name">{p.label}</span>
              <span className="drive-provider-state">
                {provider === p.key ? '当前' : tokens[p.key] ? '已绑定' : '未绑定'}
              </span>
            </FluentTab>
          ))}
        </FluentTabList>

        <section
          id="drive-provider-panel"
          className="drive-provider-panel"
          role="tabpanel"
          aria-labelledby={`drive-provider-${provider}`}
          tabIndex={0}
        >
        <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <span className="muted" style={{ fontSize: 12 }}>
            {bound ? `当前已绑定（${driveProviderLabel(provider)}，凭据长度 ${tokens[provider].length}）` : '当前未绑定'}
          </span>
          {bound && (
              <button className="linkbtn" style={{ marginLeft: 'auto' }} disabled={busy} onClick={() => void actions.unbind()}>
              解绑
            </button>
          )}
        </div>

        <textarea
          value={cookie}
          aria-label={`${driveProviderLabel(provider)} Cookie`}
          onChange={(e) => actions.changeCookie(e.target.value)}
          placeholder={`粘贴「${driveProviderLabel(provider)}」的完整 Cookie（形如 __pus=…; __puus=…）\n获取：浏览器打开网盘网页并登录 → F12 → Network → 任意请求 → 复制 Request Headers 里的完整 cookie`}
          style={{ width: '100%', height: 110, boxSizing: 'border-box', resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
        />

        {!!cookie.trim() && !check.ok && (
          <div className="banner" style={{ borderLeftColor: 'var(--warn)', marginTop: 8, fontSize: 12, lineHeight: 1.7 }}>
            ⚠ {check.message}
          </div>
        )}

        <div className="row" style={{ gap: 10, marginTop: 12, alignItems: 'center' }}>
          <button className="primary" disabled={busy || !cookie.trim()} onClick={() => void actions.save()}>
            {busy ? '保存中…' : '保存绑定'}
          </button>
          <span className="muted" style={{ fontSize: 12 }}>不知道去哪拿 Cookie？用下面的「扫码登录」自动抓取完整 Cookie</span>
        </div>

        {/* ★ 2026-09-26：扫码/网页登录（原配置页网盘绑定卡的能力，已搬到源内） */}
        <DriveLogin
          provider={provider}
          port={ports.webLogin}
          onBound={() => { void actions.handleExternalLoginSaved(); }}
        />

        {/* ★ 2026-10-14：UC 专属 —— non-VIP（NORMAL）的「UC原画」走 TV Token 而非 cookie，
            只绑 cookie 时 jar 报「非高会需要配置 UC TV Token，请到配置中心扫码获取」 */}
        {provider === 'uc' && <UcTvBind cookieBound={bound} onBound={() => { void actions.handleExternalLoginSaved(); }} port={ports.ucTvToken} />}

        {msg && <div className="muted" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.7 }}>{msg}</div>}
        </section>
    </AppModal>
  );
}
