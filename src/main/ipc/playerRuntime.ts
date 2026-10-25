import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { EngineLaunchSpec } from '../player/PlayerEngineController';
import { isPlayerWindow, onPlayerWindowClosed } from '../player/PlayerWindow';
import { noteMediaState } from '../util/mediaDiag';
import { startPlayMemWatch } from '../util/memProbe';
import { registerHandler } from '../util/ipcGuard';
import type { Logger } from '../../shared/types';
import { IPC } from '../../shared/ipc-channels';
import type { PlayerEngineView } from '../../shared/plugin';
import type {
  MediaRuntimeId,
  MediaRuntimeStatus,
  MpvCommand,
  MpvStartOptions,
  MpvStatus,
  PlayerSettings,
  SrMode,
} from '../../shared/player';

interface PlaybackPluginPort {
  srShaders(mode: unknown): Promise<string[]>;
  playerEngines(): Promise<PlayerEngineView[]>;
  playerEngineSpec(id: string): Promise<EngineLaunchSpec | null>;
}

interface PlaybackSettingsPort {
  readonly settings: Pick<PlayerSettings, 'srMode' | 'engineEnabled'>;
  update(patch: Pick<Partial<PlayerSettings>, 'engineEnabled'>): PlayerSettings;
}

interface MpvRuntimePort {
  status(): MpvStatus;
  start(window: BrowserWindow, options: MpvStartOptions): Promise<{ session: number; path: string }>;
  command(command: MpvCommand): boolean;
  stop(): void;
  dispose(): void;
}

interface MediaRuntimePort {
  status(): MediaRuntimeStatus;
  install(runtime: MediaRuntimeId): Promise<MediaRuntimeStatus>;
  cancel(): boolean;
}

interface PlayerEnginePort {
  readonly running: boolean;
  readonly currentId: string;
  start(window: BrowserWindow, spec: EngineLaunchSpec, options: MpvStartOptions): Promise<{ session: number }>;
  command(command: MpvCommand): boolean;
  stop(): void;
  dispose(): void;
}

export interface PlayerRuntimeIpcDependencies {
  logger: Logger;
  mpv: MpvRuntimePort;
  mediaRuntimes: MediaRuntimePort;
  plugins: PlaybackPluginPort;
  settings: PlaybackSettingsPort;
  engines: PlayerEnginePort;
  onPlaybackStarted(): void;
  notifyPlayerWindowState(open: boolean): void;
}

