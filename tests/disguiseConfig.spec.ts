// tests/disguiseConfig.spec.ts — 订阅「伪装体」提取（2026-10-15，用户报 `https://yc.wya6.cn/wykj.php` 无法识别）。
// 形态（对真实站点实测）：真体 = 一个 jar 的十六进制 dump（每行 `16 字节 hex | ASCII`），
//   真配置以 base64 形式挂在**末行 ASCII 列**的分隔标记 `=WUYIwuyi**` 之后。
import { describe, it, expect } from 'vitest';
import { extractDisguiseConfig } from '../src/engine/config/disguiseConfig';
import { sniffBody, looksLikeHexDump } from '../src/engine/util/fetchWithDisguise';

/** 生成一行 dump：`16 字节 hex | ASCII 列` */
function dumpLine(bytes: number[], ascii = ''): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ') + ' | ' + ascii;
}
/** 16 个递增字节（够凑一行 dump；首行用 PK 魔数） */
function bytes16(seed: number): number[] {
  return Array.from({ length: 16 }, (_, i) => (seed + i * 7) & 0xff);
}
/** MIME 风格折行（验证「载荷里带换行也能解」） */
const wrap = (s: string, n = 76): string => s.replace(new RegExp(`(.{${n}})`, 'g'), '$1\n');

const CONFIG = {
  spider: 'https://yc.wya6.cn/pz/wyjk.php;md5;0cba0b9f3c38bc0f4782917ffd930d86',
  logo: 'http://php.example/logo.png',
  sites: [{ key: 'Douban', name: '无意┃片单', type: 3, api: 'csp_PianDan' }],
  lives: [{ name: '央视', type: 0, url: 'http://x/y.m3u' }],
  parses: [{ name: '聚合', type: 1, url: 'https://x/jx' }],
};
const CONFIG_TEXT = JSON.stringify(CONFIG);

describe('disguiseConfig — 伪装体提取', () => {
  it('★ 站点真实形态：dump 若干行 + 末行 `=WUYIwuyi**` 之后的 base64 → 解出完整配置', () => {
    const payload = wrap(Buffer.from(CONFIG_TEXT, 'utf-8').toString('base64'));
    const head = [
      dumpLine([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x08, 0x08, 0x00, 0x88, 0xb1, 0x32, 0x59, 0x63, 0x47], 'PK          2YcG'),
      dumpLine(bytes16(9), 'y H           cl'),
      dumpLine(bytes16(21), 'asses.dex, e'),
      dumpLine(bytes16(37), "0    ) R )   \"  "),
    ].join('\n');
    // 末行：ASCII 列先有一段噪声，再是标记 + base64 载荷（与实测原样一致）
    const last = dumpLine(bytes16(53), '                       |||=WUYIwuyi**' + payload);
    const body = head + '\n' + last;

    const r = extractDisguiseConfig(body);
    expect(r).not.toBeNull();
    expect(r!.how).toBe('marker');
    expect(r!.marker).toBe('=WUYIwuyi**');
    expect(r!.offset).toBe(body.indexOf('=WUYIwuyi**') + '=WUYIwuyi**'.length);
    expect(JSON.parse(r!.text)).toEqual(CONFIG);
  });

  it('取**最后一个**标记（前面 dump ASCII 列里的同名噪声不作数）', () => {
    const payload = Buffer.from(CONFIG_TEXT, 'utf-8').toString('base64');
    const noise = '=AAAAAA**' + 'zzzz-not-base64-json'; // 假的、解出来不是订阅 JSON
    const body = `${noise}\n${dumpLine(bytes16(3), 'x')}\n${dumpLine(bytes16(5), '|=WUYIwuyi**' + payload)}`;
    const r = extractDisguiseConfig(body);
    expect(r?.how).toBe('marker');
    expect(JSON.parse(r!.text)).toEqual(CONFIG);
  });

  it('无标记时走通用兜底：取全文最长的 base64 连续段（≥1024）', () => {
    const big = JSON.stringify({ spider: 'https://a/b.jar;md5;x', sites: [{ key: 'A', name: 'AA' }], pad: 'z'.repeat(900) });
    const b64 = wrap(Buffer.from(big, 'utf-8').toString('base64'));
    const body = `一些无关文本\n${b64}\n结束`;
    const r = extractDisguiseConfig(body);
    expect(r).not.toBeNull();
    expect(r!.how).toBe('longest-base64');
    expect(r!.marker).toBe('');
    expect(JSON.parse(r!.text)).toEqual(JSON.parse(big));
  });

  it('不越权 / 不误判：正常 JSON、HTML、短 base64、标记后是垃圾 → 一律 null', () => {
    expect(extractDisguiseConfig('')).toBeNull();
    expect(extractDisguiseConfig(CONFIG_TEXT)).toBeNull(); // 已经是正常订阅 JSON
    expect(extractDisguiseConfig('<!DOCTYPE html><html><body>hi</body></html>')).toBeNull();
    // 无标记 + 短 base64（<1024）→ 不猜
    expect(extractDisguiseConfig('=noise\n' + Buffer.from('{"sites":[]}').toString('base64'))).toBeNull();
    // 标记之后不是合法 base64 / 不是订阅 JSON
    expect(extractDisguiseConfig('x |=WUYIwuyi**' + '!!!!不是base64!!!!')).toBeNull();
    expect(extractDisguiseConfig('x |=WUYIwuyi**' + Buffer.from('{"hello":"world"}', 'utf-8').toString('base64'))).toBeNull();
  });
});

describe('fetchWithDisguise — dump 形态识别（导入失败的分档诊断）', () => {
  it('连续 ≥4 行「16 组 hex + |」判为 dump；正常文本/JSON 不受影响', () => {
    const dump = [dumpLine(bytes16(1), 'a'), dumpLine(bytes16(2), 'b'), dumpLine(bytes16(3), 'c'), dumpLine(bytes16(4), 'd')].join('\n');
    expect(looksLikeHexDump(dump)).toBe(true);
    expect(looksLikeHexDump(dump.split('\n').slice(0, 3).join('\n'))).toBe(false); // 只有 3 行不判
    expect(looksLikeHexDump(CONFIG_TEXT)).toBe(false);
    expect(looksLikeHexDump('')).toBe(false);
  });

  it('sniffBody：伪装体 → dump（此前只会笼统报「纯文本」）', () => {
    const body = [
      dumpLine([0x50, 0x4b, 0x03, 0x04, ...Array.from({ length: 12 }, (_, i) => i)], 'PK'),
      dumpLine(bytes16(9), 'y H'),
      dumpLine(bytes16(21), 'asses.dex'),
      dumpLine(bytes16(37), 'cl'),
      dumpLine(bytes16(53), '|=WUYIwuyi**QUJD'),
    ].join('\n');
    expect(sniffBody(Buffer.from(body, 'utf-8')).kind).toBe('dump');
    // 对照：普通 JSON / HTML 的判定不变
    expect(sniffBody(Buffer.from(CONFIG_TEXT, 'utf-8')).kind).toBe('json');
    expect(sniffBody(Buffer.from('<!DOCTYPE html><html></html>', 'utf-8')).kind).toBe('html');
    // 对照：真 zip 仍判 zip（不是 dump）
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);
    expect(sniffBody(zip).kind).toBe('zip');
  });
});
