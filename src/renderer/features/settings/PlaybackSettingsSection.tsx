import { PlayerEngineSettings } from './PlayerEngineSettings';
import { useEffect, useState } from 'react';
import { client } from '../../api/client';
import { DEFAULT_PLAYER_SETTINGS, type MpvStatus, type PlayerSettings } from '../../../shared/player';

export function PlaybackSettingsSection({ active }: { active: boolean }) {
  const [playPrefs, setPlayPrefs] = useState<PlayerSettings>({ ...DEFAULT_PLAYER_SETTINGS });
  const [playMsg, setPlayMsg] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);

  useEffect(() => {
    client.playerPrefsGet().then(setPlayPrefs).catch(() => undefined);
  }, []);

  const toggleM3u8Purify = async (enabled: boolean) => {
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
    try {
      const list = await client.btDetectPlayers();
      setBtPlayers(list);
      setBtMsg(list.length
        ? { text: `检测到 ${list.length} 个：${list.map((player) => player.name).join('、')}（点名字填入路径）`, kind: 'ok' }
        : { text: '未检测到常见播放器：可安装 PotPlayer / VLC / mpv / MPC-HC，或手动粘贴播放器 exe 路径', kind: 'err' });
    } catch (error) {
      setBtMsg({ text: `检测失败：${(error as Error).message}`, kind: 'err' });
    }
  };

  const saveBtPlayer = async () => {
    try {
      const settings = await client.playerPrefsSet({ btExternalPlayer: btPlayerValue.trim() });
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
  const vodPlayerValue = vodPlayerDraft ?? playPrefs.vodExternalPlayer;

  const toggleVodPlayerEnabled = async (enabled: boolean) => {
    try {
      const settings = await client.playerPrefsSet({ vodExternalPlayerEnabled: enabled });
      setPlayPrefs(settings);
      const path = (vodPlayerDraft ?? settings.vodExternalPlayer).trim();
      setVodMsg(!enabled
        ? { text: '已停用：点播一律用内置播放器（已填路径也不会用它）', kind: 'ok' }
        : path
          ? { text: '已启用：点播将直接用上面的播放器播放', kind: 'ok' }
          : { text: '已启用，但还没填播放器路径。请选择本机播放器或粘贴 exe 路径后保存。', kind: 'err' });
    } catch (error) {
      setVodMsg({ text: `保存失败：${(error as Error).message}`, kind: 'err' });
    }
  };

  const detectVodPlayers = async () => {
    try {
      const list = await client.vodDetectPlayers();
      setVodPlayers(list);
      setVodMsg(list.length
        ? { text: `检测到 ${list.length} 个：${list.map((player) => player.name).join('、')}（点名字填入路径）`, kind: 'ok' }
        : { text: '未检测到常见播放器：可安装 PotPlayer / VLC / mpv / MPC-HC，或手动粘贴播放器 exe 路径', kind: 'err' });
    } catch (error) {
      setVodMsg({ text: `检测失败：${(error as Error).message}`, kind: 'err' });
    }
  };

  const saveVodPlayer = async () => {
    try {
      const settings = await client.playerPrefsSet({ vodExternalPlayer: vodPlayerValue.trim() });
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
    }
  };

  const [mpvDraft, setMpvDraft] = useState<string | null>(null);
  const [mpvStatus, setMpvStatus] = useState<MpvStatus | null>(null);
  const [mpvMsg, setMpvMsg] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);

  useEffect(() => {
    client.mpvStatus().then(setMpvStatus).catch(() => setMpvStatus(null));
  }, []);

  const saveMpvPath = async () => {
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
      <PlayerEngineSettings active={active} />
      <div className="card" id="cfg-m3u8-purify" style={{ padding: 12, marginBottom: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={playPrefs.m3u8Purify} onChange={(event) => void toggleM3u8Purify(event.target.checked)} />
            <span style={{ fontWeight: 600 }}>m3u8 去广告</span>
          </label>
          <span className="muted" style={{ fontSize: 11 }}>
            点播清单播放前自动删掉广告分段（切片路径/域名、订阅规则、SCTE-35、切片时长特征）。
            启发式清洗，默认关闭；仅对点播生效，删到段才替换清单。
          </span>
          {playMsg && <span className={playMsg.kind === 'err' ? 'err' : 'status'} style={{ margin: 0 }}>{playMsg.text}</span>}
        </div>
      </div>

      <div className="card" id="cfg-bt-player" style={{ padding: 12, marginBottom: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontWeight: 600 }}>磁力外部播放器（MKV / HEVC）</span>
          <span className="muted" style={{ fontSize: 11 }}>
            磁力里的 MKV / HEVC 浏览器不能直接播：内置 BT 引擎边下边播时交给这里的播放器。留空 = 自动检测。
          </span>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <input
              placeholder="播放器 exe 路径（留空 = 自动检测 PotPlayer / VLC / mpv / MPC-HC）…"
              value={btPlayerValue}
              style={{ flex: 1 }}
              onChange={(event) => setBtPlayerDraft(event.target.value)}
            />
            <button className="primary" onClick={() => void saveBtPlayer()}>保存</button>
            <button onClick={() => void detectBtPlayers()}>检测</button>
          </div>
          {btPlayers.length > 0 && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {btPlayers.map((player) => (
                <button type="button" key={player.path} className="tag ui-action" title={player.path} aria-pressed={btPlayerValue === player.path} onClick={() => setBtPlayerDraft(player.path)}>
                  {player.name}
                </button>
              ))}
            </div>
          )}
          {btMsg && <span className={btMsg.kind === 'err' ? 'err' : 'status'} style={{ margin: 0 }}>{btMsg.text}</span>}
        </div>
      </div>

      <div className="card" id="cfg-vod-player" style={{ padding: 12, marginBottom: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontWeight: 600 }}>点播外部播放器（PotPlayer 等）</span>
          <span className="muted" style={{ fontSize: 11 }}>
            勾选后，点播使用所选播放器和本机中继。中继注入 header 与 cookie，历史续播使用上次位置。未勾选时使用内置播放器。
          </span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={playPrefs.vodExternalPlayerEnabled} onChange={(event) => void toggleVodPlayerEnabled(event.target.checked)} />
            <span>启用点播外部播放器</span>
          </label>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <input
              placeholder="播放器 exe 路径（点「检测」自动探测 PotPlayer / VLC / mpv / MPC-HC）…"
              value={vodPlayerValue}
              style={{ flex: 1 }}
              onChange={(event) => setVodPlayerDraft(event.target.value)}
            />
            <button className="primary" onClick={() => void saveVodPlayer()}>保存</button>
            <button onClick={() => void detectVodPlayers()}>检测</button>
          </div>
          {vodPlayers.length > 0 && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {vodPlayers.map((player) => (
                <button type="button" key={player.path} className="tag ui-action" title={player.path} aria-pressed={vodPlayerValue === player.path} onClick={() => setVodPlayerDraft(player.path)}>
                  {player.name}
                </button>
              ))}
            </div>
          )}
          {vodMsg && <span className={vodMsg.kind === 'err' ? 'err' : 'status'} style={{ margin: 0 }}>{vodMsg.text}</span>}
        </div>
      </div>

      <div className="card" id="cfg-mpv-kernel" style={{ padding: 12, marginBottom: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontWeight: 600 }}>MPV 播放内核（4K / HEVC / MKV）</span>
          <span className="muted" style={{ fontSize: 11 }}>
            播放器窗口支持 Chromium 不易处理的 MKV、4K HEVC 和 HDR。字幕、弹幕和控制条仍由界面显示。通常使用随应用附带的版本。
          </span>
          <span className={mpvStatus && !mpvStatus.available ? 'err' : 'status'} style={{ margin: 0, wordBreak: 'break-all' }}>
            {mpvStatus
              ? mpvStatus.available
                ? `可用：${mpvStatus.note}（${mpvStatus.path}）`
                : `不可用：${mpvStatus.note}`
              : '正在检测…'}
          </span>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <input
              placeholder="mpv.exe 路径覆盖（留空 = 用随包内置构建）…"
              value={mpvDraft ?? playPrefs.mpvPath}
              style={{ flex: 1 }}
              onChange={(event) => setMpvDraft(event.target.value)}
            />
            <button className="primary" onClick={() => void saveMpvPath()}>保存</button>
          </div>
          {mpvMsg && <span className={mpvMsg.kind === 'err' ? 'err' : 'status'} style={{ margin: 0, wordBreak: 'break-all' }}>{mpvMsg.text}</span>}
        </div>
      </div>
    </>
  );
}
