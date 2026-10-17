import { describe, expect, it } from 'vitest';
import { decodeStream, loadBuffer, type CheerioAPI } from 'cheerio';
import iconv from 'iconv-lite';
import { CryptoJS } from '../src/engine/js/globals/cryptoCompat';

describe('current encoding-sniffer compatibility', () => {
  const bytes = iconv.encode('<meta charset="gbk"><p class="title">中文标题</p>', 'gbk');

  it('decodes a legacy-encoded HTML buffer through Cheerio', () => {
    expect(loadBuffer(bytes)('.title').text()).toBe('中文标题');
  });

  it('decodes HTML when charset and multibyte characters cross stream chunks', async () => {
    const result = Promise.withResolvers<CheerioAPI>();
    const stream = decodeStream({}, (error, document) => {
      if (error) result.reject(error);
      else result.resolve(document);
    });
    for (let offset = 0; offset < bytes.length; offset += 3) stream.write(bytes.subarray(offset, offset + 3));
    stream.end();
    expect((await result.promise)('.title').text()).toBe('中文标题');
  });
});

describe('community crypto compatibility vectors', () => {
  it('matches SHA-256 and RFC 4231 HMAC vectors', () => {
    expect(CryptoJS.SHA256('abc').toString()).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const key = CryptoJS.enc.Hex.parse('0b'.repeat(20));
    expect(CryptoJS.HmacSHA256('Hi There', key).toString()).toBe('b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
  });

  it('matches the NIST AES-128-CBC vector through the legacy namespace', () => {
    const key = CryptoJS.enc.Hex.parse('2b7e151628aed2a6abf7158809cf4f3c');
    const iv = CryptoJS.enc.Hex.parse('000102030405060708090a0b0c0d0e0f');
    const message = CryptoJS.enc.Hex.parse('6bc1bee22e409f96e93d7e117393172a');
    const encrypted = CryptoJS.AES.encrypt(message, key, { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.NoPadding });
    expect(encrypted.ciphertext).toBeDefined();
    expect(encrypted.ciphertext?.toString()).toBe('7649abac8119b246cee98e9b12e9197d');
    expect(CryptoJS.AES.decrypt(encrypted, key, { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.NoPadding }).toString()).toBe(message.toString());
  });
});
