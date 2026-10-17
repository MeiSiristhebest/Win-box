// tests/mpvCore.spec.ts
// ★ 2026-10-08（用户拍板「内置官方构建」）：MPV 高兼容播放内核的纯逻辑回归 ——
//   启动参数 / JSON IPC 行协议 / 状态归一 / 画面比例与字幕换算 / mpv.exe 路径解析链。
import { describe, it, expect } from 'vitest';
import {
  buildMpvArgs,
  initialKernelState,
  mpvAudioParams,
  mpvAudioTracks,
  mpvCmdLine,
  mpvCommandLines,
  mpvFitProps,
  mpvObserveLines,
  mpvShadersCmd,
  mpvSubtitleTracks,
  mpvVideoParams,
  reduceMpvMessage,
  resolveMpvPath,
  sameAudioTracks,
} from '../src/main/player/mpvCore';
import { mpvDisplayStandard, mpvFontSize, mpvSubPos, normalizeSpdif, spdifLabel, SPDIF_OPTIONS } from '../src/shared/player';

describe('mpvCore · 启动参数', () => {
  it('关键旗标齐全：--wid 嵌入 / JSON IPC / idle / keep-open / 硬解 / 不抢输入', () => {
    const args = buildMpvArgs({ pipe: '\\\\.\\pipe\\winbox-mpv-1', wid: '123456' });
    expect(args).toContain('--wid=123456');
    expect(args).toContain('--input-ipc-server=\\\\.\\pipe\\winbox-mpv-1');
    expect(args).toContain('--idle=yes');
    expect(args).toContain('--keep-open=yes');
    expect(args).toContain('--hwdec=auto-safe');
    expect(args).toContain('--input-default-bindings=no');
    expect(args).toContain('--no-config');
  });

  it('起播位置/音量/倍速按需带上（0 或缺省不传）', () => {
    const a = buildMpvArgs({ pipe: 'p', wid: '1', start: 123.9, volume: 0.5, rate: 1.5 });
    expect(a).toContain('--start=123');
    expect(a).toContain('--volume=50');
    expect(a).toContain('--speed=1.5');
    const b = buildMpvArgs({ pipe: 'p', wid: '1' });
    expect(b.some((x) => x.startsWith('--start='))).toBe(false);
    expect(b.some((x) => x.startsWith('--volume='))).toBe(false);
    expect(b.some((x) => x.startsWith('--speed='))).toBe(false);
  });

  it('画面比例展开为 mpv 属性（fill = keepaspect no；cover = panscan 1.0；r169 = 16:9）', () => {
    const fill = buildMpvArgs({ pipe: 'p', wid: '1', fit: 'fill' });
    expect(fill).toContain('--keepaspect=no');
    const cover = buildMpvArgs({ pipe: 'p', wid: '1', fit: 'cover' });
    expect(cover).toContain('--panscan=1.0');
    const r169 = buildMpvArgs({ pipe: 'p', wid: '1', fit: 'r169' });
    expect(r169).toContain('--video-aspect-override=16:9');
    const none = buildMpvArgs({ pipe: 'p', wid: '1', fit: 'none' });
    expect(none).toContain('--video-unscaled=yes');
  });

  it('倍速越界被钳到 [0.25,4]；音量 0..1 换算为 0..100', () => {
    const a = buildMpvArgs({ pipe: 'p', wid: '1', volume: 2, rate: 99 });
    expect(a).toContain('--volume=130'); // 0..130（mpv 上限）
    expect(a).toContain('--speed=99'); // 启动参数不钳，运行期命令钳（见 mpvCommandLines）
    const lines = mpvCommandLines({ type: 'rate', value: 99 });
    expect(lines[0]).toContain('"speed",4');
  });
});

