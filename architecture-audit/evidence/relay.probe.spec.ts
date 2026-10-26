import { describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import type { Server } from 'node:http';
const request = vi.hoisted(() => vi.fn());
vi.mock('undici', async original => ({ ...await original<typeof import('undici')>(), request }));
vi.mock('electron', () => ({ app: { getPath: () => process.env.TEMP || '.', isPackaged: false } }));
import { LocalProxyServer } from '../../src/main/server/LocalProxyServer';
it('terminates the downstream response when a streaming upstream fails after headers', async () => {
  const proxy = new LocalProxyServer({ i: () => undefined, w: () => undefined, e: () => undefined });
  await proxy.start(0);
  const address = (proxy as unknown as { server: Server }).server.address();
  if (!address || typeof address === 'string') throw new Error('No local listener');
  const body = new Readable({ read() {} });
  const controller = new AbortController();
  request.mockResolvedValue({ statusCode: 200, headers: { 'content-type': 'video/mp4' }, body });
  const send = setTimeout(() => body.push(Buffer.from('video-data')), 20);
  try {
    const response = await fetch('http://127.0.0.1:'+address.port+'/play?url=https%3A%2F%2Faudit.test%2Fvideo', { headers: { Range: 'bytes=1-' }, signal: controller.signal });
    const downstream = response.text().then(() => 'ended', () => 'failed');
    body.destroy(new Error('audit upstream failed mid-stream'));
    const outcome = await Promise.race([downstream, new Promise(resolveWait => setTimeout(() => resolveWait('pending'), 300))]);
    console.log('AUDIT_RELAY_MIDSTREAM', outcome);
    expect(outcome).not.toBe('pending');
  } finally {
    clearTimeout(send); controller.abort(); body.destroy(); proxy.stop();
  }
});
