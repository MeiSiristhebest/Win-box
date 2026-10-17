import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Button } from './ui/Button';

type DialogTone = 'default' | 'danger';

interface DialogOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
}

type ConfirmRequest = {
  id: number;
  owner: string;
  kind: 'confirm';
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: DialogTone;
  resolve: (accepted: boolean) => void;
};

type AlertRequest = {
  id: number;
  owner: string;
  kind: 'alert';
  title: string;
  message: string;
  confirmLabel: string;
  resolve: () => void;
};

type DialogRequest = ConfirmRequest | AlertRequest;

interface DialogApi {
  confirm: (message: string, options?: DialogOptions) => Promise<boolean>;
  alert: (message: string, options?: Pick<DialogOptions, 'title' | 'confirmLabel'>) => Promise<void>;
}

interface DialogQueueApi {
  confirmFor: (owner: string, message: string, options?: DialogOptions) => Promise<boolean>;
  alertFor: (owner: string, message: string, options?: Pick<DialogOptions, 'title' | 'confirmLabel'>) => Promise<void>;
  release: (owner: string) => void;
}

interface AppModalProps {
  open: boolean;
  titleId: string;
  descriptionId?: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
  role?: 'dialog' | 'alertdialog';
  closeOnBackdrop?: boolean;
  canClose?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

export function AppModal({
  open,
  titleId,
  descriptionId,
  children,
  onClose,
  className = 'app-dialog card modal-in',
  role = 'dialog',
  closeOnBackdrop = false,
  canClose = true,
  initialFocusRef,
}: AppModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    initialFocusRef?.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      if (returnFocus?.isConnected) return;
      window.requestAnimationFrame(() => {
        if (document.querySelector('dialog[open]')) return;
        const fallback = document.querySelector<HTMLElement>(
          '[data-dialog-focus-fallback], main [tabindex="0"], main button:not([disabled]), main a[href], main input:not([disabled])',
        );
        fallback?.focus();
      });
    };
  }, [open, initialFocusRef]);

  // Native dialog backdrop clicks are reported on the dialog element. Keyboard closing uses `cancel`.
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- native dialog backdrop clicks are reported on this element; keyboard closing uses cancel
    <dialog
      ref={dialogRef}
      className={className}
      role={role}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        if (canClose) onClose();
      }}
      onClick={(event) => {
        if (!closeOnBackdrop || !canClose || event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const outside = event.clientX < rect.left || event.clientX > rect.right
          || event.clientY < rect.top || event.clientY > rect.bottom;
        if (outside) onClose();
      }}
    >
      {children}
    </dialog>
  );
}

const DialogContext = createContext<DialogQueueApi | null>(null);

export function useAppDialog(): DialogApi {
  const queue = useContext(DialogContext);
  if (!queue) throw new Error('useAppDialog must be used inside AppDialogProvider');
  const owner = useId();
  useEffect(() => () => queue.release(owner), [queue, owner]);
  return useMemo(() => ({
    confirm: (message: string, options?: DialogOptions) => queue.confirmFor(owner, message, options),
    alert: (message: string, options?: Pick<DialogOptions, 'title' | 'confirmLabel'>) => queue.alertFor(owner, message, options),
  }), [queue, owner]);
}

export function AppDialogProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<DialogRequest | null>(null);
  const activeRef = useRef<DialogRequest | null>(null);
  const queueRef = useRef<DialogRequest[]>([]);
  const nextId = useRef(0);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const acceptRef = useRef<HTMLButtonElement>(null);

  const enqueue = useCallback((request: DialogRequest): void => {
    if (activeRef.current) {
      queueRef.current.push(request);
      return;
    }
    activeRef.current = request;
    setActive(request);
  }, []);

  const confirmFor = useCallback((owner: string, message: string, options: DialogOptions = {}) => new Promise<boolean>((resolve) => {
    enqueue({
      id: ++nextId.current,
      owner,
      kind: 'confirm',
      title: options.title || '请确认',
      message,
      confirmLabel: options.confirmLabel || '确定',
      cancelLabel: options.cancelLabel || '取消',
      tone: options.tone || 'default',
      resolve,
    });
  }), [enqueue]);

  const alertFor = useCallback((owner: string, message: string, options: Pick<DialogOptions, 'title' | 'confirmLabel'> = {}) => new Promise<void>((resolve) => {
    enqueue({
      id: ++nextId.current,
      owner,
      kind: 'alert',
      title: options.title || '提示',
      message,
      confirmLabel: options.confirmLabel || '知道了',
      resolve,
    });
  }), [enqueue]);

  const settle = useCallback((accepted: boolean): void => {
    const current = activeRef.current;
    if (!current) return;
    if (current.kind === 'confirm') current.resolve(accepted);
    else current.resolve();
    const next = queueRef.current.shift() || null;
    activeRef.current = next;
    setActive(next);
  }, []);

  const release = useCallback((owner: string): void => {
    const retained: DialogRequest[] = [];
    for (const request of queueRef.current) {
      if (request.owner === owner) {
        if (request.kind === 'confirm') request.resolve(false);
        else request.resolve();
      } else retained.push(request);
    }
    queueRef.current = retained;

    const current = activeRef.current;
    if (current?.owner !== owner) return;
    if (current.kind === 'confirm') current.resolve(false);
    else current.resolve();
    const next = queueRef.current.shift() || null;
    activeRef.current = next;
    setActive(next);
  }, []);

  useEffect(() => () => {
    const pending = [activeRef.current, ...queueRef.current];
    activeRef.current = null;
    queueRef.current = [];
    for (const request of pending) {
      if (!request) continue;
      if (request.kind === 'confirm') request.resolve(false);
      else request.resolve();
    }
  }, []);

  const api = useMemo(() => ({ confirmFor, alertFor, release }), [confirmFor, alertFor, release]);

  return (
    <DialogContext.Provider value={api}>
      {children}
      {active && (
        <AppModal
          key={active.id}
          open
          titleId={`app-dialog-title-${active.id}`}
          descriptionId={`app-dialog-message-${active.id}`}
          role={active.kind === 'confirm' ? 'alertdialog' : 'dialog'}
          closeOnBackdrop
          initialFocusRef={active.kind === 'confirm' && active.tone === 'danger' ? cancelRef : acceptRef}
          onClose={() => settle(false)}
        >
          <div className="app-dialog-heading">
            <span className="app-dialog-mark" aria-hidden="true">{active.kind === 'confirm' ? '?' : 'i'}</span>
            <h2 id={`app-dialog-title-${active.id}`}>{active.title}</h2>
          </div>
          <div className="app-dialog-message" id={`app-dialog-message-${active.id}`}>{active.message}</div>
          <div className="app-dialog-actions">
            {active.kind === 'confirm' && (
              <Button ref={cancelRef} variant="secondary" onClick={() => settle(false)}>{active.cancelLabel}</Button>
            )}
            <Button
              ref={acceptRef}
              variant={active.kind === 'confirm' && active.tone === 'danger' ? 'danger' : 'primary'}
              className="app-dialog-accept"
              onClick={() => settle(true)}
            >
              {active.confirmLabel}
            </Button>
          </div>
        </AppModal>
      )}
    </DialogContext.Provider>
  );
}
