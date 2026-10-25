// tests/catchup.spec.ts
import { describe, expect, it } from 'vitest';
import {
  buildCatchupUrl,
  formatDateTime,
  resolveCatchupTemplate,
} from '../src/engine/live/catchup';

describe('catchup', () => {
  const startMs = new Date('2026-10-25T14:00:00Z').getTime();
  const endMs = new Date('2026-10-25T14:45:00Z').getTime(); // 45 min = 2700 sec

  it('formats dates with custom patterns', () => {
    const d = new Date(2026, 9, 25, 20, 30, 15); // local time Oct 25 20:30:15
    expect(formatDateTime(d, 'yyyyMMddHHmmss')).toBe('20261025203015');
    expect(formatDateTime(d, 'yyyy-MM-dd HH:mm')).toBe('2026-10-25 20:30');
  });

  it('resolves timestamp and duration templates', () => {
    const tpl = '?start=${(b)timestamp}&end=${(e)timestamp}&dur=${(d)}';
    const resolved = resolveCatchupTemplate(tpl, startMs, endMs);
    expect(resolved).toBe(`?start=${Math.floor(startMs / 1000)}&end=${Math.floor(endMs / 1000)}&dur=2700`);
  });

  it('builds default playseek query when catchup source is omitted', () => {
    const stream = 'http://live.example.com/cctv1.m3u8';
    const url = buildCatchupUrl(stream, undefined, startMs, endMs);
    expect(url).toContain('http://live.example.com/cctv1.m3u8?playseek=');
  });

  it('handles append and query params on streams with existing queries', () => {
    const stream = 'http://live.example.com/cctv1.m3u8?token=xyz';
    const catchup = {
      type: 'append',
      source: '?playseek=${(b)timestamp}-${(e)timestamp}',
    };
    const url = buildCatchupUrl(stream, catchup, startMs, endMs);
    expect(url).toBe(`http://live.example.com/cctv1.m3u8?token=xyz&playseek=${Math.floor(startMs / 1000)}-${Math.floor(endMs / 1000)}`);
  });

  it('applies catchup-replace to modify base stream path', () => {
    const stream = 'http://live.example.com/live/cctv1.m3u8';
    const catchup = {
      source: '?playseek=${(b)timestamp}-${(e)timestamp}',
      replace: '/live/->/playback/',
    };
    const url = buildCatchupUrl(stream, catchup, startMs, endMs);
    expect(url).toContain('http://live.example.com/playback/cctv1.m3u8?playseek=');
  });
});
