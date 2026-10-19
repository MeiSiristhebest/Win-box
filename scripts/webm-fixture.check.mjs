import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withWebmDuration } from './webm-fixture.mjs';

const info = Buffer.from([0x15, 0x49, 0xa9, 0x66, 0x87, 0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40]);
const cluster = Buffer.from([0x1f, 0x43, 0xb6, 0x75, 0x80]);
const segment = Buffer.from([0x18, 0x53, 0x80, 0x67]);

test('adds one finite duration to a MediaRecorder segment without changing cluster bytes', () => {
  const source = Buffer.concat([segment, Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), info, cluster]);
  const output = withWebmDuration(source, 14000);
  const duration = output.indexOf(Buffer.from([0x44, 0x89, 0x88]));
  assert.equal(output.readDoubleBE(duration + 3), 14000);
  assert.deepEqual(output.subarray(-cluster.length), cluster);
  const updated = withWebmDuration(output, 16000);
  assert.equal(updated.length, output.length);
  assert.equal(updated.readDoubleBE(duration + 3), 16000);
});

test('updates a finite Segment size and refuses malformed data', () => {
  const source = Buffer.concat([segment, Buffer.from([0x80 + info.length + cluster.length]), info, cluster]);
  const output = withWebmDuration(source, 10000);
  assert.equal(output[4] & 0x7f, output.length - 5);
  assert.throws(() => withWebmDuration(Buffer.from([0]), 1));
  assert.throws(() => withWebmDuration(source, Infinity));
});
