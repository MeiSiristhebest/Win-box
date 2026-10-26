import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import type { Logger, PlayResult, SearchAllProgressEvent } from '../../shared/types';
import { registerHandler } from '../util/ipcGuard';

/** Consumer-owned VOD contract; the IPC adapter does not depend on SpiderHost. */
export interface VodIpcPort {
  home(key: string, profileId?: string): Promise<unknown>;
  category(key: string, tid: string, pg: string, extend: Record<string, string>, profileId?: string): Promise<unknown>;
  detail(key: string, ids: string[], profileId?: string): Promise<unknown>;
  search(key: string, wd: string, profileId?: string, signal?: AbortSignal): Promise<unknown>;
  searchAll(
    wd: string,
    options?: { refresh?: boolean; profileId?: string; profileIds?: string[] },
    onProgress?: (event: SearchAllProgressEvent) => void,
    signal?: AbortSignal,
  ): Promise<unknown>;
  play(key: string, flag: string, id: string, profileId?: string, parseOffset?: number): Promise<PlayResult>;
}
interface ProgressWindow {
  webContents: { send(channel: string, payload: unknown): void };
}

export interface VodIpcPorts {
  windowForEvent(event: IpcMainInvokeEvent): ProgressWindow | null;
  writeClipboard(text: string): void;
}

export function registerVodIpc(host: VodIpcPort, ports: VodIpcPorts, logger: Logger): void {
  const activeSearches = new Map<string, AbortController>();
  const requestKey = (senderId: number, requestId: unknown): string | null =>
    typeof requestId === 'string' && requestId.length > 0 && requestId.length <= 160
      ? `${senderId}:${requestId}`
      : null;
  const cancelSearch = (event: IpcMainEvent, requestId: unknown): void => {
    const key = requestKey(event.sender.id, requestId);
    if (key) activeSearches.get(key)?.abort(new Error('搜索已由调用窗口取消'));
  };
  const withSearchCancellation = async <T>(
    event: IpcMainInvokeEvent,
    requestId: unknown,
    run: (signal?: AbortSignal) => Promise<T>,
  ): Promise<T> => {
    const key = requestKey(event.sender.id, requestId);
    if (!key) return run();

    const controller = new AbortController();
    const previous = activeSearches.get(key);
    previous?.abort(new Error('搜索请求标识重复'));
    activeSearches.set(key, controller);
    const cancelWhenSenderDestroyed = (): void => controller.abort(new Error('搜索窗口已关闭'));
    event.sender.once('destroyed', cancelWhenSenderDestroyed);
    try {
      return await run(controller.signal);
    } finally {
      if (activeSearches.get(key) === controller) activeSearches.delete(key);
      event.sender.removeListener('destroyed', cancelWhenSenderDestroyed);
    }
  };

  ipcMain.on(IPC.VOD_SEARCH_CANCEL, cancelSearch);
  ipcMain.on(IPC.VOD_SEARCH_ALL_CANCEL, cancelSearch);

  registerHandler(IPC.VOD_HOME, (_event, args: { key: string; profileId?: string }) =>
    host.home(args.key, args.profileId), logger);
  registerHandler(IPC.VOD_CATEGORY, (_event, args: {
    key: string;
    tid: string;
    pg: string;
    extend?: Record<string, string>;
    profileId?: string;
  }) => host.category(args.key, args.tid, args.pg, args.extend || {}, args.profileId), logger);
  registerHandler(IPC.VOD_DETAIL, (_event, args: { key: string; ids: string[]; profileId?: string }) =>
    host.detail(args.key, args.ids, args.profileId), logger);
  registerHandler(IPC.VOD_SEARCH, (event, args: { key: string; wd: string; profileId?: string; requestId?: string }) =>
    withSearchCancellation(event, args.requestId, (signal) => signal
      ? host.search(args.key, args.wd, args.profileId, signal)
      : host.search(args.key, args.wd, args.profileId)), logger);
  registerHandler(IPC.VOD_SEARCH_ALL, async (event, value: {
    wd: string;
    refresh?: boolean;
    profileId?: string;
    profileIds?: string[];
    requestId?: string;
  } | string) => {
    const args: { wd: string; refresh?: boolean; profileId?: string; profileIds?: string[]; requestId?: string } =
      typeof value === 'string' ? { wd: value, refresh: false } : value || { wd: '', refresh: false };
    const window = ports.windowForEvent(event);
    const onProgress = (progress: SearchAllProgressEvent): void => {
      try {
        window?.webContents.send(IPC.VOD_SEARCH_ALL_PROGRESS, progress);
      } catch {
        // The initiating window may close while the search continues.
      }
    };
    const options = {
      refresh: !!args.refresh,
      profileId: typeof args.profileId === 'string' ? args.profileId : undefined,
      profileIds: Array.isArray(args.profileIds) ? args.profileIds : undefined,
    };
    return withSearchCancellation(event, args.requestId, (signal) => signal
      ? host.searchAll(args.wd, options, onProgress, signal)
      : host.searchAll(args.wd, options, onProgress));
  }, logger);
  registerHandler(IPC.VOD_PLAY, async (_event, args: { key: string; flag: string; id: string; profileId?: string; parseOffset?: number }) => {
    const result = await host.play(args.key, args.flag, args.id, args.profileId, args.parseOffset);
    if (result.externalLink) {
      try {
        ports.writeClipboard(result.externalLink);
      } catch {
        // Clipboard failure must not discard the playback result.
      }
    }
    return result;
  }, logger);
}
