import { PlayerEngineSettings } from './PlayerEngineSettings';
import { isEngineKernel } from '../../lib/kernel';
import type { PlayerPreferencesPort } from '../playback/application/playerPreferences';
import type { PlayerEngineSettingsEventsPort, PlayerEngineSettingsPort } from './application/settingsSectionPorts';
import type { ExternalPlayerDiscoveryPort, MediaRuntimeManagementPort, MpvSettingsPort, PlayerSettingsPort } from './application/playbackSettingsPorts';
import { PlaybackCompatibilitySettingsSection } from './PlaybackCompatibilitySettingsSection';
import { useExternalPlayerSettings } from './useExternalPlayerSettings';
import { usePlaybackSettingsPresenter } from './usePlaybackSettingsPresenter';

interface PlaybackSettingsSectionProps {
  active: boolean;
  requestedSection?: string;
  preferences: PlayerPreferencesPort;
  engineSettings: PlayerEngineSettingsPort;
  engineEvents: PlayerEngineSettingsEventsPort;
  playerSettings: PlayerSettingsPort;
  externalPlayers: ExternalPlayerDiscoveryPort;
  mpvSettings: MpvSettingsPort;
  mediaRuntimes: MediaRuntimeManagementPort;
}

export function PlaybackSettingsSection({ active, requestedSection = '', preferences, engineSettings, engineEvents, playerSettings, externalPlayers, mpvSettings, mediaRuntimes }: PlaybackSettingsSectionProps) {
  const { model, actions } = usePlaybackSettingsPresenter({ active, requestedSection, preferences, playerSettings });
  const { settings: playPrefs, message: playMsg, internalMode, advancedOpen, settingsLoaded: prefsLoaded, mpvAvailable } = model;
  const externalSettings = useExternalPlayerSettings({
    active,
    settingsLoaded: prefsLoaded,
    settings: playPrefs,
    settingsWriter: playerSettings,
    discovery: externalPlayers,
    onSettingsSaved: actions.acceptSavedPlayerSettings,
  });

  if (!active) return null;

  return (
    <>
      <section className="card" id="cfg-playback-mode" style={{ padding: 16, marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 8px' }}>播放方式</h3>
        <p className="muted">不确定时保持“自动选择”，直接打开影片即可。应用会根据资源选用标准或兼容播放。</p>
        <label className="row" style={{ gap: 12 }}>
          <span>应用内播放</span>
          <select aria-label="应用内播放方式" value={internalMode} onChange={event => actions.selectInternalMode(event.target.value as typeof internalMode)}>
            <option value="auto">自动选择（推荐）</option>
            <option value="html5">标准播放</option>
            <option value="mpv" disabled={mpvAvailable === false}>兼容播放{mpvAvailable === false ? '（暂不可用）' : ''}</option>
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
          <input type="checkbox" checked={playPrefs.vodExternalPlayerEnabled} disabled={externalSettings.vod.busy || !prefsLoaded} onChange={event => void externalSettings.vod.toggleEnabled(event.target.checked)} />
          <span>启用点播外部播放器</span>
        </label>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" disabled={externalSettings.vod.busy || !prefsLoaded} onClick={() => void externalSettings.vod.detect()}>{externalSettings.vod.busy ? '正在处理…' : '检测已安装的播放器'}</button>
          {externalSettings.vod.players.map(player => (
            <button type="button" disabled={externalSettings.vod.busy || !prefsLoaded} key={player.path} className="tag ui-action" title={player.path} aria-pressed={externalSettings.vod.value === player.path} onClick={() => void externalSettings.vod.save(player.path)}>
              {player.name}{externalSettings.vod.value === player.path ? ' ✓' : ''}
            </button>
          ))}
        </div>
        <p className="muted">
          {playPrefs.vodExternalPlayerEnabled && playPrefs.vodExternalPlayer ? '当前优先使用' + (externalSettings.vod.players.find(player => player.path === playPrefs.vodExternalPlayer)?.name || '已配置的外部播放器') + '；只有需要 Win-Box 内部解析或授权的资源才会询问是否切回应用内播放。' : '当前使用应用内播放。'}
          {' '}外部播放器的实时进度暂时不会同步回观看历史。
        </p>
        <details>
          <summary>手动指定播放器路径</summary>
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <input aria-label="点播外部播放器路径" placeholder="填写 exe 路径；可直接粘贴带引号的路径" value={externalSettings.vod.value} disabled={!prefsLoaded} style={{ flex: 1, minWidth: 0 }} onChange={event => externalSettings.vod.setDraft(event.target.value)} />
            <button type="button" disabled={externalSettings.vod.busy || !prefsLoaded} onClick={() => void externalSettings.vod.save()}>保存路径</button>
          </div>
        </details>
        {externalSettings.vod.message && <output className={externalSettings.vod.message.kind === 'err' ? 'err' : 'status'} style={{ display: 'block', marginTop: 8 }}>{externalSettings.vod.message.text}</output>}
      </section>

      <section className="card" id="cfg-m3u8-purify" style={{ padding: 16, marginBottom: 16 }}>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={playPrefs.m3u8Purify} disabled={!prefsLoaded} onChange={event => void actions.toggleM3u8Purify(event.target.checked)} />
          <span>尝试跳过点播广告</span>
        </label>
        <p className="muted">只对部分分段视频有效。识别可能不准确，默认关闭。</p>
      </section>

      <details id="cfg-player-advanced" className="card" open={advancedOpen} onToggle={event => actions.setAdvancedSectionExpanded(event.currentTarget.open)} style={{ padding: 16, marginBottom: 16 }}>
        <summary>高级：播放组件与磁力播放</summary>
        <dl>
          <dt>PotPlayer 等外部播放器</dt>
          <dd className="muted">独立的播放软件，使用它自己的界面和解码能力。接管播放时不需要另行启动应用内的 MPV 或兼容转码。</dd>
          <dt>MPV：应用内兼容播放</dt>
          <dd className="muted">作为应用内的兼容内核使用，保留 Win-Box 的播放控制和进度同步。通常使用随包版本。</dd>
          <dt>FFmpeg：后台兼容组件</dt>
          <dd className="muted">用于探测媒体信息、转换部分不兼容资源，按需运行，无需把它选作播放器。</dd>
        </dl>

        <PlaybackCompatibilitySettingsSection
          active={active}
          settingsLoaded={prefsLoaded}
          settings={playPrefs}
          settingsReader={playerSettings}
          settingsWriter={playerSettings}
          statusQuery={mpvSettings}
          mediaRuntime={mediaRuntimes}
          onSettingsSaved={actions.acceptSavedPlayerSettings}
          onAvailabilityChange={actions.reportCompatibilityAvailability}
        />

        <section id="cfg-bt-player" style={{ marginTop: 16 }}>
          <h4>磁力视频的外部播放器</h4>
          <p className="muted">内置播放无法处理磁力视频的格式时，交给这里的播放器。留空时自动检测，优先使用 PotPlayer；与点播设置分别保存。</p>
          <div className="row" style={{ gap: 8 }}>
            <input aria-label="磁力外部播放器路径" placeholder="播放器 exe 路径（留空自动检测）" value={externalSettings.torrent.value} disabled={!prefsLoaded} style={{ flex: 1, minWidth: 0 }} onChange={event => externalSettings.torrent.setDraft(event.target.value)} />
            <button type="button" disabled={!prefsLoaded} onClick={() => void externalSettings.torrent.save()}>保存路径</button>
            <button type="button" disabled={!prefsLoaded} onClick={() => void externalSettings.torrent.detect()}>检测</button>
          </div>
          {externalSettings.torrent.players.length > 0 && <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {externalSettings.torrent.players.map(player => <button type="button" disabled={!prefsLoaded} key={player.path} className="tag ui-action" title={player.path} aria-pressed={externalSettings.torrent.value === player.path} onClick={() => void externalSettings.torrent.save(player.path)}>{player.name}</button>)}
          </div>}
          {externalSettings.torrent.message && <output className={externalSettings.torrent.message.kind === 'err' ? 'err' : 'status'} style={{ display: 'block', marginTop: 8 }}>{externalSettings.torrent.message.text}</output>}
        </section>
        {advancedOpen && <PlayerEngineSettings active={active} port={engineSettings} events={engineEvents} />}
      </details>
    </>
  );
}
