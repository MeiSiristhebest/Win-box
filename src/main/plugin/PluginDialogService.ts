import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import type { PluginDialogReply, PluginDialogRequest } from '../../shared/pluginDialog';

type Target = Pick<WebContents, 'id' | 'isDestroyed' | 'send' | 'on' | 'removeListener'>;

/** Replies are accepted only from the target window. Closing/reloading it cancels its requests. */
export class PluginDialogService {
  private pending = new Map<string, { target: Target; request: PluginDialogRequest; finish(accepted: boolean): void }>();
  private ready = new Map<number, { target: Target; cleanup(): void }>();

  constructor(private readonly target: () => Target | null, private readonly timeoutMs = 120_000) {}

  markReady(senderId: number): void {
    const target = this.target();
    if (!target || target.id !== senderId || target.isDestroyed() || this.ready.has(senderId)) return;
    const cancel = () => {
      this.ready.get(senderId)?.cleanup();
      this.ready.delete(senderId);
      for (const pending of this.pending.values()) if (pending.target.id === senderId) pending.finish(false);
    };
    const onNavigation = (_event: Electron.Event, _url: string, isInPlace: boolean, isMainFrame: boolean) => {
      if (isInPlace || !isMainFrame) return;
      cancel();
    };
    target.on('destroyed', cancel);
    target.on('did-start-navigation', onNavigation);
    this.ready.set(senderId, { target, cleanup: () => { target.removeListener('destroyed', cancel); target.removeListener('did-start-navigation', onNavigation); } });
    for (const pending of this.pending.values()) if (pending.target.id === senderId) this.send(pending);
  }

  request(pluginId: string, op: 'alert' | 'confirm', message: string, title?: string): Promise<boolean | void> {
    const target = this.target();
    if (!target || target.isDestroyed() || this.pending.size >= 16 || [...this.pending.values()].filter(item => item.request.pluginId === pluginId).length >= 4) return Promise.resolve(op === 'confirm' ? false : undefined);
    const request: PluginDialogRequest = { id: randomUUID(), pluginId: String(pluginId).slice(0, 100), op, message: String(message).slice(0, 16_000), title: title ? String(title).slice(0, 200) : undefined };
    return new Promise(resolve => {
      const timer = setTimeout(() => finish(false), this.timeoutMs);
      timer.unref();
      const finish = (accepted: boolean) => {
        if (!this.pending.delete(request.id)) return;
        clearTimeout(timer);
        try { if (!target.isDestroyed()) target.send(IPC.PLUGIN_DIALOG_CANCEL, request.id); } catch { /* Target closed. */ }
        resolve(op === 'confirm' ? accepted : undefined);
      };
      const pending = { target, request, finish };
      this.pending.set(request.id, pending);
      if (this.ready.has(target.id)) this.send(pending);
    });
  }

  reply(senderId: number, value: PluginDialogReply): void {
    if (!value || typeof value.id !== 'string' || typeof value.accepted !== 'boolean') return;
    const pending = this.pending.get(value.id);
    if (pending?.target.id === senderId) pending.finish(value.accepted);
  }

  dispose(): void {
    for (const value of this.pending.values()) value.finish(false);
    for (const value of this.ready.values()) value.cleanup();
    this.ready.clear();
  }

  private send(pending: { target: Target; request: PluginDialogRequest; finish(accepted: boolean): void }): void {
    try { pending.target.send(IPC.PLUGIN_DIALOG_REQUEST, pending.request); } catch { pending.finish(false); }
  }
}
