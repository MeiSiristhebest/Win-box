// src/renderer/components/SourcePicker.tsx
// 换源入口：**源名只显示文字**，**左键单击**弹出源列表浮层选择；**鼠标离开（按钮 + 弹层）即自动收起**。
// 经典皮肤与 TopNav 皮肤共用本组件。
// ★ 2026-09-24（用户定稿）：换源改成「手机 TVBox」那套 —— 源名只显示文字。
// ★ 2026-09-30（用户要求）：
//   ① 弹层升级为「左订阅 / 右源」双栏：点左侧订阅，右侧源列表同步切换；名字过长一律省略号（hover 看全名）；
//   ② 顶部加**源名实时检索**（在当前订阅的源里随输入过滤；回车选中首个匹配）；
//   ③ 跨订阅点选 = 一步完成「切换档案 + 选中源」（CFG_SWITCH_PROFILE_SOURCE，单次 apply）；
//   ④ **触发方式由「长按≥500ms 或右键」改为「左键单击」**（原长按/右键已移除），
//      并在鼠标离开换源区域后自动收起（带 150ms 宽限，越过「按钮↔弹层」那道 6px 缝隙时不闪关）。
// 用法：
//   - 受控：传 sites/current/onPick（点播页 .topbar 用，直接联动 HomePage 的 chooseSource）
//   - 自取：不传 sites 时自己 cfgGet 取源列表，选中后广播 winbox:source-changed（顶栏/侧栏用）
// ★ 2026-10-09（用户指令：「删除之前版本做的换源的下拉菜单调整源的位置的功能，不美观」）：
//   源行内管理按钮（⤒置顶 / ↑上移 / ↓下移 / ✕删除）与本组件内的对应逻辑已删除 —— 源管理只在配置页保留
//   （IPC `cfg:moveSource` / `cfg:deleteSource` 未动）。
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredPanel } from './useAnchoredPanel';
import { client } from '../api/client';
import { notifyProfileChanged } from '../lib/configEvents';
import { isNativeModalOpen } from '../lib/modalScope';
import type { ProfileSitesView, SourceBean } from '../../shared/types';

export interface SourcePickerProps {
  /** 源列表（不传则内部自取） */
  sites?: SourceBean[];
  /** 当前源 key（不传则内部自取） */
  current?: string;
  /** 选中回调（不传则内部调用 cfgSetActiveSource 并广播事件） */
  onPick?: (key: string) => void;
  /** 顶栏小按钮 / 侧栏文字行 */
  variant?: 'pill' | 'sidebar';
  disabled?: boolean;
}

/**
 * ★ 2026-10-16（用户要求「换源下拉框常驻时间增加到 3s，3s 后动画回缩」）：
 *   鼠标离开换源区域（按钮 + 弹层）后弹层**常驻 3s**（期间指针移回区域内即取消；也足够越过
 *   「按钮 ↔ 弹层」那道 6px 缝隙），到时先播一段「回缩」出场动画、动画走完才真正卸载。
 */
const LEAVE_HOLD_MS = 3000;
/** 「回缩」出场动画时长（与 CSS 的 `--dur-panel` 对齐；动画走完才 setOpen(false)，见 scheduleLeave） */
const CLOSE_ANIM_MS = 280;

