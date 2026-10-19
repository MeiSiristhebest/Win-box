// @vitest-environment happy-dom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AppDialogProvider } from '../src/renderer/components/AppDialog';
import { PluginDialogBridge } from '../src/renderer/features/plugins/PluginDialogBridge';
import type { PluginDialogRequest } from '../src/shared/pluginDialog';

const showModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute('open'); } });
});
afterAll(() => {
  if (showModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', showModal); else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  if (close) Object.defineProperty(HTMLDialogElement.prototype, 'close', close); else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function harness() {
  let receive!: (request: PluginDialogRequest) => void;
  let cancel!: (id: string) => void;
  const plugins = {
    replyDialog: vi.fn(), dialogReady: vi.fn(),
    onDialog: vi.fn((listener: typeof receive) => { receive = listener; return vi.fn(); }),
    onDialogCancel: vi.fn((listener: typeof cancel) => { cancel = listener; return vi.fn(); }),
  };
  Object.defineProperty(window, 'api', { configurable: true, value: { plugins } });
  const view = render(<AppDialogProvider><PluginDialogBridge /></AppDialogProvider>);
  return { plugins, view, receive: (request: PluginDialogRequest) => act(() => receive(request)), cancel: (id: string) => act(() => cancel(id)) };
}

describe('plugin application dialogs', () => {
  it('renders plugin identity and text safely and replies through the narrow API', async () => {
    const h = harness();
    expect(h.plugins.dialogReady).toHaveBeenCalledOnce();
    h.receive({ id: '1', pluginId: 'sample', op: 'confirm', title: '请求', message: '<img src=x onerror=alert(1)>' });
    expect(screen.getByRole('alertdialog').textContent).toContain('sample · 请求');
    expect(screen.getByRole('alertdialog').querySelector('img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    await act(async () => { await Promise.resolve(); });
    expect(h.plugins.replyDialog).toHaveBeenCalledWith({ id: '1', accepted: true });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('removes a canceled request without approving it and advances the shared queue', async () => {
    const h = harness();
    h.receive({ id: '1', pluginId: 'sample', op: 'confirm', message: 'one' });
    h.receive({ id: '2', pluginId: 'sample', op: 'confirm', message: 'two' });
    h.cancel('1');
    expect(screen.getByRole('alertdialog').textContent).toContain('two');
    await act(async () => { await Promise.resolve(); });
    expect(h.plugins.replyDialog).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await act(async () => { await Promise.resolve(); });
    expect(h.plugins.replyDialog).toHaveBeenCalledWith({ id: '2', accepted: false });
  });
});
