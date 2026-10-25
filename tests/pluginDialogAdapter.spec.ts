import { describe, expect, it, vi } from 'vitest';
import { createPluginDialogAdapter } from '../src/renderer/features/plugins/adapters/pluginDialogAdapter';
import type { PluginDialogRequest } from '../src/shared/pluginDialog';

describe('plugin dialog adapter', () => {
  it('subscribes before announcing readiness and disposes both listeners', () => {
    const unsubscribeRequest = vi.fn();
    const unsubscribeCancel = vi.fn();
    const onDialog = vi.fn((_listener: (request: PluginDialogRequest) => void) => unsubscribeRequest);
    const onDialogCancel = vi.fn((_listener: (id: string) => void) => unsubscribeCancel);
    const dialogReady = vi.fn();
    const api: Pick<Window['api']['plugins'], 'onDialog' | 'onDialogCancel' | 'dialogReady' | 'replyDialog'> = {
      onDialog,
      onDialogCancel,
      dialogReady,
      replyDialog: vi.fn(),
    };
    const port = createPluginDialogAdapter(() => api);
    const onRequest = vi.fn<(request: PluginDialogRequest) => void>();
    const onCancel = vi.fn<(id: string) => void>();

    const disconnect = port.connect(onRequest, onCancel);

    expect(onDialog).toHaveBeenCalledWith(onRequest);
    expect(onDialogCancel).toHaveBeenCalledWith(onCancel);
    expect(dialogReady).toHaveBeenCalledOnce();
    expect(dialogReady.mock.invocationCallOrder[0]).toBeGreaterThan(onDialogCancel.mock.invocationCallOrder[0]!);

    disconnect?.();
    expect(unsubscribeRequest).toHaveBeenCalledOnce();
    expect(unsubscribeCancel).toHaveBeenCalledOnce();
  });

  it('forwards replies and stays inert when the bridge is unavailable', () => {
    const api: Pick<Window['api']['plugins'], 'onDialog' | 'onDialogCancel' | 'dialogReady' | 'replyDialog'> = {
      onDialog: vi.fn(), onDialogCancel: vi.fn(), dialogReady: vi.fn(), replyDialog: vi.fn(),
    };
    const port = createPluginDialogAdapter(() => api);
    port.reply({ id: 'req-1', accepted: true });
    expect(api.replyDialog).toHaveBeenCalledWith({ id: 'req-1', accepted: true });

    const unavailable = createPluginDialogAdapter(() => undefined);
    expect(unavailable.connect(vi.fn(), vi.fn())).toBeNull();
    unavailable.reply({ id: 'req-2', accepted: false });
  });
});
