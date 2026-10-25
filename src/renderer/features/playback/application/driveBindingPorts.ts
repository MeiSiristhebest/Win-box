export interface DriveBindingPromptPort {
  getCredentials(): Promise<Record<string, string>>;
  providerFromUrl(url: string): string | null;
}

export interface DriveBindingNavigationPort {
  openBindingSettings(): void | Promise<void>;
}