describe('mpvCore · JSON IPC 协议', () => {
  it('命令行以 JSON + \\n 结束（mpv 读行）', () => {
    const line = mpvCmdLine(['loadfile', 'http://x/a.mkv', 'replace']);
    expect(line.endsWith('\n')).toBe(true);
    expect(JSON.parse(line.trim())).toEqual({ command: ['loadfile', 'http://x/a.mkv', 'replace'] });
  });

  it('属性观察覆盖 时间/时长/暂停/缓冲/结束/尺寸/缓存/音轨', () => {
    const names = mpvObserveLines().map((l) => JSON.parse(l.trim()).command[2]);
    for (const n of ['time-pos', 'duration', 'pause', 'paused-for-cache', 'eof-reached', 'width', 'height', 'cache-speed', 'demuxer-cache-time', 'track-list', 'aid']) {
      expect(names).toContain(n);
    }
  });

  it('控制命令 → mpv 命令（play/pause/seek/volume/rate/fit/字幕/音轨）', () => {
    expect(mpvCommandLines({ type: 'play' })[0]).toContain('"pause","no"');
    expect(mpvCommandLines({ type: 'pause' })[0]).toContain('"pause","yes"');
    expect(mpvCommandLines({ type: 'seek', value: 42 })[0]).toContain('"seek",42,"absolute"');
    expect(mpvCommandLines({ type: 'volume', value: 0.4 })[0]).toContain('"volume",40');
    expect(mpvCommandLines({ type: 'fit', value: 'r43' }).join('')).toContain('"video-aspect-override","4:3"');
    expect(mpvCommandLines({ type: 'sub-font', value: 30 })[0]).toContain('"sub-font-size",60');
    expect(mpvCommandLines({ type: 'sub-pos', value: 88 })[0]).toContain('"sub-pos",88');
    // ★ 2026-10-17：切音轨 → set_property aid；非法/非正 id 不发明 API
    expect(mpvCommandLines({ type: 'aid', value: 2 })[0]).toContain('"set_property","aid",2');
    expect(mpvCommandLines({ type: 'aid', value: 0 })).toEqual([]);
    expect(mpvCommandLines({ type: 'aid', value: Number.NaN })).toEqual([]);
  });

  it('未知命令返回空（不发明 API）', () => {
    expect(mpvCommandLines({ type: 'nope' } as never)).toEqual([]);
  });
});

describe('mpvCore · 超分插件（glsl-shaders 注入）', () => {
  const parse = (lines: string[]): unknown[][] => lines.map((l) => JSON.parse(l.trim()).command);

  it('逐条 clr + append（不用拼接串）；顺序即生效顺序', () => {
    const cmds = parse(mpvShadersCmd(['R:\\p\\files\\a.glsl', 'R:\\p\\files\\b.glsl']));
    expect(cmds).toEqual([
      ['change-list', 'glsl-shaders', 'clr', ''],
      ['change-list', 'glsl-shaders', 'append', 'R:\\p\\files\\a.glsl'],
      ['change-list', 'glsl-shaders', 'append', 'R:\\p\\files\\b.glsl'],
    ]);
  });

  it('空数组 = 只清空（关闭超分）；空串/非串被滤掉', () => {
    expect(parse(mpvShadersCmd([]))).toEqual([['change-list', 'glsl-shaders', 'clr', '']]);
    expect(parse(mpvShadersCmd(['', '  '] as string[]))).toEqual([['change-list', 'glsl-shaders', 'clr', '']]);
  });

  it('含分隔符/空格的路径不被拆开（这正是「不用拼接串」的原因）', () => {
    const cmds = parse(mpvShadersCmd(['R:\\My Plugins\\x y.glsl']));
    expect(cmds[1]).toEqual(['change-list', 'glsl-shaders', 'append', 'R:\\My Plugins\\x y.glsl']);
  });

  it('MpvCommand 翻译：type=glsl-shaders 走 clr+append；缺省/未知值不发明 API', () => {
    const lines = mpvCommandLines({ type: 'glsl-shaders', value: ['C:\\s\\a.glsl'] });
    expect(parse(lines)).toEqual([
      ['change-list', 'glsl-shaders', 'clr', ''],
      ['change-list', 'glsl-shaders', 'append', 'C:\\s\\a.glsl'],
    ]);
    // 空数组 → 只清空（关闭超分）
    expect(parse(mpvCommandLines({ type: 'glsl-shaders', value: [] }))).toEqual([
      ['change-list', 'glsl-shaders', 'clr', ''],
    ]);
  });
});

