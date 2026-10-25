import { describe, expect, it } from 'vitest';
import { JsonLineDecoder } from '../src/main/player/JsonLineDecoder';

describe('JsonLineDecoder', () => {
  it('decodes multiple complete lines and retains an incomplete line', () => {
    const decoder = new JsonLineDecoder();

    expect(decoder.push(Buffer.from('{"event":"loaded"}\n{"event":"time"')))
      .toEqual([{ event: 'loaded' }]);
    expect(decoder.push(Buffer.from(',"value":12}\n')))
      .toEqual([{ event: 'time', value: 12 }]);
  });

  it('preserves UTF-8 characters split across transport chunks', () => {
    const decoder = new JsonLineDecoder();
    const encoded = Buffer.from('{"event":"error","message":"字幕加载失败"}\n');
    const splitInsideCharacter = encoded.indexOf(Buffer.from('幕')) + 1;

    expect(decoder.push(encoded.subarray(0, splitInsideCharacter))).toEqual([]);
    expect(decoder.push(encoded.subarray(splitInsideCharacter)))
      .toEqual([{ event: 'error', message: '字幕加载失败' }]);
  });

  it('skips malformed lines without dropping later messages', () => {
    const decoder = new JsonLineDecoder();

    expect(decoder.push(Buffer.from('{bad json}\n{"event":"loaded"}\n')))
      .toEqual([{ event: 'loaded' }]);
  });

  it('bounds an unterminated oversized line and recovers at the next delimiter', () => {
    const decoder = new JsonLineDecoder();

    expect(decoder.push(Buffer.from('x'.repeat(1024 * 1024 + 1)))).toEqual([]);
    expect(decoder.push(Buffer.from('discarded remainder\n{"event":"loaded"}\n')))
      .toEqual([{ event: 'loaded' }]);
  });

  it('reset drops partial data and resets UTF-8 decoder state for a new session', () => {
    const decoder = new JsonLineDecoder();
    decoder.push(Buffer.from('{"event":"old"'));
    decoder.reset();

    expect(decoder.push(Buffer.from('{"event":"new"}\n')))
      .toEqual([{ event: 'new' }]);
  });
});
