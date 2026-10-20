import { PlayerEngineSettings } from './PlayerEngineSettings';
import { useEffect, useState } from 'react';
import { client } from '../../api/client';
import { DEFAULT_PLAYER_SETTINGS, type MpvStatus, type PlayerSettings } from '../../../shared/player';
import { loadPlayerPrefs, savePlayerPrefs } from '../../lib/playerPrefs';
import { isEngineKernel, type KernelPref } from '../../lib/kernel';

export function PlaybackSettingsSection({ active, requestedSection = '' }: { active: boolean; requestedSection?: string }) {
  const [playPrefs, setPlayPrefs] = useState<PlayerSettings>({ ...DEFAULT_PLAYER_SETTINGS });
  const [playMsg, setPlayMsg] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);
  const [internalMode, setInternalMode] = useState<KernelPref>(() => loadPlayerPrefs().kernel);
  const [advancedOpen, setAdvancedOpen] = useState(() => ['mpv-kernel', 'bt-player', 'plugin-engines'].includes(requestedSection));
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  const selectInternalMode = (mode: KernelPref) => {
    if (!prefsLoaded) return;
    savePlayerPrefs({ kernel: mode });
    setInternalMode(mode);
    setPlayMsg({ text: '已保存，下次打开应用内播放器时生效', kind: 'ok' });
  };

  const toggleM3u8Purify = async (enabled: boolean) => {
    if (!prefsLoaded) return;
    try {
      const settings = await client.playerPrefsSet({ m3u8Purify: enabled });
      setPlayPrefs(settings);
      setPlayMsg({ text: enabled ? '已开启：播放点播时清除清单中的广告分段' : '已关闭', kind: 'ok' });
    } catch (error) {
      setPlayMsg({ text: `保存失败：${(error as Error).message}`, kind: 'err' });
    }
  };

  const [btPlayerDraft, setBtPlayerDraft] = useState<string | null>(null);
  const [btPlayers, setBtPlayers] = useState<Array<{ id: string; name: string; path: string }>>([]);
  const [btMsg, setBtMsg] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);
  const btPlayerValue = btPlayerDraft ?? playPrefs.btExternalPlayer;

  const detectBtPlayers = async () => {
    if (!prefsLoaded) return;
    try {
      const list = await client.btDetectPlayers();
      setBtPlayers(list);
      setBtMsg(list.length
        ? { text: '选择一个播放器即可保存', kind: 'ok' }
        : { text: '未检测到常见播放器：可安装 PotPlayer / VLC / mpv / MPC-HC，或手动粘贴播放器 exe 路径', kind: 'err' });
    } catch (error) {
      setBtMsg({ text: `检测失败：${(error as Error).message}`, kind: 'err' });
    }
  };

  const saveBtPlayer = async (path = btPlayerValue) => {
    if (!prefsLoaded) return;
    try {
      const settings = await client.playerPrefsSet({ btExternalPlayer: path.trim() });
      setPlayPrefs(settings);
      setBtPlayerDraft(null);
      setBtMsg({
        text: settings.btExternalPlayer
          ? '已保存：磁力的 MKV / HEVC 将用该播放器打开'
          : '已清空：恢复自动检测（PotPlayer → VLC → mpv → MPC-HC）',
        kind: 'ok',
      });
    } catch (error) {
      setBtMsg({ text: `保存失败：${(error as Error).message}`, kind: 'err' });
    }
  };

  const [vodPlayerDraft, setVodPlayerDraft] = useState<string | null>(null);
  const [vodPlayers, setVodPlayers] = useState<Array<{ id: string; name: string; path: string }>>([]);
  const [vodMsg, setVodMsg] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);
  const [vodBusy, setVodBusy] = useState(false);
  const vodPlayerValue = vodPlayerDraft ?? playPrefs.vodExternalPlayer;

  const toggleVodPlayerEnabled = async (enabled: boolean) => {
    if (!prefsLoaded) return;
    setVodBusy(true);
    try {
      let path = (vodPlayerDraft ?? playPrefs.vodExternalPlayer).trim();
      if (enabled && !path) {
        const players = await client.vodDetectPlayers();
        setVodPlayers(players);
        path = players[0]?.path || '';
      }
      const settings = await client.playerPrefsSet({ vodExternalPlayerEnabled: enabled, ...(enabled && path ? { vodExternalPlayer: path } : {}) });
      setPlayPrefs(settings);
      if (enabled && path) setVodPlayerDraft(null);
      setVodMsg(!enabled
        ? { text: '已改用应用内播放', kind: 'ok' }
        : path
          ? { text: '已启用：点播会直接打开所选播放器；无法接管时回到应用内播放', kind: 'ok' }
          : { text: '未检测到可用播放器。可安装 PotPlayer 后重新检测，或在下方填写路径；目前继续使用应用内播放。', kind: 'err' });
    } catch (error) {
      setVodMsg({ text: `保存失败：${(error as Error).message}`, kind: 'err' });
    } finally {
      setVodBusy(false);
    }
  };

  const detectVodPlayers = async () => {
    if (!prefsLoaded) return;
    setVodBusy(true);
    try {
      const list = await client.vodDetectPlayers();
      setVodPlayers(list);
      setVodMsg(list.length
        ? { text: '选择一个播放器即可保存；是否用于点播由上方开关决定', kind: 'ok' }
        : { text: '未检测到常见播放器：可安装 PotPlayer / VLC / mpv / MPC-HC，或手动粘贴播放器 exe 路径', kind: 'err' });
    } catch (error) {
      setVodMsg({ text: `检测失败：${(error as Error).message}`, kind: 'err' });
    } finally {
      setVodBusy(false);
    }
  };

  const saveVodPlayer = async (path = vodPlayerValue) => {
    if (!prefsLoaded) return;
    setVodBusy(true);
    try {
      const settings = await client.playerPrefsSet({ vodExternalPlayer: path.trim() });
      setPlayPrefs(settings);
      setVodPlayerDraft(null);
      setVodMsg({
        text: settings.vodExternalPlayer
          ? settings.vodExternalPlayerEnabled
            ? '已保存：点播将直接用该播放器播放，并会从历史位置续播'
            : '已保存路径；当前未启用外部播放器，点播仍用内置播放器'
          : '已清空：点播改用内置播放器',
        kind: 'ok',
      });
    } catch (error) {
      setVodMsg({ text: `保存失败：${(error as Error).message}`, kind: 'err' });
    } finally {
      setVodBusy(false);
    }
  };

  const [mpvDraft, setMpvDraft] = useState<string | null>(null);
  const [mpvStatus, setMpvStatus] = useState<MpvStatus | null>(null);
  const [mpvMsg, setMpvMsg] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    client.playerPrefsGet().then(settings => {
      if (!alive) return;
      setPlayPrefs(settings);
      setPrefsLoaded(true);
      setInternalMode(loadPlayerPrefs().kernel);
      if (settings.vodExternalPlayer) void client.vodDetectPlayers().then(players => { if (alive) setVodPlayers(players); }).catch(() => undefined);
    }).catch(() => { if (alive) setPlayMsg({ text: '播放设置读取失败，请重新打开此页后再保存', kind: 'err' }); });
    return () => { alive = false; };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    client.mpvStatus().then(status => { if (alive) setMpvStatus(status); }).catch(() => { if (alive) setMpvStatus({ available: false, path: '', source: 'none', note: '兼容播放组件检测失败，可先使用标准播放或外部播放器' }); });
    return () => { alive = false; };
  }, [active]);

  const saveMpvPath = async () => {
    if (!prefsLoaded) return;
    try {
      const settings = await client.playerPrefsSet({ mpvPath: (mpvDraft ?? playPrefs.mpvPath).trim() });
      setPlayPrefs(settings);
      setMpvDraft(null);
      const status = await client.mpvStatus();
      setMpvStatus(status);
      setMpvMsg({
        text: status.available ? `已保存：MPV 内核${status.note}` : `已保存，但该路径不可用：${status.note}`,
        kind: status.available ? 'ok' : 'err',
      });
    } catch (error) {
      setMpvMsg({ text: `保存失败：${(error as Error).message}`, kind: 'err' });
    }
  };

  if (!active) return null;

  return (
    <>
      <section className="card" id="cfg-playback-mode" style={{ padding: 16, marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 8px' }}>播放方式</h3>
        <p className="muted">不确定时保持“自动选择”，直接打开影片即可。应用会根据资源选用标准或兼容播放。</p>
        <label className="row" style={{ gap: 12 }}>
          <span>应用内播放</span>
          <select aria-label="应用内播放方式" value={internalMode} disabled={!prefsLoaded} onChange={event => selectInternalMode(event.target.value as KernelPref)}>
            <option value="auto">自动选择（推荐）</option>
            <option value="html5">标准播放</option>
            <option value="mpv" disabled={mpvStatus?.available === false}>兼容播放{mpvStatus?.available === false ? '（暂不可用）' : ''}</option>
            {isEngineKernel(internalMode) && <option value={internalMode}>已选插件播放方式</option>}
          </select>
        </label>
        <p className="muted">
          {internalMode === 'auto'
            ? '兼容播放可用时，标准播放失败会自动尝试，无需手动选择组件。'
            : internalMode === 'mpv'
              ? '适合特殊格式或标准播放有声无画的情况；继续使用应用内控制条、字幕和弹幕。'
              : internalMode === 'html5'
                ? '适合常见视频。若无法播放，可切回自动选择。'
                : '当前使用手动选择的插件；可切回自动选择。'}
        </p>
        {playMsg && <output className={playMsg.kind === 'err' ? 'err' : 'status'} style={{ display: 'block', marginTop: 8 }}>{playMsg.text}</output>}
      </section>

      <section className="card" id="cfg-vod-player" style={{ padding: 16, marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 8px' }}>外部播放器</h3>
        <p className="muted">习惯 PotPlayer 等播放器时启用。点播会直接打开它的独立窗口，请保持 Win-Box 运行。</p>
        <label className="row" style={{ gap: 8, marginBottom: 12 }}>
          <input type="checkbox" checked={playPrefs.vodExternalPlayerEnabled} disabled={vodBusy || !prefsLoaded} onChange={event => void toggleVodPlayerEnabled(event.target.checked)} />
          <span>启用点播外部播放器</span>
        </label>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" disabled={vodBusy || !prefsLoaded} onClick={() => void detectVodPlayers()}>{vodBusy ? '正在处理…' : '检测已安装的播放器'}</button>
          {vodPlayers.map(player => (
            <button type="button" disabled={vodBusy || !prefsLoaded} key={player.path} className="tag ui-action" title={player.path} aria-pressed={vodPlayerValue === player.path} onClick={() => void saveVodPlayer(player.path)}>
              {player.name}{vodPlayerValue === player.path ? ' ✓' : ''}
            </button>
          ))}
        </div>
        <p className="muted">
          {playPrefs.vodExternalPlayerEnabled && playPrefs.vodExternalPlayer ? '当前优先使用' + (vodPlayers.find(player => player.path === playPrefs.vodExternalPlayer)?.name || '已配置的外部播放器') + '；无法接管的资源会回到应用内播放。' : '当前使用应用内播放。'}
          {' '}外部播放器的实时进度暂时不会同步回观看历史。
        </p>
        <details>
          <summary>手动指定播放器路径</summary>
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <input aria-label="点播外部播放器路径" placeholder="选择未被检测到的播放器时，填写 exe 路径" value={vodPlayerValue} disabled={!prefsLoaded} style={{ flex: 1, minWidth: 0 }} onChange={event => setVodPlayerDraft(event.target.value)} />
            <button type="button" disabled={vodBusy || !prefsLoaded} onClick={() => void saveVodPlayer()}>保存路径</button>
          </div>
        </details>
        {vodMsg && <output className={vodMsg.kind === 'err' ? 'err' : 'status'} style={{ display: 'block', marginTop: 8 }}>{vodMsg.text}</output>}
      </section>

      <section className="card" id="cfg-m3u8-purify" style={{ padding: 16, marginBottom: 16 }}>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={playPrefs.m3u8Purify} disabled={!prefsLoaded} onChange={event => void toggleM3u8Purify(event.target.checked)} />
          <span>尝试跳过点播广告</span>
        </label>
        <p className="muted">只对部分分段视频有效。识别可能不准确，默认关闭。</p>
      </section>

      <details id="cfg-player-advanced" className="card" open={advancedOpen} onToggle={event => setAdvancedOpen(event.currentTarget.open)} style={{ padding: 16, marginBottom: 16 }}>
        <summary>高级：播放组件与磁力播放</summary>
        <dl>
          <dt>PotPlayer 等外部播放器</dt>
          <dd className="muted">独立的播放软件，使用它自己的界面和解码能力。接管播放时不需要另行启动应用内的 MPV 或兼容转码。</dd>
          <dt>MPV：应用内兼容播放</dt>
          <dd className="muted">作为应用内的兼容内核使用，保留 Win-Box 的播放控制和进度同步。通常使用随包版本。</dd>
          <dt>FFmpeg：后台兼容组件</dt>
          <dd className="muted">用于探测媒体信息、转换部分不兼容资源，按需运行，无需把它选作播放器。</dd>
        </dl>

        <section id="cfg-mpv-kernel" style={{ marginTop: 16 }}>
          <h4>应用内兼容播放组件</h4>
          <p className="muted" style={{ overflowWrap: 'anywhere' }}>
            {mpvStatus ? (mpvStatus.available ? '已就绪：' : '暂不可用：') + mpvStatus.note : '正在检查…'}
          </p>
          <div className="row" style={{ gap: 8 }}>
            <input aria-label="兼容播放组件路径" placeholder="自定义 mpv.exe 路径（留空使用随包版本）" value={mpvDraft ?? playPrefs.mpvPath} disabled={!prefsLoaded} style={{ flex: 1, minWidth: 0 }} onChange={event => setMpvDraft(event.target.value)} />
            <button type="button" disabled={!prefsLoaded} onClick={() => void saveMpvPath()}>保存路径</button>
          </div>
          {mpvMsg && <output className={mpvMsg.kind === 'err' ? 'err' : 'status'} style={{ display: 'block', marginTop: 8 }}>{mpvMsg.text}</output>}
        </section>

        <section id="cfg-bt-player" style={{ marginTop: 16 }}>
          <h4>磁力视频的外部播放器</h4>
          <p className="muted">内置播放无法处理磁力视频的格式时，交给这里的播放器。留空时自动检测，优先使用 PotPlayer；与点播设置分别保存。</p>
          <div className="row" style={{ gap: 8 }}>
            <input aria-label="磁力外部播放器路径" placeholder="播放器 exe 路径（留空自动检测）" value={btPlayerValue} disabled={!prefsLoaded} style={{ flex: 1, minWidth: 0 }} onChange={event => setBtPlayerDraft(event.target.value)} />
            <button type="button" disabled={!prefsLoaded} onClick={() => void saveBtPlayer()}>保存路径</button>
            <button type="button" disabled={!prefsLoaded} onClick={() => void detectBtPlayers()}>检测</button>
          </div>
          {btPlayers.length > 0 && <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {btPlayers.map(player => <button type="button" disabled={!prefsLoaded} key={player.path} className="tag ui-action" title={player.path} aria-pressed={btPlayerValue === player.path} onClick={() => void saveBtPlayer(player.path)}>{player.name}</button>)}
          </div>}
          {btMsg && <output className={btMsg.kind === 'err' ? 'err' : 'status'} style={{ display: 'block', marginTop: 8 }}>{btMsg.text}</output>}
        </section>
        {advancedOpen && <PlayerEngineSettings active={active} />}
      </details>
    </>
  );
}
