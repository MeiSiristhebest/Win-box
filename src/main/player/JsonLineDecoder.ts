import { StringDecoder } from 'node:string_decoder';

const MAX_JSON_LINE_CHARS = 1024 * 1024;

/** Incrementally decode UTF-8 JSON-lines without coupling framing to player state. */
export class JsonLineDecoder {
  private decoder = new StringDecoder('utf8');
  private remainder = '';
  private discardUntilNewline = false;

  push(chunk: Buffer): unknown[] {
    let decoded = this.decoder.write(chunk);
    if (this.discardUntilNewline) {
      const newline = decoded.indexOf('\n');
      if (newline < 0) return [];
      decoded = decoded.slice(newline + 1);
      this.discardUntilNewline = false;
    }

    const lines = (this.remainder + decoded).split('\n');
    this.remainder = lines.pop() ?? '';

    const messages: unknown[] = [];
    for (const raw of lines) {
      if (raw.length > MAX_JSON_LINE_CHARS) continue;
      const line = raw.trim();
      if (!line) continue;
      try {
        messages.push(JSON.parse(line));
      } catch {
        // A malformed line is isolated; subsequent complete messages remain usable.
      }
    }

    if (this.remainder.length > MAX_JSON_LINE_CHARS) {
      this.remainder = '';
      this.discardUntilNewline = true;
    }
    return messages;
  }

  reset(): void {
    this.decoder.end();
    this.decoder = new StringDecoder('utf8');
    this.remainder = '';
    this.discardUntilNewline = false;
  }
}