function windowOf(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

/** Playback-runtime IPC adapter. Policies and state transitions remain in the runtime services. */
export function registerPlayerRuntimeIpc({
  logger,
  mpv,
  mediaRuntimes,
  plugins,
  settings,
  engines,
  onPlaybackStarted,
  notifyPlayerWindowState,
}: PlayerRuntimeIpcDependencies): void {
  app.on('before-quit', () => mediaRuntimes.cancel());

  registerHandler(IPC.MEDIA_RUNTIME_STATUS, () => mediaRuntimes.status(), logger);
  registerHandler(IPC.MEDIA_RUNTIME_INSTALL, async (_event: unknown, runtime: unknown) => {
    if (runtime !== 'mpv' && runtime !== 'ffmpeg') throw new Error('不支持的媒体组件');
    return mediaRuntimes.install(runtime);
  }, logger);
  registerHandler(IPC.MEDIA_RUNTIME_CANCEL, () => mediaRuntimes.cancel(), logger);
  registerHandler(IPC.MPV_STATUS, () => mpv.status(), logger);
  registerHandler(IPC.MPV_START, async (event: IpcMainInvokeEvent, options: MpvStartOptions) => {
    const window = windowOf(event);
    if (!window) throw new Error('播放器窗口不存在（mpv 无法嵌入）');
    const base = options || ({ url: '' } as MpvStartOptions);
    const shaders = await plugins.srShaders(settings.settings.srMode);
    return mpv.start(window, shaders.length ? { ...base, shaders } : base);
  }, logger);
  registerHandler(IPC.MPV_CMD, async (_event: unknown, command: MpvCommand) => {
    if (command?.type === 'sr-mode') {
      const shaders = await plugins.srShaders(command.value as SrMode);
      return { ok: mpv.command({ type: 'glsl-shaders', value: shaders }) };
    }
    return { ok: mpv.command(command) };
  }, logger);
  registerHandler(IPC.MPV_STOP, () => {
    mpv.stop();
    return { ok: true };
  }, logger);

  const listEngines = async (): Promise<PlayerEngineView[]> => {
    const status = mpv.status();
    const builtIn: PlayerEngineView[] = [
      {
        id: 'html5',
        pluginId: 'builtin',
        pluginName: '内置',
        label: '内置（HTML5）',
        capabilities: ['seek', 'rate', 'fit', 'tracks', 'subtitle'],
        ready: true,
      },
      {
        id: 'mpv',
        pluginId: 'builtin',
        pluginName: '内置',
        label: 'MPV（内置）',
        capabilities: ['seek', 'rate', 'fit', 'tracks', 'subtitle'],
        ready: status.available,
        ...(status.available ? { path: status.path } : { note: status.note }),
      },
    ];
    return [...builtIn, ...(await plugins.playerEngines())];
  };

  registerHandler(IPC.ENGINE_LIST, () => listEngines(), logger);
  registerHandler(IPC.ENGINE_STATUS, async (_event: unknown, id: string) => {
    const engine = (await listEngines()).find((candidate) => candidate.id === String(id || ''));
    return engine
      ? { id: engine.id, ready: engine.ready, path: engine.path, note: engine.note }
      : { id: String(id || ''), ready: false, note: '未找到该内核' };
  }, logger);
  registerHandler(IPC.ENGINE_ENABLE, (_event: unknown, args: { id?: string; enabled?: boolean }) => {
    const id = String(args?.id || '');
    if (!id) return { ok: false, reason: '参数不完整' };
    const enabled = !!args?.enabled;
    settings.update({ engineEnabled: { ...settings.settings.engineEnabled, [id]: enabled } });
    if (!enabled && engines.running && engines.currentId === id) engines.stop();
    return { ok: true };
  }, logger);
  registerHandler(IPC.ENGINE_START, async (event: IpcMainInvokeEvent, args: MpvStartOptions & { engineId?: string }) => {
    const window = windowOf(event);
    if (!window) throw new Error('播放器窗口不存在（引擎无法嵌入）');
    const id = String((args as { engineId?: unknown })?.engineId || '');
    if (!id.startsWith('engine:')) return { ok: false, reason: '该内核不是插件内核（无需 engine:start）' };
    if (settings.settings.engineEnabled[id] !== true) {
      return { ok: false, reason: '该内核未启用（请在配置页「插件播放内核」中开启）' };
    }
    const spec: EngineLaunchSpec | null = await plugins.playerEngineSpec(id);
    if (!spec) throw new Error('该内核未就绪（插件未安装 / 已停用 / 可执行文件缺失）');
    const options = { ...args } as MpvStartOptions & { engineId?: string };
    delete options.engineId;
    const result = await engines.start(window, spec, options);
    return { ok: true, session: result.session };
  }, logger);
  registerHandler(IPC.ENGINE_CMD, (_event: unknown, command: MpvCommand) => ({ ok: engines.command(command) }), logger);
  registerHandler(IPC.ENGINE_STOP, () => {
    engines.stop();
    return { ok: true };
  }, logger);

  onPlayerWindowClosed(() => mpv.dispose());
  onPlayerWindowClosed(() => engines.dispose());
  onPlayerWindowClosed(() => notifyPlayerWindowState(false));
  app.on('will-quit', () => {
    try {
      mpv.dispose();
    } catch {
      // Process may already be gone during application shutdown.
    }
  });

  ipcMain.on(IPC.MEDIA_STATE, (event, state: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const isPlayer = isPlayerWindow(window);
    noteMediaState(event.sender.id, isPlayer ? 'player' : window ? 'main' : 'gone', state);
    const eventType = (state && typeof state === 'object' ? (state as { event?: unknown }).event : '') as string;
    if (isPlayer && (eventType === 'play' || eventType === 'playing')) {
      startPlayMemWatch();
      onPlaybackStarted();
    }
  });
}