describe('mpvCore · 状态归一', () => {
  it('property-change 逐项映射（含 duration=null 表未知）', () => {
    const s = initialKernelState();
    reduceMpvMessage(s, { event: 'property-change', name: 'time-pos', data: 12.5 });
    reduceMpvMessage(s, { event: 'property-change', name: 'duration', data: 7200.0 });
    reduceMpvMessage(s, { event: 'property-change', name: 'pause', data: true });
    reduceMpvMessage(s, { event: 'property-change', name: 'paused-for-cache', data: true });
    reduceMpvMessage(s, { event: 'property-change', name: 'width', data: 3840 });
    reduceMpvMessage(s, { event: 'property-change', name: 'height', data: 2160 });
    reduceMpvMessage(s, { event: 'property-change', name: 'cache-speed', data: 2 * 1024 * 1024 });
    reduceMpvMessage(s, { event: 'property-change', name: 'demuxer-cache-time', data: 300 });
    expect(s.time).toBe(12.5);
    expect(s.duration).toBe(7200);
    expect(s.paused).toBe(true);
    expect(s.buffering).toBe(true);
    expect(s.videoW).toBe(3840);
    expect(s.videoH).toBe(2160);
    expect(s.cacheKbps).toBe(2048);
    expect(s.cacheTime).toBe(300);
    reduceMpvMessage(s, { event: 'property-change', name: 'duration', data: null });
    expect(s.duration).toBeNull();
  });

  it('file-loaded：loaded=true；时长未知仍保持非直播，直播由启动提示决定', () => {
    const vod = initialKernelState();
    reduceMpvMessage(vod, { event: 'property-change', name: 'duration', data: 100 });
    reduceMpvMessage(vod, { event: 'file-loaded' });
    expect(vod.loaded).toBe(true);
    expect(vod.live).toBe(false);
    const live = initialKernelState(true);
    reduceMpvMessage(live, { event: 'file-loaded' });
    expect(live.live).toBe(true);
  });

  it.each(['before', 'after'])('点播有限时长在 file-loaded %s 到达时都纠正初始直播提示', (order) => {
    const s = initialKernelState(true);
    if (order === 'after') reduceMpvMessage(s, { event: 'file-loaded' });
    reduceMpvMessage(s, { event: 'property-change', name: 'duration', data: 7200 });
    if (order === 'before') reduceMpvMessage(s, { event: 'file-loaded' });
    expect(s.loaded).toBe(true);
    expect(s.duration).toBe(7200);
    expect(s.live).toBe(false);
    // 结束/重探测时 duration 消失，也不能把已识别的点播重新变成直播。
    reduceMpvMessage(s, { event: 'property-change', name: 'duration', data: null });
    expect(s.live).toBe(false);
  });

  it('未知/无效时长不会把点播自动改成直播，也不会清除真实直播提示', () => {
    for (const hint of [false, true]) {
      const s = initialKernelState(hint);
      reduceMpvMessage(s, { event: 'file-loaded' });
      for (const data of [null, undefined, 0, Infinity, Number.NaN]) {
        reduceMpvMessage(s, { event: 'property-change', name: 'duration', data });
        expect(s.live).toBe(hint);
      }
    }
  });

  describe.each(['eof-reached', 'end-file'])('结束事件 %s', (event) => {
    const eofMessage = event === 'eof-reached'
      ? { event: 'property-change', name: 'eof-reached', data: true }
      : { event: 'end-file', reason: 'eof' };

    it('加载完成但尚未播放时 EOF 是读取失败，不是播放完成', () => {
      const s = initialKernelState();
      reduceMpvMessage(s, { event: 'file-loaded' });
      reduceMpvMessage(s, eofMessage);
      expect(s.eof).toBe(false);
      expect(s.error).toBe('读取或解码失败');
    });

    it('已播放一点但远未到已知时长末尾时，不触发完成/自动下一集', () => {
      const s = initialKernelState();
      reduceMpvMessage(s, { event: 'file-loaded' });
      reduceMpvMessage(s, { event: 'property-change', name: 'duration', data: 7200 });
      reduceMpvMessage(s, { event: 'property-change', name: 'time-pos', data: 1.5 });
      expect(s.playbackStarted).toBe(true);
      expect(reduceMpvMessage(s, eofMessage)).toBe(true);
      expect(s.eof).toBe(false);
      expect(s.error).toBe('视频流提前结束');
      expect(reduceMpvMessage(s, eofMessage)).toBe(false);
    });

    it('续播位置推进也不能把中途断流当成完成', () => {
      const s = initialKernelState();
      reduceMpvMessage(s, { event: 'file-loaded' });
      reduceMpvMessage(s, { event: 'property-change', name: 'duration', data: 7200 });
      reduceMpvMessage(s, { event: 'property-change', name: 'time-pos', data: 3600 });
      reduceMpvMessage(s, eofMessage);
      expect(s.eof).toBe(false);
      expect(s.error).toBe('视频流提前结束');
    });

    it('真正到达末尾时仍正常完成，容忍最后一帧的时间偏差', () => {
      const s = initialKernelState();
      reduceMpvMessage(s, { event: 'file-loaded' });
      reduceMpvMessage(s, { event: 'property-change', name: 'duration', data: 100 });
      reduceMpvMessage(s, { event: 'property-change', name: 'time-pos', data: 99 });
      reduceMpvMessage(s, eofMessage);
      expect(s.eof).toBe(true);
      expect(s.error).toBeNull();
    });

    it('未知时长的视频播起来后仍可正常结束', () => {
      const s = initialKernelState();
      reduceMpvMessage(s, { event: 'file-loaded' });
      reduceMpvMessage(s, { event: 'property-change', name: 'time-pos', data: 12.5 });
      reduceMpvMessage(s, eofMessage);
      expect(s.eof).toBe(true);
      expect(s.error).toBeNull();
    });

    it('明确的解码错误后，即使位置在末尾也不会触发正常完成', () => {
      const s = initialKernelState();
      reduceMpvMessage(s, { event: 'file-loaded' });
      reduceMpvMessage(s, { event: 'property-change', name: 'time-pos', data: 100 });
      reduceMpvMessage(s, { event: 'end-file', reason: 'error', error: 'decoder failed' });
      reduceMpvMessage(s, eofMessage);
      expect(s.eof).toBe(false);
      expect(s.error).toBe('decoder failed');
    });

    it('中途断流不会覆盖已有的具体读取/解码错误', () => {
      const s = initialKernelState();
      reduceMpvMessage(s, { event: 'file-loaded' });
      reduceMpvMessage(s, { event: 'property-change', name: 'duration', data: 7200 });
      reduceMpvMessage(s, { event: 'property-change', name: 'time-pos', data: 1.5 });
      reduceMpvMessage(s, { event: 'end-file', reason: 'error', error: 'decoder failed' });
      expect(reduceMpvMessage(s, eofMessage)).toBe(false);
      expect(s.eof).toBe(false);
      expect(s.error).toBe('decoder failed');
    });
  });

  it('EOF 后晚到的读取错误撤销完成态，重复错误不再推送', () => {
    const s = initialKernelState();
    reduceMpvMessage(s, { event: 'file-loaded' });
    reduceMpvMessage(s, { event: 'property-change', name: 'time-pos', data: 100 });
    reduceMpvMessage(s, { event: 'property-change', name: 'eof-reached', data: true });
    expect(s.eof).toBe(true);
    const error = { event: 'end-file', reason: 'error', error: 'decoder failed' };
    expect(reduceMpvMessage(s, error)).toBe(true);
    expect(s.eof).toBe(false);
    expect(s.error).toBe('decoder failed');
    expect(reduceMpvMessage(s, error)).toBe(false);
  });

  it('eof：只有真实播放结束才置位；首包失败进入错误态', () => {
    const s = initialKernelState();
    expect(reduceMpvMessage(s, { event: 'end-file', reason: 'stop' })).toBe(false);
    expect(reduceMpvMessage(s, { event: 'end-file', reason: 'eof' })).toBe(true);
    expect(s.eof).toBe(false);
    expect(s.error).toBe('读取或解码失败');
    const knownDurationFailure = initialKernelState();
    reduceMpvMessage(knownDurationFailure, { event: 'file-loaded' });
    reduceMpvMessage(knownDurationFailure, { event: 'property-change', name: 'duration', data: 100 });
    expect(reduceMpvMessage(knownDurationFailure, { event: 'end-file', reason: 'eof' })).toBe(true);
    expect(knownDurationFailure.eof).toBe(false);
    expect(knownDurationFailure.error).toBe('读取或解码失败');
    const played = initialKernelState();
    reduceMpvMessage(played, { event: 'file-loaded' });
    reduceMpvMessage(played, { event: 'property-change', name: 'time-pos', data: 12.5 });
    expect(reduceMpvMessage(played, { event: 'end-file', reason: 'eof' })).toBe(true);
    expect(played.eof).toBe(true);
    expect(played.playbackStarted).toBe(true);
    expect(reduceMpvMessage(s, { event: 'end-file', reason: 'eof' })).toBe(false);
    expect(reduceMpvMessage(s, { event: 'property-change', name: 'time-pos', data: null })).toBe(false);
    expect(reduceMpvMessage(s, { event: 'unknown-event' })).toBe(false);
    expect(reduceMpvMessage(s, null)).toBe(false);
  });

  it('畸形数据不崩、不误写（string/NaN 全忽略）', () => {
    const s = initialKernelState();
    expect(reduceMpvMessage(s, { event: 'property-change', name: 'time-pos', data: 'abc' })).toBe(false);
    expect(reduceMpvMessage(s, { event: 'property-change', name: 'width', data: Number.NaN })).toBe(false);
    expect(reduceMpvMessage(s, { event: 'property-change', name: 'width', data: -3 })).toBe(false);
    expect(s.time).toBeNull();
    expect(s.videoW).toBe(0);
  });
});

