export interface PlayerKeyboardShortcutEvent {
  key: string;
  repeat: boolean;
  targetIsEditable: boolean;
  preventDefault(): void;
}

export interface PlayerKeyboardShortcutListeners {
  onKeyDown(event: PlayerKeyboardShortcutEvent): void;
  onKeyUp(event: PlayerKeyboardShortcutEvent): void;
  onWindowBlur(): void;
}

export interface PlayerKeyboardEventsPort {
  subscribe(listeners: PlayerKeyboardShortcutListeners): () => void;
}

export interface PlayerKeyboardSchedulerPort {
  scheduleInterval(callback: () => void, milliseconds: number): unknown;
  cancelInterval(timer: unknown): void;
  scheduleTimeout(callback: () => void, milliseconds: number): unknown;
  cancelTimeout(timer: unknown): void;
}

export interface PlayerKeyboardModalGuardPort {
  hasBlockingModal(): boolean;
}

export interface PlayerKeyboardShortcutsPorts {
  events: PlayerKeyboardEventsPort;
  scheduler: PlayerKeyboardSchedulerPort;
  modalGuard: PlayerKeyboardModalGuardPort;
}
