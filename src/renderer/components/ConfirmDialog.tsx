import { useCallback, useEffect, useId, useRef, useState } from 'react';

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string | null;
  destructive?: boolean;
}

/** App-styled replacement for the browser's blocking confirm box. */
export function useConfirmDialog() {
  const [request, setRequest] = useState<ConfirmDialogOptions | null>(null);
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const resolveRef = useRef<((confirmed: boolean) => void) | null>(null);

  const settle = useCallback((confirmed: boolean) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setRequest(null);
    if (dialogRef.current?.open) dialogRef.current.close();
    resolve?.(confirmed);
  }, []);

  const confirm = useCallback((options: ConfirmDialogOptions) => new Promise<boolean>((resolve) => {
    resolveRef.current?.(false);
    resolveRef.current = resolve;
    setRequest(options);
  }), []);

  useEffect(() => {
    if (request && dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
  }, [request]);

  useEffect(() => () => {
    resolveRef.current?.(false);
    resolveRef.current = null;
  }, []);

  const dialog = (
    <dialog
      className="app-confirm-dialog"
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-message`}
      onCancel={(event) => {
        event.preventDefault();
        settle(false);
      }}
      onClose={() => {
        if (!resolveRef.current) return;
        const resolve = resolveRef.current;
        resolveRef.current = null;
        setRequest(null);
        resolve(false);
      }}
      style={{
        width: 'min(460px, calc(100% - 40px))',
        padding: 0,
        border: '1px solid var(--border)',
        borderRadius: 12,
        background: 'var(--bg-elev2)',
        color: 'var(--text)',
        boxShadow: '0 12px 40px rgba(0,0,0,.35)',
      }}
    >
      {request && (
        <div className="card" style={{ padding: 18, margin: 0 }}>
          <div id={`${id}-title`} style={{ fontWeight: 600, marginBottom: 8 }}>{request.title}</div>
          <div id={`${id}-message`} className="muted" style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            {request.message}
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            {request.cancelLabel !== null && (
              <button autoFocus onClick={() => settle(false)}>{request.cancelLabel || '取消'}</button>
            )}
            <button
              autoFocus={request.cancelLabel === null}
              className={request.destructive ? undefined : 'primary'}
              style={request.destructive ? { background: 'var(--danger, #b3261e)', borderColor: 'var(--danger, #b3261e)', color: '#fff' } : undefined}
              onClick={() => settle(true)}
            >
              {request.confirmLabel || '确定'}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );

  return { confirm, dialog };
}
