// tests/kernel.spec.ts
// ★ 2026-10-08（用户拍板「内置官方构建」）：播放内核选择纯函数回归（HTML5 默认 / MPV 自动与一键切换）。
import { describe, it, expect } from 'vitest';
import { isEngineKernel, preferMpvKernel, resolveKernel } from '../src/renderer/lib/kernel';

describe('preferMpvKernel · 资源形态 → 倾向 mpv', () => {
  it('Chromium 播不好的容器（mkv/avi/wmv/rmvb/m2ts/vob/divx/f4v）→ true', () => {
    for (const ext of ['mkv', 'avi', 'wmv', 'rmvb', 'm2ts', 'vob', 'divx', 'f4v']) {
      expect(preferMpvKernel(`https://x.test/movie/a.${ext}`)).toBe(true);
      expect(preferMpvKernel(`https://x.test/a.${ext.toUpperCase()}?token=1`)).toBe(true);
    }
  });

  it('/play 中继包装先还原再判（mkv 直链经中继仍判 mkv）', () => {
    const relay = `http://127.0.0.1:9978/play?url=${encodeURIComponent('https://x.test/m/a.mkv')}&ua=UA`;
    expect(preferMpvKernel(relay)).toBe(true);
  });

  it('常规形态走 HTML5：m3u8 / mp4 / flv / ts / 无扩展名', () => {
    expect(preferMpvKernel('https://x.test/a.m3u8')).toBe(false);
    expect(preferMpvKernel('https://x.test/a.mp4?sign=1')).toBe(false);
    expect(preferMpvKernel('https://x.test/live.flv')).toBe(false);
    expect(preferMpvKernel('https://x.test/a.ts')).toBe(false);
    expect(preferMpvKernel('https://x.test/api/play?id=1')).toBe(false);
    expect(preferMpvKernel('')).toBe(false);
  });

  it('图片/音频/无载体协议一律 false（内核切换不适用）', () => {
    expect(preferMpvKernel('https://x.test/a.jpg')).toBe(false); // 图集源
    expect(preferMpvKernel('https://x.test/a.flac')).toBe(false); // 音乐源
    expect(preferMpvKernel('magnet:?xt=urn:btih:abc')).toBe(false);
    expect(preferMpvKernel('rtsp://x.test/1')).toBe(false);
  });
});

describe('resolveKernel · 偏好 × 可用性 × 资源形态', () => {
  const mkv = 'https://x.test/a.mkv';
  const mp4 = 'https://x.test/a.mp4';
  const noEngines = { mpvAvailable: false, engines: [] as string[] };
  const withMpv = { mpvAvailable: true, engines: [] as string[] };

  it('mpv 不可用 → 一律 html5（调用方据此隐藏入口）', () => {
    expect(resolveKernel('mpv', mkv, noEngines)).toBe('html5');
    expect(resolveKernel('auto', mkv, noEngines)).toBe('html5');
    expect(resolveKernel('html5', mkv, noEngines)).toBe('html5');
  });

  it('显式偏好优先（手动切换后记住）', () => {
    expect(resolveKernel('mpv', mp4, withMpv)).toBe('mpv');
    expect(resolveKernel('html5', mkv, withMpv)).toBe('html5');
  });

  it('auto：按资源形态（mkv → mpv；mp4 → html5）', () => {
    expect(resolveKernel('auto', mkv, withMpv)).toBe('mpv');
    expect(resolveKernel('auto', mp4, withMpv)).toBe('html5');
  });

  it('uses probe results for opaque cloud links and avoids transcoding when native playback is available', () => {
    const opaque = 'https://cloud.example/download?file=123';
    const options = { ...withMpv, requiresCompatibility: true };
    expect(resolveKernel('auto', opaque, withMpv)).toBe('html5');
    expect(resolveKernel('auto', opaque, options)).toBe('mpv');
    expect(resolveKernel('auto', mp4, options)).toBe('mpv');
    expect(resolveKernel('html5', opaque, options)).toBe('html5');
    expect(resolveKernel('auto', opaque, { ...options, mpvAvailable: false })).toBe('html5');
  });

  // ★ 2026-10-18（R11）：内核从「双选」扩为「内置 2 + 插件 N」
  describe('插件内核（`engine:<id>`）', () => {
    const opts = { mpvAvailable: true, engines: ['engine:a'] };
    const noMpv = { mpvAvailable: false, engines: ['engine:a'] };

    it('isEngineKernel 只认 `engine:` 前缀且带 id', () => {
      expect(isEngineKernel('engine:a')).toBe(true);
      expect(isEngineKernel('engine:')).toBe(false);
      expect(isEngineKernel('mpv')).toBe(false);
      expect(isEngineKernel(undefined)).toBe(false);
    });

    it('显式选中且可用 → 直接采用该内核（mpv 是否可用无关）', () => {
      expect(resolveKernel('engine:a', mp4, opts)).toBe('engine:a');
      expect(resolveKernel('engine:a', mp4, noMpv)).toBe('engine:a');
    });

    it('不在可用集合（未启用 / 未就绪）→ 回落 `auto` 结果，绝不硬选', () => {
      // mpv 可用 + mkv → auto 结果 = mpv
      expect(resolveKernel('engine:b', mkv, opts)).toBe('mpv');
      // mpv 不可用 + mkv → auto 结果 = html5
      expect(resolveKernel('engine:b', mkv, noMpv)).toBe('html5');
      // 常规 mp4 → html5
      expect(resolveKernel('engine:b', mp4, opts)).toBe('html5');
    });

    it('auto 不选插件内核（插件内核只在显式选择时生效）', () => {
      expect(resolveKernel('auto', mkv, opts)).toBe('mpv');
      expect(resolveKernel('auto', mp4, opts)).toBe('html5');
    });
  });
});
