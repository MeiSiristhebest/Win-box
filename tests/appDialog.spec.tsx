// @vitest-environment happy-dom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { AppDialogProvider, AppModal, useAppDialog } from '../src/renderer/components/AppDialog';
import { isNativeModalOpen } from '../src/renderer/lib/modalScope';

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
let showModalCalls = 0;

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) { showModalCalls += 1; this.setAttribute('open', ''); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) { this.removeAttribute('open'); },
  });
});

afterAll(() => {
  if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShowModal);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});

afterEach(() => cleanup());

function QueueHarness({ results }: { results: string[] }) {
  const dialog = useAppDialog();
  return (
    <button onClick={() => {
      void dialog.confirm('第一个确认').then((value) => results.push(`first:${value}`));
      void dialog.confirm('第二个确认').then((value) => results.push(`second:${value}`));
    }}>
      打开队列
    </button>
  );
}

describe('AppDialogProvider', () => {
  it('queues confirmations and resolves each request exactly once', async () => {
    showModalCalls = 0;
    const results: string[] = [];
    render(<AppDialogProvider><QueueHarness results={results} /></AppDialogProvider>);
    fireEvent.click(screen.getByRole('button', { name: '打开队列' }));

    expect(screen.getByRole('alertdialog').textContent).toContain('第一个确认');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '确定' }));
    expect(showModalCalls).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(screen.getByRole('alertdialog').textContent).toContain('第二个确认');
    expect(showModalCalls).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: '确定' }));

    await act(async () => { await Promise.resolve(); });
    expect(results).toEqual(['first:true', 'second:true']);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('resolves active and queued requests as cancelled on provider unmount', async () => {
    const outcomes: boolean[] = [];
    function Harness() {
      const dialog = useAppDialog();
      const request = () => {
        void dialog.confirm('active').then((value) => outcomes.push(value));
        void dialog.confirm('queued').then((value) => outcomes.push(value));
      };
      return <button onClick={request}>启动</button>;
    }
    const view = render(<AppDialogProvider><Harness /></AppDialogProvider>);
    fireEvent.click(screen.getByRole('button', { name: '启动' }));
    view.unmount();

    await act(async () => { await Promise.resolve(); });
    expect(outcomes).toEqual([false, false]);
  });

  it('cancels a caller’s active and queued requests when its route unmounts', async () => {
    const outcomes: boolean[] = [];
    function RouteCaller() {
      const dialog = useAppDialog();
      const request = () => {
        void dialog.confirm('active route prompt').then((value) => outcomes.push(value));
        void dialog.confirm('queued route prompt').then((value) => outcomes.push(value));
      };
      return <button onClick={request}>启动路由提示</button>;
    }

    const view = render(<AppDialogProvider><RouteCaller /></AppDialogProvider>);
    fireEvent.click(screen.getByRole('button', { name: '启动路由提示' }));
    expect(screen.getByRole('alertdialog').textContent).toContain('active route prompt');
    view.rerender(<AppDialogProvider>{null}</AppDialogProvider>);
    await act(async () => { await Promise.resolve(); });

    expect(outcomes).toEqual([false, false]);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('Escape cancellation resolves the active confirmation as false', async () => {
    const outcomes: boolean[] = [];
    function Harness() {
      const dialog = useAppDialog();
      return <button onClick={() => { void dialog.confirm('取消?').then((value) => outcomes.push(value)); }}>打开</button>;
    }
    render(<AppDialogProvider><Harness /></AppDialogProvider>);
    fireEvent.click(screen.getByRole('button', { name: '打开' }));
    const dialog = screen.getByRole('alertdialog');
    const cancel = new Event('cancel', { cancelable: true });
    await act(async () => { dialog.dispatchEvent(cancel); });

    expect(cancel.defaultPrevented).toBe(true);
    expect(outcomes).toEqual([false]);
  });

  it('focuses the cancel action first for a dangerous confirmation', async () => {
    function Harness() {
      const dialog = useAppDialog();
      return <button onClick={() => { void dialog.confirm('删除数据？', { tone: 'danger' }); }}>删除</button>;
    }

    render(<AppDialogProvider><Harness /></AppDialogProvider>);
    fireEvent.click(screen.getByRole('button', { name: '删除' }));

    expect(document.activeElement).toBe(screen.getByRole('button', { name: '取消' }));
  });

  it('moves focus to the page fallback when the opener is removed before the dialog closes', async () => {
    let removeTrigger = () => {};
    function Harness() {
      const dialog = useAppDialog();
      const [showTrigger, setShowTrigger] = useState(true);
      removeTrigger = () => setShowTrigger(false);
      return (
        <main>
          <button data-dialog-focus-fallback>配置入口</button>
          {showTrigger && <button onClick={() => { void dialog.confirm('确认操作'); }}>打开确认</button>}
        </main>
      );
    }

    render(<AppDialogProvider><Harness /></AppDialogProvider>);
    const opener = screen.getByRole('button', { name: '打开确认' });
    opener.focus();
    fireEvent.click(opener);
    act(() => removeTrigger());
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    await act(async () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())));

    expect(document.activeElement).toBe(screen.getByRole('button', { name: '配置入口' }));
  });

  it('provides the same modal lifecycle for content dialogs and blocks close while busy', async () => {
    let closeCount = 0;
    render(
      <AppModal
        open
        titleId="form-title"
        canClose={false}
        onClose={() => { closeCount += 1; }}
      >
        <h2 id="form-title">命名项目</h2>
        <input aria-label="项目名称" />
      </AppModal>,
    );

    const modal = screen.getByRole('dialog', { name: '命名项目' });
    expect(isNativeModalOpen()).toBe(true);
    const cancel = new Event('cancel', { cancelable: true });
    await act(async () => { modal.dispatchEvent(cancel); });
    expect(cancel.defaultPrevented).toBe(true);
    expect(closeCount).toBe(0);
    expect(isNativeModalOpen()).toBe(true);
  });

  it('closes content dialogs only when a backdrop click lands outside the dialog bounds', async () => {
    let open = true;
    const onClose = vi.fn(() => { open = false; });
    const view = render(
      <AppModal
        open={open}
        titleId="backdrop-title"
        closeOnBackdrop
        onClose={onClose}
      >
        <h2 id="backdrop-title">图片预览</h2>
      </AppModal>,
    );
    const modal = screen.getByRole('dialog', { name: '图片预览' });
    Object.defineProperty(modal, 'getBoundingClientRect', {
      value: () => ({ left: 20, top: 20, right: 220, bottom: 140 }),
    });

    fireEvent.click(modal, { clientX: 80, clientY: 70 });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(modal, { clientX: 10, clientY: 10 });
    expect(onClose).toHaveBeenCalledOnce();
    view.unmount();
  });
});
