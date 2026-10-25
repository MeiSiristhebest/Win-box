export type DriveCredentials = Readonly<Record<string, string>>;

export interface DriveCredentialsPort {
  load(): Promise<DriveCredentials>;
  save(provider: string, cookie: string): Promise<void>;
  remove(provider: string): Promise<void>;
}

export interface DriveWebLoginPort {
  login(provider: string): Promise<void>;
}

export interface UcTvQrPollResult {
  state: 'wait' | 'ok' | 'expired' | 'error';
  hint?: string;
}

export interface UcTvTokenPort {
  status(): Promise<{ bound: boolean }>;
  createQr(): Promise<{ imageDataUrl: string }>;
  pollQr(): Promise<UcTvQrPollResult>;
  remove(): Promise<void>;
}

export interface DriveBindingPorts {
  credentials: DriveCredentialsPort;
  webLogin: DriveWebLoginPort;
  ucTvToken: UcTvTokenPort;
}