describe('mpvCore · 音轨设置（track-list / aid）', () => {
  it('track-list → 只留 audio，字段归一（声道兼容两种键名；非法项丢弃）', () => {
    const list = mpvAudioTracks([
      { id: 1, type: 'video', codec: 'h264' },
      { id: 2, type: 'audio', title: '国语', lang: 'chi', codec: 'aac', 'demux-channel-count': 2, selected: true },
      { id: 3, type: 'audio', lang: 'jpn', 'demux-channels': 6 },
      { id: 'x', type: 'audio' }, // 非数字 id → 丢
      null,
      'str',
      42,
    ]);
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({ id: 2, title: '国语', lang: 'chi', codec: 'aac', channels: '2', selected: true });
    expect(list[1]).toEqual({ id: 3, title: undefined, lang: 'jpn', codec: undefined, channels: '6', selected: undefined });
  });

  it('非数组/空 → 空表（不崩）', () => {
    expect(mpvAudioTracks(null)).toEqual([]);
    expect(mpvAudioTracks('x')).toEqual([]);
    expect(mpvAudioTracks([])).toEqual([]);
  });

  it('track-list / aid 落到状态；内容不变时不再置位（避免无谓推送）', () => {
    const st = initialKernelState();
    expect(st.audioTracks).toEqual([]);
    expect(st.aid).toBeNull();

    expect(reduceMpvMessage(st, { event: 'property-change', name: 'track-list', data: [{ id: 2, type: 'audio', title: '国语' }] })).toBe(true);
    expect(st.audioTracks.map((t) => t.id)).toEqual([2]);
    // 同样内容再来一次 → false（MpvController 据此跳过推送）
    expect(reduceMpvMessage(st, { event: 'property-change', name: 'track-list', data: [{ id: 2, type: 'audio', title: '国语' }] })).toBe(false);

    expect(reduceMpvMessage(st, { event: 'property-change', name: 'aid', data: 2 })).toBe(true);
    expect(st.aid).toBe(2);
    expect(reduceMpvMessage(st, { event: 'property-change', name: 'aid', data: 2 })).toBe(false);
    // mpv 对「无音轨」回传 false → null
    expect(reduceMpvMessage(st, { event: 'property-change', name: 'aid', data: false })).toBe(true);
    expect(st.aid).toBeNull();
  });

  it('sameAudioTracks 判等（selected 变化也算变）', () => {
    expect(sameAudioTracks([{ id: 2, title: '国语', selected: true }], [{ id: 2, title: '国语', selected: true }])).toBe(true);
    expect(sameAudioTracks([{ id: 2, title: '国语', selected: true }], [{ id: 2, title: '国语' }])).toBe(false);
    expect(sameAudioTracks([{ id: 2 }], [])).toBe(false);
  });
});

