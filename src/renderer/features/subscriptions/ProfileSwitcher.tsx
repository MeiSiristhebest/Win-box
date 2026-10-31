import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppModal } from '../../components/AppDialog';
import { useProfileSwitcher } from './useProfileSwitcher';
import styles from './ProfileSwitcher.module.css';

import type { ProfileSwitcherPort } from './application/profileSwitcherPort';

interface ProfileSwitcherProps {
  port: ProfileSwitcherPort;
}

export function ProfileSwitcher({ port }: ProfileSwitcherProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { model, actions } = useProfileSwitcher({ port, query });
  const { config, choices, filtered, activeLabel, error, switching } = model;
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const currentChoice = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    if (!open || !list.current) return;
    const container = list.current;
    const current = currentChoice.current;
    container.scrollTop = !query.trim() && current
      ? Math.max(0, current.offsetTop - container.offsetTop - (container.clientHeight - current.offsetHeight) / 2)
      : 0;
  }, [open, query, config]);

  return (<>
    <button type="button" className={`${styles.trigger} profile-switch-trigger`} title={`当前子仓：${activeLabel}\n点击切换子仓`} aria-label={`切换子仓，当前：${activeLabel}`} aria-haspopup="dialog" onClick={() => { setQuery(''); actions.clearError(); setOpen(true); void actions.refresh(); }}>
      <span className={styles.triggerLabel}>子仓</span><span className={styles.current}>{activeLabel}</span><span aria-hidden="true">▾</span>
    </button>
    <AppModal open={open} titleId={titleId} descriptionId={descriptionId} initialFocusRef={input} className={'app-dialog card modal-in profile-switcher-dialog ' + styles.dialog} canClose={!switching} onClose={() => setOpen(false)}>
      <div className={`${styles.heading} app-dialog-heading`}><h2 id={titleId}>切换子仓</h2><button className="app-dialog-close" type="button" disabled={switching} onClick={() => setOpen(false)}>关闭</button></div>
      <p id={descriptionId} className="muted">切换后，点播站点和直播线路使用该子仓的已保存配置。</p>
      <input ref={input} aria-label="筛选子仓" placeholder="输入子仓或订阅组名称" value={query} onChange={event => setQuery(event.target.value)} />
      {error && <p className="err" role="alert">{error}</p>}
      <div ref={list} className={`${styles.list} profile-switcher-list`} aria-busy={switching}>
        {filtered.map(item => {
          const current = item.profileId === config?.activeProfileId;
          return <button key={item.id} ref={current ? currentChoice : undefined} type="button" className={`${styles.choice} profile-switcher-choice`} aria-pressed={current} disabled={switching || !item.restorable} onClick={() => { if (item.profileId) void actions.activate(item.profileId).then(activated => { if (activated) setOpen(false); }); }}>
            <span className={`${styles.choiceHeading} profile-switcher-choice-heading`}>
              <span className={`${styles.choiceName} profile-switcher-choice-name`}>{item.name}</span>
              {current && <span className={styles.currentState}>当前</span>}
            </span>
            <span className={`${styles.meta} profile-switcher-choice-meta`}>{item.groupName} · {item.sourceCount} 个站点 · {item.liveCount} 条直播</span>
            {item.reason && <span className={`${styles.reason} profile-switcher-choice-reason`}>{item.reason}</span>}
          </button>;
        })}
        {!filtered.length && <p className="muted">{choices.length ? '没有匹配的可用档案' : config?.subscriptionGroups.length ? '当前没有可用档案；可在“管理配置档案”中查看各成员状态。' : '尚未保存子仓配置，请先导入多仓订阅。'}</p>}
      </div>
      <div className={`${styles.footer} app-dialog-actions profile-switcher-footer`}><span className="muted">{switching ? '正在切换…' : `显示 ${filtered.length}/${choices.length} 个可用档案`}</span><button className="app-dialog-action-secondary" type="button" disabled={switching} onClick={() => { setOpen(false); navigate('/config?section=profiles'); }}>管理配置档案</button></div>
    </AppModal>
  </>);
}
