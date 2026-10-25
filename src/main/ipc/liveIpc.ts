import { IPC } from '../../shared/ipc-channels';
import type { EpgChannelRef, LiveBean, LiveEpgResult, LiveGroup, Logger } from '../../shared/types';
import type { LiveTemplateView } from '../../shared/plugin';
import type { LiveLoadResult } from '../live/LivePlaybackService';
import { registerHandler } from '../util/ipcGuard';

/** Consumer-owned live service contract; the IPC adapter does not depend on SpiderHost. */
export interface LiveIpcServicePort {
  load(index: number): Promise<LiveLoadResult>;
  readonly lives: LiveBean[];
  loadEpg(index: number, channels: EpgChannelRef[]): Promise<LiveEpgResult>;
  templates(): Promise<LiveTemplateView[]>;
  renderExport(templateId: string, groups: LiveGroup[]): Promise<LiveTemplateView & { content: string }>;
}

export interface LiveExportRequest {
  title: string;
  defaultName: string;
  extension: string;
}

/** Electron dialog and filesystem effects stay in the composition root. */
export interface LiveIpcPorts {
  chooseExportPath(event: unknown, request: LiveExportRequest): Promise<string | null>;
  writeExportFile(path: string, content: string): void;
}

export function registerLiveIpc(
  live: LiveIpcServicePort,
  ports: LiveIpcPorts,
  logger: Logger,
): void {
  registerHandler(IPC.LIVE_LOAD, (_event, index: number) => live.load(Number(index) || 0), logger);
  registerHandler(
    IPC.LIVE_EPG,
    (_event, args: { index: number; channels: EpgChannelRef[] }) =>
      live.loadEpg(Number(args?.index) || 0, Array.isArray(args?.channels) ? args.channels : []),
    logger,
  );
  registerHandler('live:meta', () => live.lives, logger);
  registerHandler(IPC.LIVE_TEMPLATES, () => live.templates(), logger);
  registerHandler(
    IPC.LIVE_RENDER,
    (_event, args: { templateId?: string; groups?: LiveGroup[] }) =>
      live.renderExport(String(args?.templateId || ''), Array.isArray(args?.groups) ? args.groups : []),
    logger,
  );
  registerHandler(
    IPC.LIVE_EXPORT,
    async (event, args: { templateId?: string; groups?: LiveGroup[]; defaultName?: string }) => {
      const rendered = await live.renderExport(
        String(args?.templateId || ''),
        Array.isArray(args?.groups) ? args.groups : [],
      );
      const path = await ports.chooseExportPath(event, {
        title: '导出直播线路',
        defaultName: args?.defaultName || `live.${rendered.ext}`,
        extension: rendered.ext,
      });
      if (!path) return { saved: false, path: '' };
      ports.writeExportFile(path, rendered.content);
      return { saved: true, path };
    },
    logger,
  );
}
