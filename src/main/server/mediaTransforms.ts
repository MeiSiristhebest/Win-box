/** Pure byte-level helpers used by proxy routes to recognize wrapped media and ranges. */

/** [off, off+188*3) contains MPEG-TS sync bytes at 188-byte intervals. */
export function isTsAligned(buf: Buffer, off: number): boolean {
  for (let k = 0; k < 4; k++) {
    const i = off + k * 188;
    if (i >= buf.length || buf[i] !== 0x47) return false;
  }
  return true;
}

/** Returns the JPEG prefix length when the image is followed by aligned MPEG-TS data. */
export function jpegPreludeLen(head: Buffer): number {
  if (head.length < 4 || head[0] !== 0xff || head[1] !== 0xd8) return 0;
  const eoi = head.indexOf(Buffer.from([0xff, 0xd9]), 2);
  if (eoi < 2) return 0;
  const offset = eoi + 2;
  return isTsAligned(head, offset) ? offset : 0;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** JPEG/PNG prefix or a trailing WebP TS_D chunk; require four TS sync bytes before stripping. */
export function imagePreludeLen(head: Buffer): number {
  if (head[0] === 0xff && head[1] === 0xd8) return jpegPreludeLen(head);
  if (head.length >= 20 && head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP') {
    const riffEnd = head.readUInt32LE(4) + 8;
    let imageSeen = false;
    for (let offset = 12; offset + 8 <= head.length && offset + 8 <= riffEnd;) {
      const kind = head.toString('ascii', offset, offset + 4);
      const length = head.readUInt32LE(offset + 4);
      const payload = offset + 8;
      const end = payload + length + (length & 1);
      if (end > riffEnd) return 0;
      if (kind === 'TS_D') {
        return imageSeen && length >= 188 * 4 && length % 188 === 0 && end === riffEnd && isTsAligned(head, payload) ? payload : 0;
      }
      if (end > head.length) return 0;
      if (kind === 'VP8 ' || kind === 'VP8L') imageSeen = true;
      offset = end;
    }
    return 0;
  }
  if (head.length < 33 || !head.subarray(0, 8).equals(PNG_SIGNATURE)) return 0;
  if (head.readUInt32BE(8) !== 13 || head.toString('ascii', 12, 16) !== 'IHDR') return 0;
  for (let offset = 8; offset + 12 <= head.length;) {
    const length = head.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > head.length) return 0;
    if (head.toString('ascii', offset + 4, offset + 8) === 'IEND') {
      return length === 0 && isTsAligned(head, end) ? end : 0;
    }
    offset = end;
  }
  return 0;
}

/** Parse one bytes=start-end or bytes=start- range; multiple or malformed ranges return null. */
export function parseByteRange(rangeHeader: string): { start: number; end: number | undefined } | null {
  const match = /^bytes\s*=\s*(\d+)\s*-\s*(\d*)\s*$/i.exec((rangeHeader || '').trim());
  if (!match) return null;
  const start = parseInt(match[1], 10);
  if (Number.isNaN(start)) return null;
  if (match[2] === '') return { start, end: undefined };
  const end = parseInt(match[2], 10);
  if (Number.isNaN(end) || end < start) return null;
  return { start, end };
}

/** Split [start, end] into contiguous, non-overlapping slices no larger than chunk. */
export function buildSlices(start: number, end: number, chunk: number): Array<{ start: number; end: number }> {
  const slices: Array<{ start: number; end: number }> = [];
  if (!(chunk > 0) || end < start) return slices;
  for (let offset = start; offset <= end; offset += chunk) {
    slices.push({ start: offset, end: Math.min(offset + chunk - 1, end) });
  }
  return slices;
}
