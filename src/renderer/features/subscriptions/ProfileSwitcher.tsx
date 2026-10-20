import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { UserConfig } from '../../../shared/types';
import { client } from '../../api/client';
import { AppModal } from '../../components/AppDialog';
import { notifyProfileChanged, SOURCES_CHANGED_EVENT } from '../../lib/configEvents';
import { profileChoices } from './profileChoices';
import styles from './ProfileSwitcher.module.css';

export function ProfileSwitcher() {
  const navigate = useNavigate();
  const [config, setConfig] = useState<UserConfig | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [switching, setSwitching] = useState(false);
  const switchingRef = useRef(false);
  const alive = useRef(true);
  const loadSequence = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const currentChoice = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const refresh = useCallback(async () => {
    const request = ++loadSequence.current;
    try {
      const value = await client.cfgGet();
      if (alive.current && request === loadSequence.current) { setConfig(value); return true; }
      return false;
    } catch (cause) {
      if (alive.current && request === loadSequence.current) setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    const load = () => { void refresh(); };
    load();
    window.addEventListener(SOURCES_CHANGED_EVENT, load);
    window.addEventListener('focus', load);
    return () => { alive.current = false; loadSequence.current += 1; window.removeEventListener(SOURCES_CHANGED_EVENT, load); window.removeEventListener('focus', load); };
  }, [refresh]);

  const active = config?.profiles.find(profile => profile.id === config.activeProfileId);
  const choices = config ? profileChoices(config) : [];
  const search = query.trim().toLocaleLowerCase();
  const filtered = choices.filter(item => !search || (item.name + ' ' + item.groupName).toLocaleLowerCase().includes(search));

  useEffect(() => {
    if (!open || !list.current) return;
    const container = list.current;
    const current = currentChoice.current;
    container.scrollTop = !search && current
      ? Math.max(0, current.offsetTop - container.offsetTop - (container.clientHeight - current.offsetHeight) / 2)
      : 0;
  }, [open, search, config]);

  async function activate(id: string) {
    if (switchingRef.current) return;
    if (id === config?.activeProfileId) { setOpen(false); return; }
    switchingRef.current = true;
    setSwitching(true);
    setError('');
    try {
      await client.cfgActivateProfile(id);
      if (alive.current) setConfig(current => current ? { ...current, activeProfileId: id } : current);
      notifyProfileChanged();
      const refreshed = await refresh();
      if (alive.current && refreshed) setOpen(false);
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      switchingRef.current = false;
      if (alive.current) setSwitching(false);
    }
  }

  const activeLabel = active?.name || (config?.sources.length || config?.lives.length ? '当前配置' : '未导入');
  return (<>
    <button type="button" className={`${styles.trigger} profile-switch-trigger`} title={`当前子仓：${activeLabel}\n点击切换子仓`} aria-label={`切换子仓，当前：${activeLabel}`} aria-haspopup="dialog" onClick={() => { setQuery(''); setError(''); setOpen(true); void refresh(); }}>
      <span className={styles.triggerLabel}>子仓</span><span className={styles.current}>{activeLabel}</span><span aria-hidden="true">▾</span>
    </button>
    <AppModal open={open} titleId={titleId} descriptionId={descriptionId} initialFocusRef={input} className={'app-dialog card modal-in ' + styles.dialog} canClose={!switching} onClose={() => setOpen(false)}>
      <div className={`${styles.heading} app-dialog-heading`}><h2 id={titleId}>切换子仓</h2><button className="app-dialog-close" type="button" disabled={switching} onClick={() => setOpen(false)}>关闭</button></div>
      <p id={descriptionId} className="muted">切换后，点播站点和直播线路使用该子仓的已保存配置。</p>
      <input ref={input} aria-label="筛选子仓" placeholder="输入子仓或订阅组名称" value={query} onChange={event => setQuery(event.target.value)} />
      {error && <p className="err" role="alert">{error}</p>}
      <div ref={list} className={styles.list} aria-busy={switching}>
        {filtered.map(item => {
          const current = item.profileId === config?.activeProfileId;
          return <button key={item.id} ref={current ? currentChoice : undefined} type="button" className={styles.choice} aria-pressed={current} disabled={switching || !item.restorable} onClick={() => { if (item.profileId) void activate(item.profileId); }}>
            <span className={styles.choiceName}>{item.name}{current ? ' · 当前' : ''}</span>
            <span className={styles.meta}>{item.groupName} · {item.sourceCount} 个站点 · {item.liveCount} 条直播</span>
            {item.reason && <span className={styles.reason}>{item.reason}</span>}
          </button>;
        })}
        {!filtered.length && <p className="muted">{choices.length ? '没有匹配的子仓' : '尚未保存子仓配置，请先导入多仓订阅。'}</p>}
      </div>
      <div className={`${styles.footer} app-dialog-actions`}><span className="muted">{switching ? '正在切换…' : `显示 ${filtered.length}/${choices.length} 个子仓 · ${filtered.filter(item => item.restorable).length} 个可切换`}</span><button className="app-dialog-action-secondary" type="button" disabled={switching} onClick={() => { setOpen(false); try { localStorage.setItem('winbox-cfg-tab', 'profiles'); } catch { /* Storage may be disabled. */ } navigate('/config'); }}>管理配置档案</button></div>
    </AppModal>
  </>);
}
