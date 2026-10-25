import type { PlayerClipboardPort } from '../application/playerClipboard';

export const playerClipboardAdapter: PlayerClipboardPort = {
  async writeText(text) {
    const clipboard = globalThis.navigator?.clipboard;
    if (!clipboard) throw new Error('Clipboard API is unavailable');
    await clipboard.writeText(text);
  },
};
