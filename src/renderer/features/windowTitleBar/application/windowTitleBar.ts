export interface WindowTitleBarPort {
  loadAppIcon(): Promise<string>;
  readMaximized(): Promise<boolean>;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<boolean>;
  close(): Promise<void>;
}