// ---------- ★ 2026-10-17（阶段2）：MPV 内核能力面 ----------
// 键名/单位全部取自该内核实测 dump（.tmp/yaozhi-poc/mpv-props.cjs）：
//   · track-list 的 language/title 在 metadata 里，顶层没有；
//   · video-params 的 hdr-vivid 是本内核自定义键；
//   · *-bitrate 单位是 bps。
describe('mpvCore · 能力面（阶段2）', () => {
  it('track-list：lang/title 从 metadata 读出（本内核顶层没有）', () => {
    const list = mpvAudioTracks([
      { id: 1, type: 'video', codec: 'h264', metadata: { language: 'und' } },
      { id: 2, type: 'audio', codec: 'aac', 'demux-channel-count': 6, metadata: { language: 'chi', title: '国语' }, selected: true },
    ]);
    expect(list).toEqual([{ id: 2, title: '国语', lang: 'chi', codec: 'aac', channels: '6', selected: true }]);
  });

  it('track-list：字幕轨归一（type=sub；external 透传；非 audio/sub 丢弃）', () => {
    const subs = mpvSubtitleTracks([
      { id: 1, type: 'video' },
      { id: 3, type: 'sub', codec: 'ass', external: true, selected: true, metadata: { language: 'chi', title: '简体' } },
      { id: 'x', type: 'sub' },
      null,
    ]);
    expect(subs).toEqual([{ id: 3, title: '简体', lang: 'chi', codec: 'ass', selected: true, external: true }]);
    expect(mpvSubtitleTracks(null)).toEqual([]);
  });

  it('同一次 track-list 事件同时刷新音轨与字幕轨；都无变化时 false', () => {
    const st = initialKernelState();
    const data = [
      { id: 2, type: 'audio', codec: 'aac' },
      { id: 3, type: 'sub', codec: 'ass', selected: true },
    ];
    expect(reduceMpvMessage(st, { event: 'property-change', name: 'track-list', data })).toBe(true);
    expect(st.audioTracks.map((t) => t.id)).toEqual([2]);
    expect(st.subtitles.map((t) => t.id)).toEqual([3]);
    expect(reduceMpvMessage(st, { event: 'property-change', name: 'track-list', data })).toBe(false);
  });

  it('video-params：w/h 取自 w/h 或 dw/dh；hdr-vivid 自定义键透传；无尺寸 → null', () => {
    const v = mpvVideoParams({ w: 1280, h: 720, pixelformat: 'yuv420p', primaries: 'bt.709', gamma: 'bt.1886', light: 'display', 'sig-peak': 0, 'hdr-vivid': false });
    expect(v).toEqual({ w: 1280, h: 720, pixelformat: 'yuv420p', primaries: 'bt.709', gamma: 'bt.1886', light: 'display', sigPeak: 0, hdrVivid: undefined });
    expect(mpvVideoParams({ dw: 1920, dh: 1080, 'hdr-vivid': true })).toEqual({ w: 1920, h: 1080, pixelformat: undefined, primaries: undefined, gamma: undefined, light: undefined, sigPeak: undefined, hdrVivid: true });
    expect(mpvVideoParams({})).toBeNull();
    expect(mpvVideoParams('x')).toBeNull();
  });

  it('audio-params：只留有效字段；全空 → null（format 是采样格式，不当作编码）', () => {
    expect(mpvAudioParams({ samplerate: 48000, 'channel-count': 1, channels: 'mono', 'hr-channels': 'mono', format: 'floatp' }))
      .toEqual({ samplerate: 48000, channelCount: 1, channels: 'mono' });
    expect(mpvAudioParams({})).toBeNull();
    expect(mpvAudioParams(null)).toBeNull();
  });

  it('画面标准推导：hdr-vivid 优先 → HDR Vivid；hlg；pq/smpte2084 → HDR10；其余 SDR', () => {
    expect(mpvDisplayStandard(null)).toBe('SDR');
    expect(mpvDisplayStandard({ w: 1, h: 1, gamma: 'bt.1886' })).toBe('SDR');
    expect(mpvDisplayStandard({ w: 1, h: 1, gamma: 'hlg' })).toBe('HLG');
    expect(mpvDisplayStandard({ w: 1, h: 1, gamma: 'pq' })).toBe('HDR10');
    expect(mpvDisplayStandard({ w: 1, h: 1, gamma: 'smpte2084' })).toBe('HDR10');
    expect(mpvDisplayStandard({ w: 1, h: 1, gamma: 'pq', hdrVivid: true })).toBe('HDR Vivid');
  });

  it('编码/硬解/帧率/丢帧/缓存时长/直通落到状态；内容不变不置位', () => {
    const st = initialKernelState();
    const ch = (name: string, data: unknown): boolean => reduceMpvMessage(st, { event: 'property-change', name, data });
    expect(ch('video-format', 'hevc')).toBe(true);
    expect(st.vCodec).toBe('hevc');
    expect(ch('video-format', 'hevc')).toBe(false);
    expect(ch('audio-codec-name', 'eac3')).toBe(true);
    expect(st.aCodec).toBe('eac3');
    expect(ch('hwdec-current', 'd3d11va')).toBe(true);
    expect(st.hwdec).toBe('d3d11va');
    expect(ch('container-fps', 23.976)).toBe(true);
    expect(st.fps).toBe(23.976);
    expect(ch('frame-drop-count', 12)).toBe(true);
    expect(st.dropped).toBe(12);
    expect(ch('demuxer-cache-duration', 2.5)).toBe(true);
    expect(st.cacheDuration).toBe(2.5);
    expect(ch('audio-spdif', 'eac3,dts')).toBe(true);
    expect(st.spdif).toBe('eac3,dts');
    expect(ch('audio-spdif', 'eac3,dts')).toBe(false);
  });

  it('码率：原始单位是 bps → 存 kbps（÷1000 四舍五入）；拿不到 = 0', () => {
    const st = initialKernelState();
    expect(reduceMpvMessage(st, { event: 'property-change', name: 'audio-bitrate', data: 126766 })).toBe(true);
    expect(st.aBitrateKbps).toBe(127);
    expect(reduceMpvMessage(st, { event: 'property-change', name: 'video-bitrate', data: 7492714 })).toBe(true);
    expect(st.vBitrateKbps).toBe(7493);
    // 不可用（mpv 报 property unavailable，不会推 property-change）→ 初始仍是 0
    expect(initialKernelState().vBitrateKbps).toBe(0);
  });

  it('sid：数字落到状态；无字幕回传 false/null → null', () => {
    const st = initialKernelState();
    expect(reduceMpvMessage(st, { event: 'property-change', name: 'sid', data: 3 })).toBe(true);
    expect(st.sid).toBe(3);
    expect(reduceMpvMessage(st, { event: 'property-change', name: 'sid', data: 3 })).toBe(false);
    expect(reduceMpvMessage(st, { event: 'property-change', name: 'sid', data: false })).toBe(true);
    expect(st.sid).toBeNull();
  });

  it('控制命令：切字幕轨（**必须传字符串**，数字会被 mpv 拒；-1 → "no"）；直通（空串合法）', () => {
    // ★ 实测：`set_property sid -1`（数字）→ mpv 回 `unsupported format for accessing property`（静默失败）
    expect(mpvCommandLines({ type: 'sid', value: 3 })[0]).toContain('"set_property","sid","3"');
    expect(mpvCommandLines({ type: 'sid', value: -1 })[0]).toContain('"set_property","sid","no"');
    expect(mpvCommandLines({ type: 'sid', value: 0 })).toEqual([]);
    expect(mpvCommandLines({ type: 'sid', value: -2 })).toEqual([]);
    expect(mpvCommandLines({ type: 'audio-spdif', value: '' })[0]).toContain('"set_property","audio-spdif",""');
    expect(mpvCommandLines({ type: 'audio-spdif', value: 'ac3,dts' })[0]).toContain('"audio-spdif","ac3,dts"');
  });

  it('★ 阶段3b：音频直通档位归一 —— 只认白名单，非法值回落「关闭」', () => {
    for (const o of SPDIF_OPTIONS) {
      expect(normalizeSpdif(o.value)).toBe(o.value);
      expect(spdifLabel(o.value)).toBe(o.label);
    }
    // 非法 / 未知 / 空 / 非字符串 → ''（关闭）
    expect(normalizeSpdif('ac3')).toBe('');
    expect(normalizeSpdif('ALL')).toBe('');
    expect(normalizeSpdif(null)).toBe('');
    expect(normalizeSpdif(undefined)).toBe('');
    expect(normalizeSpdif(3)).toBe('');
    expect(spdifLabel('unknown')).toBe('关闭');
    expect(normalizeSpdif('')).toBe('');
    // 档位值必须唯一（否则面板高亮会选错档）
    const values = SPDIF_OPTIONS.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it('属性观察覆盖新增能力面项（12~23）', () => {
    const names = mpvObserveLines().map((l) => JSON.parse(l.trim()).command[2]);
    for (const n of ['video-params', 'audio-params', 'video-format', 'audio-codec-name', 'hwdec-current', 'audio-bitrate', 'video-bitrate', 'container-fps', 'frame-drop-count', 'demuxer-cache-duration', 'audio-spdif', 'sid']) {
      expect(names).toContain(n);
    }
    const ids = mpvObserveLines().map((l) => JSON.parse(l.trim()).command[1]);
    expect(new Set(ids).size).toBe(ids.length); // id 唯一（否则属性事件会串号）
  });
});

describe('mpvCore · 字幕/画面比例换算', () => {
  it('mpvFitProps 默认（contain）保持比例、不覆盖画面比', () => {
    const p = Object.fromEntries(mpvFitProps('contain'));
    expect(p.keepaspect).toBe('yes');
    expect(p['video-aspect-override']).toBe('no');
  });

  it('字号近似 2:1、越界钳制；非法回落 55', () => {
    expect(mpvFontSize(28)).toBe(56);
    expect(mpvFontSize(0)).toBe(55);
    expect(mpvFontSize(Number.NaN)).toBe(55);
    expect(mpvFontSize(9999)).toBe(200);
  });

  it('sub-pos：距底 px → 距顶百分比（越界钳制、非法回落 90）', () => {
    expect(mpvSubPos(0, 800)).toBe(100);
    expect(mpvSubPos(80, 800)).toBe(90);
    expect(mpvSubPos(900, 800)).toBe(0);
    expect(mpvSubPos(10, 0)).toBe(90);
  });
});

describe('mpvCore · mpv.exe 解析链（配置覆盖 → 随包内置 → 本机探测）', () => {
  const env = { ProgramFiles: 'C:\\PF' } as Record<string, string | undefined>;
  const bundled = 'R:\\resources\\mpv\\mpv.exe';

  it('覆盖路径存在 → override 优先', () => {
    const r = resolveMpvPath({ override: 'D:\\my\\mpv.exe', bundled, env, exists: (p) => p === 'D:\\my\\mpv.exe' || p === bundled });
    expect(r).toEqual({ path: 'D:\\my\\mpv.exe', source: 'override' });
  });

  it('覆盖路径不存在/为空 → 落到内置', () => {
    expect(resolveMpvPath({ override: 'D:\\nope.exe', bundled, env, exists: (p) => p === bundled }).source).toBe('bundled');
    expect(resolveMpvPath({ override: '', bundled, env, exists: (p) => p === bundled }).source).toBe('bundled');
  });

  it('内置缺失 → 本机常见安装位置（Program Files\\mpv\\mpv.exe）', () => {
    const r = resolveMpvPath({ bundled, env, exists: (p) => p === 'C:\\PF\\mpv\\mpv.exe' });
    expect(r).toEqual({ path: 'C:\\PF\\mpv\\mpv.exe', source: 'system' });
  });

  it('全部缺失 → none（调用方据此隐藏 MPV 入口）', () => {
    const r = resolveMpvPath({ bundled, env, exists: () => false });
    expect(r).toEqual({ path: '', source: 'none' });
  });

  it('非法路径（exists 抛错）不崩、视为不存在', () => {
    const r = resolveMpvPath({
      override: '?:\\bad',
      bundled,
      env,
      exists: (p) => {
        if (p === '?:\\bad') throw new Error('bad path');
        return true;
      },
    });
    expect(r.source).toBe('bundled');
  });
});
