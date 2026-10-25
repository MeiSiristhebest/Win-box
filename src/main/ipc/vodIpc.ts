import type { IpcMainInvokeEvent } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import type { Logger, PlayResult, SearchAllProgressEvent } from '../../shared/types';
import { registerHandler } from '../util/ipcGuard';

/** Consumer-owned VOD contract; the IPC adapter does not depend on SpiderHost. */
export interface VodIpcPort {
  home(key: string, profileId?: string): Promise<unknown>;
  category(key: string, tid: string, pg: string, extend: Record<string, string>, profileId?: string): Promise<unknown>;
  detail(key: string, ids: string[], profileId?: string): Promise<unknown>;
  search(key: string, wd: string, profileId?: string): Promise<unknown>;
  searchAll(
    wd: string,
    options?: { refresh?: boolean; profileId?: string; profileIds?: string[] },
    onProgress?: (event: SearchAllProgressEvent) => void,
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
  registerHandler(IPC.VOD_SEARCH, (_event, args: { key: string; wd: string; profileId?: string }) =>
    host.search(args.key, args.wd, args.profileId), logger);
  registerHandler(IPC.VOD_SEARCH_ALL, async (event, value: {
    wd: string;
    refresh?: boolean;
    profileId?: string;
    profileIds?: string[];
  } | string) => {
    const args = typeof value === 'string' ? { wd: value, refresh: false } : value || { wd: '', refresh: false };
    const window = ports.windowForEvent(event);
    const onProgress = (progress: SearchAllProgressEvent): void => {
      try {
        window?.webContents.send(IPC.VOD_SEARCH_ALL_PROGRESS, progress);
      } catch {
        // The initiating window may close while the search continues.
      }
    };
    return host.searchAll(args.wd, {
      refresh: !!args.refresh,
      profileId: typeof args.profileId === 'string' ? args.profileId : undefined,
      profileIds: Array.isArray(args.profileIds) ? args.profileIds : undefined,
    }, onProgress);
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
