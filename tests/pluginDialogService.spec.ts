import { EventEmitter } from 'node:events';
import type { WebContents } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PluginDialogService } from '../src/main/plugin/PluginDialogService';
import { IPC } from '../src/shared/ipc-channels';
import type { PluginDialogRequest } from '../src/shared/pluginDialog';

class Target extends EventEmitter {
  id = 42;
  send = vi.fn();
  isDestroyed = () => false;
}
const services: PluginDialogService[] = [];
function create(ready = true) {
  const target = new Target();
  const service = new PluginDialogService(() => target as unknown as WebContents, 1000);
  services.push(service);
  if (ready) service.markReady(target.id);
  return { target, service, request: () => target.send.mock.calls.find(call => call[0] === IPC.PLUGIN_DIALOG_REQUEST)?.[1] as PluginDialogRequest };
}
afterEach(() => { services.splice(0).forEach(service => service.dispose()); vi.useRealTimers(); });

describe('plugin dialogs', () => {
  it('waits for the main renderer and accepts its answer once', async () => {
    const h = create(false);
    const result = h.service.request('sample', 'confirm', 'proceed?');
    expect(h.target.send).not.toHaveBeenCalled();
    h.service.markReady(999);
    expect(h.target.send).not.toHaveBeenCalled();
    h.service.markReady(h.target.id);
    expect(h.request().pluginId).toBe('sample');
    h.service.reply(999, { id: h.request().id, accepted: true });
    h.service.reply(h.target.id, { id: h.request().id, accepted: true });
    h.service.reply(h.target.id, { id: h.request().id, accepted: false });
    await expect(result).resolves.toBe(true);
  });

  it('cancels active and queued dialogs when the renderer reloads', async () => {
    const h = create();
    const first = h.service.request('a', 'confirm', 'one');
    const second = h.service.request('a', 'confirm', 'two');
    h.target.emit('did-start-navigation', {}, 'file:///index.html', false, true);
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(false);
    expect(h.target.listenerCount('destroyed')).toBe(0);
  });

  it('keeps the bridge ready across same-document route changes', async () => {
    const h = create();
    const first = h.service.request('sample', 'confirm', 'first');
    const firstRequest = h.request();
    h.target.emit('did-start-navigation', {}, 'file:///index.html#/config', true, true);
    const second = h.service.request('sample', 'confirm', 'second');
    const requests = h.target.send.mock.calls.filter(call => call[0] === IPC.PLUGIN_DIALOG_REQUEST);
    expect(requests).toHaveLength(2);
    const secondRequest = requests[1][1] as PluginDialogRequest;
    h.service.reply(h.target.id, { id: firstRequest.id, accepted: true });
    h.service.reply(h.target.id, { id: secondRequest.id, accepted: false });
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(false);
  });

  it('times out and cancels the visible renderer prompt', async () => {
    vi.useFakeTimers();
    const h = create();
    const result = h.service.request('a', 'confirm', 'one');
    await vi.advanceTimersByTimeAsync(1001);
    await expect(result).resolves.toBe(false);
    expect(h.target.send).toHaveBeenCalledWith(IPC.PLUGIN_DIALOG_CANCEL, h.request().id);
  });

  it('bounds requests from one plugin and returns void for alerts', async () => {
    const h = create();
    for (let i = 0; i < 4; i++) void h.service.request('a', 'confirm', String(i));
    await expect(h.service.request('a', 'confirm', 'overflow')).resolves.toBe(false);
    const alert = h.service.request('b', 'alert', 'notice');
    const request = h.target.send.mock.calls.filter(call => call[0] === IPC.PLUGIN_DIALOG_REQUEST).at(-1)![1] as PluginDialogRequest;
    h.service.reply(h.target.id, { id: request.id, accepted: true });
    await expect(alert).resolves.toBeUndefined();
  });
});
