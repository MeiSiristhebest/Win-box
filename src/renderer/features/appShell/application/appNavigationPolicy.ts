export type AppBackAction =
  | { kind: 'history' }
  | { kind: 'close-window' }
  | { kind: 'navigate-home'; path: string };

export interface AppBackContext {
  historyLength: number;
  auxiliaryWindow: boolean;
  homePath: string;
}

export interface AppBackShortcutContext {
  key: string;
  altKey: boolean;
  composing: boolean;
  typingTarget: boolean;
  modalOpen: boolean;
  pathname: string;
  homePath: string;
}

export function appHomePath(showDiscover: boolean): string {
  return showDiscover ? '/' : '/home';
}

export function decideAppBackAction(context: AppBackContext): AppBackAction {
  if (context.historyLength > 1) return { kind: 'history' };
  if (context.auxiliaryWindow) return { kind: 'close-window' };
  return { kind: 'navigate-home', path: context.homePath };
}

export function shouldHandleAppBackShortcut(context: AppBackShortcutContext): boolean {
  if (context.modalOpen || context.composing || context.typingTarget || context.pathname === context.homePath) return false;
  return context.key === 'Backspace' || (context.altKey && context.key === 'ArrowLeft');
}