export default function SourcePicker({ sites, current, onPick, variant = 'pill', disabled }: SourcePickerProps) {
  const [ownSites, setOwnSites] = useState<SourceBean[]>([]);
  const [ownKey, setOwnKey] = useState('');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [switching, setSwitching] = useState(false);
  const switchingRef = useRef(false);
  const ownSequence = useRef(0);
  /** 换源弹层「左订阅 / 右源」数据（打开时拉取；跨订阅点选后由事件驱动刷新） */
  const [views, setViews] = useState<ProfileSitesView | null>(null);
  /** 左栏选中的订阅（默认 = 当前生效订阅） */
  const [paneId, setPaneId] = useState('');
  /** 源名检索词（只过滤右栏） */
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const keyboardInteraction = useRef(false);
  const panelId = useId();
  const panelRef = useRef<HTMLElement | null>(null);
  const panelPosition = useAnchoredPanel(open, triggerRef, panelRef, 420, variant === 'sidebar' ? 'top' : 'bottom');
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const srcColRef = useRef<HTMLDivElement | null>(null);
  /** ★ 2026-09-30：档案视图请求代次 —— 只认最后一次请求的响应（慢响应不得覆盖新数据） */
  const viewSeqRef = useRef(0);
  /** ★ 2026-10-16（用户要求「展开即定位当前所在的源」）：当前源那一行的 DOM（定位用，见上面 effect） */
  const activeRef = useRef<HTMLButtonElement | null>(null);
  /** ★ 2026-09-30：鼠标移出的宽限计时器（移回区域内即取消，见 cancelLeave/scheduleLeave） */
  const leaveTimerRef = useRef<number | null>(null);
  /** ★ 2026-10-16：弹层正在播「回缩」出场动画（播完才 setOpen(false)） */
  const [closing, setClosing] = useState(false);
  /** 回缩动画的收尾计时器（与 leaveTimerRef 一起在「移回区域内 / 卸载」时清掉） */
  const closeTimerRef = useRef<number | null>(null);

  const selfLoad = sites === undefined || current === undefined;
  const loadOwn = (): void => {
    if (!selfLoad) return;
    const request = ++ownSequence.current;
    client
      .cfgGet()
      .then((c) => {
        if (request !== ownSequence.current) return;
        setOwnSites(c.sources || []);
        setOwnKey(c.ui?.activeSourceKey || '');
      })
      .catch(() => undefined);
  };

  /**
   * 拉取「每份订阅的源清单」。
   * ★ 2026-09-30（用户报「切换订阅时源列表偶尔残留上一个订阅的源」）：
   *   ① 代次守卫：只采纳最后一次请求的响应 —— 旧的慢响应回来时整包丢弃（否则会把右栏
   *      改回上一次打开弹层时的快照，看起来就是"混着上一个订阅的源"）；
   *   ② `alignActive=true`（每次打开弹层）时把左栏对齐到**当前生效订阅** —— 不再沿用上次
   *      浏览过的那份订阅，避免打开瞬间右栏还是别人家的源。
   */
  const loadViews = (alignActive = false): void => {
    const seq = ++viewSeqRef.current;
    client
      .cfgProfileSites()
      .then((v) => {
        if (seq !== viewSeqRef.current) return; // 过期响应丢弃
        setViews(v);
        setPaneId((cur) => (alignActive || !(cur && v.profiles.some((p) => p.id === cur)) ? v.activeId : cur));
      })
      .catch((cause: unknown) => {
        if (seq !== viewSeqRef.current) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setViews(null);
      });
  };

  useEffect(() => {
    loadOwn();
    // 切源（其他入口）/窗口重新聚焦 → 重新对齐当前源（多窗口/多入口一致性）
    // ★ 2026-09-26：源列表本身变了（配置页导入/删源/切档案后广播 winbox:sources-changed）也要重取，
    //   否则本组件常驻 App（挂载一次）会一直显示旧的「未导入源」。
    const onFocus = (): void => loadOwn();
    const onChanged = (): void => loadOwn();
    const onSources = (): void => loadOwn();
    window.addEventListener('focus', onFocus);
    window.addEventListener('winbox:source-changed', onChanged);
    window.addEventListener('winbox:sources-changed', onSources);
    return () => {
      ownSequence.current += 1;
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('winbox:source-changed', onChanged);
      window.removeEventListener('winbox:sources-changed', onSources);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfLoad]);

  // 打开时：**先作废旧快照**再拉档案视图 + 复位检索词（订阅可能在配置页改过）
  // ★ 2026-09-30：views 置 null 是关键 —— 否则弹层会先按「上一次打开时的快照」渲染，
  //   用户看到的就是**上一个订阅的源列表**（用户报的"残留"）。
  useEffect(() => {
    if (!open) return;
    setQ('');
    setViews(null);
    setPaneId('');
    loadViews(true);
    // 弹层打开期间配置变了（配置页导入/删源/切档案、跨订阅换源）→ 立即重拉，保持与真实配置一致
    const onCfgChanged = (): void => loadViews();
    window.addEventListener('winbox:sources-changed', onCfgChanged);
    window.addEventListener('winbox:profile-changed', onCfgChanged);
    return () => {
      window.removeEventListener('winbox:sources-changed', onCfgChanged);
      window.removeEventListener('winbox:profile-changed', onCfgChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // ★ 2026-09-30：换订阅 / 改检索词后右栏回到顶部 —— 否则沿用上一份订阅的滚动位置，
  //   看上去像"列表里混着别的源"。
  // ★ 2026-10-16（用户要求）：**展开弹层时自动定位「当前所在的源」**，不再回到列表顶层 ——
  //   只有「检索中」与「当前源不在这一栏清单里（切到了别的订阅）」才回顶部；
  //   其余时机（打开弹层 / 档案视图拉回 / 切回当前订阅）把当前源滚到可视区**中部**。
  //   ★ 位置用两个 `offsetTop` 相减（同为相对 `.srcpick-pop` 的**布局值**）：不受弹层进场动画
  //     `popIn` 的 `transform: scale(.97)` 影响，也不受 `.srcpick-pop` 的 6px 内边距干扰。
  useEffect(() => {
    const col = srcColRef.current;
    if (!col) return;
    const el = activeRef.current;
    if (q.trim() || !el || !col.contains(el)) {
      col.scrollTop = 0;
      return;
    }
    col.scrollTop = Math.max(0, el.offsetTop - col.offsetTop - (col.clientHeight - el.offsetHeight) / 2);
  }, [open, q, paneId, views]);

  // 打开时外部点击 / Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node) && !panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (isNativeModalOpen()) return;
      if (e.key === 'Escape' && !e.isComposing) {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const list = sites ?? ownSites;
  const cur = current ?? ownKey;
  const curBean = list.find((s) => s.key === cur);
  const label = curBean ? curBean.name || curBean.key : list[0] ? list[0].name || list[0].key : '未导入源';

  const multi = (views?.profiles.length ?? 0) > 1;
  const pane = multi ? views!.profiles.find((p) => p.id === paneId) ?? views!.profiles.find((p) => p.id === views!.activeId) : undefined;
  /** 右栏源清单：双栏时取左栏订阅的清单；单栏（无档案/只有一份）时退回既有源列表 */
  const paneSites = pane ? pane.sites : list.map((s) => ({ key: s.key, name: s.name || s.key }));
  const paneIsActive = !pane || pane.id === views?.activeId;
  const query = q.trim().toLowerCase();
  const filtered = query
    ? paneSites.filter((s) => (s.name || s.key).toLowerCase().includes(query) || s.key.toLowerCase().includes(query))
    : paneSites;

  // ★ 2026-09-30（用户要求）：鼠标移出换源区域（按钮 + 弹层，弹层是 wrapper 的 DOM 子节点）即自动收起。
  //   ★ 2026-10-16（用户要求）：收起前先**常驻 3s**（原来 150ms 太短，一移开就没了），
  //     到时再播「回缩」出场动画（CSS `.srcpick-closing`），动画走完才真正卸载。
  //     ——常驻期间（含回缩动画期间）指针回到区域内 → cancelLeave 全部取消，弹层照旧。
  const cancelLeave = (): void => {
    if (leaveTimerRef.current !== null) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    // 回缩动画播到一半指针又回来了 → 掐掉收尾计时器、退回常态（弹层不消失）
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setClosing((prev) => (prev ? false : prev));
  };
  const scheduleLeave = (): void => {
    if (!open) return;
    if (keyboardInteraction.current && (wrapRef.current?.contains(document.activeElement) || panelRef.current?.contains(document.activeElement))) return;
    cancelLeave();
    leaveTimerRef.current = window.setTimeout(() => {
      leaveTimerRef.current = null;
      setClosing(true); // ① 先展开「回缩」出场动画
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        setOpen(false); // ② 动画走完才卸载
        setClosing(false);
      }, CLOSE_ANIM_MS);
    }, LEAVE_HOLD_MS);
  };
  // 卸载时清掉两个计时器
  useEffect(
    () => () => {
      if (leaveTimerRef.current !== null) clearTimeout(leaveTimerRef.current);
      if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
    },
    [],
  );

  /** 左键单击开关弹层（原「长按 ≥500ms / 右键」已移除） */
  const toggleOpen = (): void => {
    if (disabled) return;
    cancelLeave();
    setError('');
    setOpen((v) => !v);
  };

  const pick = async (k: string): Promise<void> => {
    triggerRef.current?.focus();
    setOpen(false);
    if (k === cur) return;
    if (onPick) {
      onPick(k);
      return;
    }
    try {
      await client.cfgSetActiveSource(k);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setOpen(true);
      return;
    }
    setOwnKey(k);
    window.dispatchEvent(new CustomEvent('winbox:source-changed', { detail: k }));
  };

  /**
   * ★ 2026-10-16（用户要求）：**左侧点选订阅时，配置档案也同步切换**（不再只是"浏览"）。
   *   此前点左侧订阅只切换右栏列表，生效档案要到"再点一个源"才切换 —— 与配置页「已保存配置」的
   *   "当前订阅"不一致；这里点选即 `cfgActivateProfile`，并广播 profile-changed / sources-changed
   *   让点播页与各列表按新档案重载。
   *   该订阅无可恢复内容（早期迁移档案 json 为空）→ 仅浏览，不改生效档案。
   */
  const selectPane = (id: string): void => {
    if (!id || switchingRef.current || id === views?.activeId) return;
    switchingRef.current = true;
    setSwitching(true);
    setError('');
    void (async () => {
      try {
        await client.cfgActivateProfile(id);
        setPaneId(id);
        notifyProfileChanged();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        switchingRef.current = false;
        setSwitching(false);
      }
    })();
  };

  /**
   * 点选某源：目标订阅 = 当前生效订阅 → 走既有 pick；
   * 否则先切换档案再选中源（一步完成），并广播两类变更事件让各页同步。
   */
  const pickSource = async (k: string): Promise<void> => {
    if (switchingRef.current) return;
    setError('');
    const targetProfile = pane && multi ? pane.id : '';
    const activeId = views?.activeId || '';
    if (!targetProfile || targetProfile === activeId) {
      await pick(k);
      return;
    }
    setOpen(false);
    triggerRef.current?.focus();
    try {
      await client.cfgSwitchProfileSource(targetProfile, k);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setOpen(true);
      return;
    }
    setOwnKey(k);
    // 档案已切换：先广播 profile-changed（点播页强制按新档案重载目标源，含「两订阅同名 key」的情况），
    // 再广播 sources-changed 让各列表（换源入口/历史页）重取
    notifyProfileChanged(k);
  };

  const isSidebar = variant === 'sidebar';

  return (
    <div
      ref={wrapRef}
      className={`srcpick${isSidebar ? ' srcpick-side' : ''}`}
      onMouseEnter={cancelLeave}
      onMouseLeave={scheduleLeave}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget) && !panelRef.current?.contains(event.relatedTarget)) setOpen(false); }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`srcpick-name ui-action${disabled ? ' disabled' : ''}`}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`切换站点，当前：${label}`}
        title={`当前源：${label}\n点击切换源`}
        onClick={(event) => { keyboardInteraction.current = event.detail === 0; toggleOpen(); }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {isSidebar ? <span className="srcpick-label">站点</span> : null}
        <span className="srcpick-text">{label}</span>
        <span className="srcpick-caret">▾</span>
      </button>
      {open && createPortal(
        <section
          ref={panelRef}
          id={panelId}
          style={panelPosition}
          className={`srcpick-pop${pane && multi ? ' srcpick-pop-wide' : ''}${isSidebar ? ' srcpick-pop-side' : ''}${closing ? ' srcpick-closing' : ''}`}
          aria-label="订阅和来源"
        >
          {error && <div className="err" role="alert">{error}</div>}
          <div className="srcpick-pop-tip">
            {views
              ? `点击源名切换 · 共 ${filtered.length} 个${multi ? ` · ${views.profiles.length} 份订阅` : ''}`
              : '正在加载订阅…'}
          </div>
          <input
            ref={inputRef}
            className="srcpick-search"
            aria-label="筛选订阅源"
            placeholder="输入源名检索…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              keyboardInteraction.current = true;
              cancelLeave();
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && filtered.length) void pickSource(filtered[0].key);
            }}
          />
          <div className="srcpick-cols">
            {pane && multi && (
              <div className="srcpick-col-sub">
                {views!.profiles.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    aria-pressed={p.id === pane.id}
                    className={`srcpick-item ui-action srcpick-sub${p.id === pane.id ? ' active' : ''}${p.id === views!.activeId ? ' cur' : ''}`}
                    title={`${p.name}（${p.sites.length} 个源）${p.id === views!.activeId ? ' · 当前订阅' : ''}`}
                    disabled={switching}
                    onClick={() => selectPane(p.id)}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
            <div className="srcpick-col-src" ref={srcColRef}>
              {filtered.length === 0 && (
                <div className="srcpick-item muted">{paneSites.length === 0 ? '（未导入源）' : '（无匹配源）'}</div>
              )}
              {filtered.map((s) => (
                <button
                  type="button"
                  key={s.key}
                  aria-pressed={paneIsActive && s.key === cur}
                  className={`srcpick-item ui-action${paneIsActive && s.key === cur ? ' active' : ''}`}
                  ref={paneIsActive && s.key === cur ? activeRef : undefined}
                  title={`${s.name || s.key}（${s.key}）`}
                  disabled={switching}
                  onClick={() => void pickSource(s.key)}
                >
                  <span className="srcpick-sname">{s.name || s.key}</span>
                </button>
              ))}
            </div>
          </div>
        </section>, document.body,
      )}
    </div>
  );
}
