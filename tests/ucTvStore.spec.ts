// tests/ucTvStore.spec.ts — UC TV Token 凭据存储（加解密落盘 + 解绑）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStore } from '../src/main/store/JsonStore';
import { UcTvStore } from '../src/main/store/UcTvStore';
import type { DriveCodec } from '../src/main/store/DriveStore';
import type { Logger } from '../src/shared/types';

const logger = { i: () => undefined, w: () => undefined, e: () => undefined, d: () => undefined } as unknown as Logger;
const file = (root: string): string => join(root, 'uc-tv-token.json');

let root = '';
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'winbox-uctv-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('UcTvStore', () => {
  it('未绑定返回 null；set → get → remove 往返（无 codec 时明文）', () => {
    const s = new UcTvStore(new JsonStore(file(root)), logger);
    expect(s.get()).toBeNull();
    s.set('dev1', '{"data":{"access_token":"AT","refresh_token":"RT"}}');
    expect(s.get()).toEqual({ deviceId: 'dev1', token: '{"data":{"access_token":"AT","refresh_token":"RT"}}' });
    s.remove();
    expect(s.get()).toBeNull();
  });

  it('有 codec 时 token 加密落盘、读回明文；解密失败视为未绑定', () => {
    const codec: DriveCodec = {
      encode: (p) => 'enc:' + Buffer.from(p, 'utf8').toString('base64'),
      decode: (s) => (s.startsWith('enc:') ? Buffer.from(s.slice(4), 'base64').toString('utf8') : s),
    };
    const s = new UcTvStore(new JsonStore(file(root)), logger, codec);
    s.set('dev1', 'TOK');
    expect(s.get()).toEqual({ deviceId: 'dev1', token: 'TOK' });
    // 落盘形态是密文（明文不出现在文件里）
    expect(readFileSync(file(root), 'utf-8')).not.toContain('TOK');
    // 解密失败（密钥变更/损坏）→ 视为未绑定，而不是给出坏 token
    const broken: DriveCodec = { encode: codec.encode, decode: () => null };
    expect(new UcTvStore(new JsonStore(file(root)), logger, broken).get()).toBeNull();
  });

  it('空 token 抛错（拒绝写入不可用凭据）', () => {
    const s = new UcTvStore(new JsonStore(file(root)), logger);
    expect(() => s.set('dev1', '   ')).toThrow();
  });

  it('写入或解绑失败时继续返回旧的磁盘凭据和内存值', () => {
    const path = file(root);
    const s = new UcTvStore(new JsonStore(path), logger);
    s.set('dev1', 'before');
    const diskBefore = readFileSync(path, 'utf-8');
    mkdirSync(path + '.tmp');

    expect(() => s.set('dev2', 'after')).toThrow();
    expect(s.get()).toEqual({ deviceId: 'dev1', token: 'before' });
    expect(readFileSync(path, 'utf-8')).toBe(diskBefore);

    expect(() => s.remove()).toThrow();
    expect(s.get()).toEqual({ deviceId: 'dev1', token: 'before' });
    expect(readFileSync(path, 'utf-8')).toBe(diskBefore);
  });
});
