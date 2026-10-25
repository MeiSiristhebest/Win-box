export interface PlayerClipboardPort {
  writeText(text: string): Promise<void>;
}
