import assert from 'node:assert/strict';

function element(bytes, offset) {
  const width = position => {
    const first = bytes[position];
    for (let size = 1; size <= 8; size++) if (first & (1 << (8 - size))) return size;
    throw new Error('Invalid WebM element');
  };
  const idWidth = width(offset);
  assert.ok(idWidth <= 4 && offset + idWidth < bytes.length, 'Invalid WebM ID');
  const id = bytes.readUIntBE(offset, idWidth);
  const sizeStart = offset + idWidth;
  const sizeWidth = width(sizeStart);
  assert.ok(sizeStart + sizeWidth <= bytes.length, 'Truncated WebM size');
  let size = BigInt(bytes[sizeStart] & ((1 << (8 - sizeWidth)) - 1));
  for (let i = 1; i < sizeWidth; i++) size = (size << 8n) | BigInt(bytes[sizeStart + i]);
  const unknown = size === (1n << BigInt(sizeWidth * 7)) - 1n;
  const data = sizeStart + sizeWidth;
  const end = unknown ? bytes.length : data + Number(size);
  assert.ok(end >= data && end <= bytes.length, 'Truncated WebM payload');
  return { id, offset, sizeStart, sizeWidth, unknown, data, end };
}

function encodeSize(size, width) {
  assert.ok(BigInt(size) < (1n << BigInt(width * 7)) - 1n, 'WebM size overflow');
  let value = BigInt(size) | (1n << BigInt(width * 7));
  const encoded = Buffer.alloc(width);
  for (let i = width - 1; i >= 0; i--) { encoded[i] = Number(value & 255n); value >>= 8n; }
  return encoded;
}

/** MediaRecorder omits Duration; add it so the generated VOD fixture has a finite seekable timeline. */
export function withWebmDuration(input, milliseconds) {
  assert.ok(Number.isFinite(milliseconds) && milliseconds > 0, 'Invalid fixture duration');
  const bytes = Buffer.from(input);
  let segment;
  for (let offset = 0; offset < bytes.length;) {
    const item = element(bytes, offset);
    if (item.id === 0x18538067) { segment = item; break; }
    offset = item.end;
  }
  assert.ok(segment, 'WebM Segment missing');
  let info;
  for (let offset = segment.data; offset < segment.end;) {
    const item = element(bytes, offset);
    if (item.id === 0x1549a966) { info = item; break; }
    offset = item.end;
  }
  assert.ok(info && !info.unknown, 'WebM Info missing');
  let scale = 1_000_000;
  const parts = [];
  for (let offset = info.data; offset < info.end;) {
    const item = element(bytes, offset);
    if (item.id === 0x2ad7b1) scale = bytes.readUIntBE(item.data, item.end - item.data);
    if (item.id !== 0x4489) parts.push(bytes.subarray(item.offset, item.end));
    offset = item.end;
  }
  assert.ok(scale > 0, 'Invalid WebM timecode scale');
  const duration = Buffer.from([0x44, 0x89, 0x88, 0, 0, 0, 0, 0, 0, 0, 0]);
  duration.writeDoubleBE(milliseconds * 1_000_000 / scale, 3);
  const payload = Buffer.concat([...parts, duration]);
  const nextInfo = Buffer.concat([bytes.subarray(info.offset, info.sizeStart), encodeSize(payload.length, info.sizeWidth), payload]);
  const output = Buffer.concat([bytes.subarray(0, info.offset), nextInfo, bytes.subarray(info.end)]);
  if (!segment.unknown) encodeSize(segment.end - segment.data + output.length - bytes.length, segment.sizeWidth).copy(output, segment.sizeStart);
  return output;
}
