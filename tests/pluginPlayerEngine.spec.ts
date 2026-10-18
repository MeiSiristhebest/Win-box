// tests/pluginPlayerEngine.spec.ts
// ★ 2026-10-18（R11）第三方播放内核（`contributes.player.engine`）单元回归：
//   ① 契约校验（**按协议分支**的必需 / 禁止占位符 / binary 形态 / capabilities / 顶层字段）
//   ② 参数模板展开（可选占位符缺省 → **整项丢弃**）
//   ③ 通用 `json-lines` 族：下行命令行 / 起播 load 行 / 上行事件归约（归一到 `MpvKernelState`）
//   ④ 清单级接入（`player.engine` 恒 `kind:"code"`）+ 视图装配（exe 就绪判定，四种来源分支）
import { describe, it, expect } from 'vitest';
import {
  HOST_API_VERSION,
  PLAYER_ENGINE_CAPABILITIES,
  PLAYER_ENGINE_PLACEHOLDERS,
  PLAYER_ENGINE_PROTOCOLS,
  playerEngineContributeOf,
  pluginLevelOf,
  validatePlayerEngineContribute,
  validatePluginManifest,
  type PluginManifest,
} from '../src/shared/plugin';
import { ENGINE_QUIT_LINE, engineCommandLines, engineLoadLine, expandEngineArgs, reduceEngineEvent } from '../src/main/player/engineLines';
import { initialKernelState } from '../src/main/player/mpvCore';
import { playerEngineFromContribute } from '../src/main/plugin/pluginPlayerEngine';

/** `mpv-ipc` 族最小合法描述符 */
const mpv = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'player.engine',
  id: 'my-mpv',
  label: '我的 MPV',
  protocol: 'mpv-ipc',
  binary: { source: 'plugin-file', file: 'files/mpv.exe' },
  args: ['--no-config', '--wid={wid}', '--input-ipc-server={pipe}', '--force-window=yes', '{url}'],
  ...over,
});

/** 通用 `json-lines` 族最小合法描述符 */
const jl = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'player.engine',
  id: 'my-engine',
  label: '通用引擎',
  protocol: 'json-lines',
  binary: { source: 'plugin-file', file: 'files/engine.exe' },
  args: ['--wid={wid}', '{url}', '--verbose'],
  ...over,
});

/** code 清单（`player.engine` 只可能 code） */
const codeManifest = (c: unknown): PluginManifest => ({
  manifestVersion: 1,
  id: 'engine-pack',
  name: '内核插件',
  version: '1.0.0',
  apiVersion: HOST_API_VERSION,
  kind: 'code',
  main: 'main.js',
  permissions: ['log'],
  contributes: [c as PluginManifest['contributes'][number]],
});

describe('player.engine 契约 — 白名单与最小合法', () => {
  it('三组白名单内容固定（协议 / 占位符 / 能力）', () => {
    expect([...PLAYER_ENGINE_PROTOCOLS]).toEqual(['mpv-ipc', 'json-lines']);
    expect([...PLAYER_ENGINE_PLACEHOLDERS]).toEqual(['wid', 'pipe', 'url', 'start', 'volume', 'fit', 'rate']);
    expect([...PLAYER_ENGINE_CAPABILITIES]).toEqual(['seek', 'rate', 'tracks', 'subtitle', 'fit']);
  });

  it('两协议的合法最小形态都通过', () => {
    expect(validatePlayerEngineContribute(mpv())).toEqual({ ok: true });
    expect(validatePlayerEngineContribute(jl())).toEqual({ ok: true });
    // local-path 来源：不带 file 也合法（路径由用户在配置页填）
    expect(validatePlayerEngineContribute(mpv({ binary: { source: 'local-path' } }))).toEqual({ ok: true });
  });

  it('binary 缺省 → 视为 `{source:\'plugin-file\'}` ⇒ **file 必填**（不写 binary 同样拒）', () => {
    expect(validatePlayerEngineContribute(mpv({ binary: undefined }))).toMatchObject({ ok: false, reasonCode: 'PLAYER_ENGINE_INVALID' });
    expect(validatePlayerEngineContribute(mpv({ binary: {} }))).toMatchObject({ ok: false, reasonCode: 'PLAYER_ENGINE_INVALID' });
    // 只写 file（source 取缺省 plugin-file）→ 合法
    expect(validatePlayerEngineContribute(mpv({ binary: { file: 'files/mpv.exe' } }))).toEqual({ ok: true });
  });

  it('capabilities（若写）逐项白名单 + 不重复', () => {
    expect(validatePlayerEngineContribute(mpv({ capabilities: ['seek', 'fit', 'tracks'] }))).toEqual({ ok: true });
    for (const capabilities of ['seek', [], ['nope'], ['seek', 'seek']]) {
      expect(validatePlayerEngineContribute(mpv({ capabilities }))).toMatchObject({ ok: false, reasonCode: 'PLAYER_ENGINE_INVALID' });
    }
  });
});

describe('player.engine 契约 — 结构边界', () => {
  it('id / label / protocol / 顶层未知字段 → PLAYER_ENGINE_INVALID', () => {
    expect(validatePlayerEngineContribute(mpv({ id: 'A' }))).toMatchObject({ ok: false, reasonCode: 'PLAYER_ENGINE_INVALID' });
    expect(validatePlayerEngineContribute(mpv({ label: '  ' }))).toMatchObject({ ok: false, reasonCode: 'PLAYER_ENGINE_INVALID' });
    expect(validatePlayerEngineContribute(mpv({ label: 'x'.repeat(41) }))).toMatchObject({ ok: false, reasonCode: 'PLAYER_ENGINE_INVALID' });
    expect(validatePlayerEngineContribute(mpv({ label: 'a\nb' }))).toMatchObject({ ok: false, reasonCode: 'PLAYER_ENGINE_INVALID' });
    expect(validatePlayerEngineContribute(mpv({ protocol: 'vlc-rc' }))).toMatchObject({ ok: false, reasonCode: 'PLAYER_ENGINE_INVALID' });
    expect(validatePlayerEngineContribute(mpv({ protocol: undefined }))).toMatchObject({ ok: false, reasonCode: 'PLAYER_ENGINE_INVALID' });
    expect(validatePlayerEngineContribute(mpv({ icon: 'star' }))).toMatchObject({ ok: false, reasonCode: 'PLAYER_ENGINE_INVALID' });
    expect(validatePlayerEngineContribute(null)).toMatchObject({ ok: false, reasonCode: 'PLAYER_ENGINE_INVALID' });
    expect(validatePlayerEngineContribute([])).toMatchObject({ ok: false, reasonCode: 'PLAYER_ENGINE_INVALID' });
  });

  it('binary 形态：plugin-file 缺 file / local-path 带 file / source 非法 / 未知字段 / file 越界 → PLAYER_ENGINE_INVALID', () => {
    expect(validatePlayerEngineContribute(mpv({ binary: { source: 'plugin-file' } }))).toMatchObject({ ok: false, reasonCode: 'PLAYER_ENGINE_INVALID' });
    expect(validatePlayerEngineContribute(mpv({ binary: { source: 'local-path', file: 'files/x.exe' } }))).toMatchObject({ ok: false, reasonCode: 'PLAYER_ENGINE_INVALID' });
    expect(validatePlayerEngineContribute(mpv({ binary: { source: 'plugin-binary', file: 'x.exe' } }))).toMatchObject({ ok: false, reasonCode: 'PLAYER_ENGINE_INVALID' });
    expect(validatePlayerEngineContribute(mpv({ binary: { source: 'plugin-file', file: 'x.exe', extra: 1 } }))).toMatchObject({ ok: false, reasonCode: 'PLAYER_ENGINE_INVALID' });
    expect(validatePlayerEngineContribute(mpv({ binary: 'files/x.exe' }))).toMatchObject({ ok: false, reasonCode: 'PLAYER_ENGINE_INVALID' });
    expect(validatePlayerEngineContribute(mpv({ binary: ['files/x.exe'] }))).toMatchObject({ ok: false, reasonCode: 'PLAYER_ENGINE_INVALID' });
    for (const file of ['../x.exe', '/etc/x', 'C:/x.exe', 'a/../../b.exe', '']) {
      expect(validatePlayerEngineContribute(mpv({ binary: { source: 'plugin-file', file } })), file)
        .toMatchObject({ ok: false, reasonCode: 'PLAYER_ENGINE_INVALID' });
    }
  });

  it('args 结构性：非数组 / 空 / 超 24 / 含换行 / 空串 / 非字符串 / 占位符越界 → BAD_ENGINE_ARGS', () => {
    for (const args of [undefined, null, 'x', [], new Array(25).fill('--a')]) {
      expect(validatePlayerEngineContribute(mpv({ args }))).toMatchObject({ ok: false, reasonCode: 'BAD_ENGINE_ARGS' });
    }
    for (const args of [
      ['--a\nb', '--wid={wid}', '--input-ipc-server={pipe}', '{url}'],
      ['--wid={wid}', '--input-ipc-server={pipe}', '{url}', '   '],
      ['--wid={wid}', '--input-ipc-server={pipe}', '{url}', 5],
      ['--wid={wid}', '--input-ipc-server={pipe}', '{url}', '--foo={nope}'],
    ]) {
      expect(validatePlayerEngineContribute(mpv({ args }))).toMatchObject({ ok: false, reasonCode: 'BAD_ENGINE_ARGS' });
    }
  });

  it('★ 按协议校验占位符：mpv-ipc 必需 {wid}/{url}/{pipe}；json-lines 不得带 {pipe}', () => {
    // mpv-ipc 缺任一必需 → BAD_ENGINE_ARGS
    expect(validatePlayerEngineContribute(mpv({ args: ['--wid={wid}', '{url}'] }))).toMatchObject({ ok: false, reasonCode: 'BAD_ENGINE_ARGS' });
    expect(validatePlayerEngineContribute(mpv({ args: ['{url}', '--input-ipc-server={pipe}'] }))).toMatchObject({ ok: false, reasonCode: 'BAD_ENGINE_ARGS' });
    expect(validatePlayerEngineContribute(mpv({ args: ['--wid={wid}', '--input-ipc-server={pipe}'] }))).toMatchObject({ ok: false, reasonCode: 'BAD_ENGINE_ARGS' });
    // json-lines 带 {pipe}（作者误解协议）→ BAD_ENGINE_ARGS
    expect(validatePlayerEngineContribute(jl({ args: ['--wid={wid}', '{url}', '--pipe={pipe}'] }))).toMatchObject({ ok: false, reasonCode: 'BAD_ENGINE_ARGS' });
    // json-lines 缺 {wid} / {url} → BAD_ENGINE_ARGS
    expect(validatePlayerEngineContribute(jl({ args: ['{url}'] }))).toMatchObject({ ok: false, reasonCode: 'BAD_ENGINE_ARGS' });
    expect(validatePlayerEngineContribute(jl({ args: ['--wid={wid}'] }))).toMatchObject({ ok: false, reasonCode: 'BAD_ENGINE_ARGS' });
    // 可选占位符（{start}/{volume}/{fit}/{rate}）可缺（不算错）
    expect(validatePlayerEngineContribute(mpv({ args: ['--wid={wid}', '{url}', '--input-ipc-server={pipe}', '--speed={rate}'] }))).toEqual({ ok: true });
  });

  it('playerEngineContributeOf：多条取第一个；未声明 → undefined；清单级（asset 拒 / code 通过且 L4）', () => {
    const m = codeManifest(mpv());
    expect(playerEngineContributeOf(m.contributes)?.id).toBe('my-mpv');
    expect(playerEngineContributeOf(codeManifest({}).contributes)).toBeUndefined();

    // asset + player.engine → kind 不匹配（CONTRIBUTES 已冻结为 ['code']）
    expect(validatePluginManifest({
      manifestVersion: 1, id: 'asset-pack', name: 'A', version: '1.0.0', apiVersion: HOST_API_VERSION,
      kind: 'asset', permissions: [], contributes: [mpv() as PluginManifest['contributes'][number]],
    })).toMatchObject({ ok: false, reasonCode: 'UNKNOWN_CONTRIBUTE_KIND' });

    // code + 合法描述符 → 通过；分级恒 L4；内容非法时与直校同码
    expect(validatePluginManifest(m)).toEqual({ ok: true });
    expect(pluginLevelOf(m)).toBe('L4');
    expect(validatePluginManifest(codeManifest(jl({ args: ['--wid={wid}', '{url}', '--pipe={pipe}'] }))))
      .toMatchObject({ ok: false, reasonCode: 'BAD_ENGINE_ARGS' });
    expect(validatePluginManifest(codeManifest(mpv({ protocol: 'nope' }))))
      .toMatchObject({ ok: false, reasonCode: 'PLAYER_ENGINE_INVALID' });
  });
});

describe('engineLines · expandEngineArgs（参数模板展开）', () => {
  it('必需占位符逐项替换（{wid}/{pipe}/{url}）', () => {
    expect(expandEngineArgs(['--wid={wid}', '--input-ipc-server={pipe}', '{url}'], {
      wid: '123456', pipe: '\\\\.\\pipe\\x', url: 'https://v.test/a.mkv',
    })).toEqual(['--wid=123456', '--input-ipc-server=\\\\.\\pipe\\x', 'https://v.test/a.mkv']);
  });

  it('★ 可选占位符缺省 → 该参数项**整项丢弃**（避免传空串导致内核报错）', () => {
    const args = ['--wid={wid}', '{url}', '--start={start}', '--volume={volume}', '--speed={rate}', '--panscan={fit}'];
    // 都给值 → 全保留
    expect(expandEngineArgs(args, { wid: '1', url: 'u', start: 12, volume: 100, rate: 1.5, fit: 'cover' }))
      .toEqual(['--wid=1', 'u', '--start=12', '--volume=100', '--speed=1.5', '--panscan=cover']);
    // 都没给 → 只剩必需项
    expect(expandEngineArgs(args, { wid: '1', url: 'u' })).toEqual(['--wid=1', 'u']);
    // ★ `0` 是**显式值**（音量 0 = 静音有意义）→ 保留；只有「缺省/空串」才整项丢弃
    expect(expandEngineArgs(args, { wid: '1', url: 'u', rate: 0, fit: 'contain' }))
      .toEqual(['--wid=1', 'u', '--speed=0', '--panscan=contain']);
  });

  it('空串视为「无值」→ 整项丢弃；空项直接跳过', () => {
    expect(expandEngineArgs(['--start={start}', '{url}'], { url: 'u', start: '' as unknown as number })).toEqual(['u']);
    expect(expandEngineArgs(['', '{url}'] as string[], { url: 'u' })).toEqual(['u']);
  });

  it('契约外占位符原样保留（容错，不抛）', () => {
    expect(expandEngineArgs(['--x={nope}', '{url}'], { url: 'u' })).toEqual(['--x={nope}', 'u']);
  });
});

describe('engineLines · json-lines 下行命令', () => {
  it('play / pause / seek / volume / rate / fit 逐条映射为一行 JSON', () => {
    expect(engineCommandLines({ type: 'play' })).toEqual(['{"cmd":"play"}\n']);
    expect(engineCommandLines({ type: 'pause' })).toEqual(['{"cmd":"pause"}\n']);
    expect(engineCommandLines({ type: 'seek', value: 12.5 })).toEqual(['{"cmd":"seek","value":12.5}\n']);
    expect(engineCommandLines({ type: 'volume', value: 0.8 })).toEqual(['{"cmd":"volume","value":0.8}\n']);
    expect(engineCommandLines({ type: 'rate', value: 1.5 })).toEqual(['{"cmd":"rate","value":1.5}\n']);
    expect(engineCommandLines({ type: 'fit', value: 'cover' })).toEqual(['{"cmd":"fit","value":"cover"}\n']);
  });

  it('值钳制 / 非法值 → 空数组（不下发坏命令）', () => {
    expect(engineCommandLines({ type: 'seek', value: -3 })).toEqual(['{"cmd":"seek","value":0}\n']);
    expect(engineCommandLines({ type: 'volume', value: 2 })).toEqual(['{"cmd":"volume","value":1}\n']);
    expect(engineCommandLines({ type: 'rate', value: 9 })).toEqual(['{"cmd":"rate","value":4}\n']);
    expect(engineCommandLines({ type: 'rate', value: 0 })).toEqual([]);
    expect(engineCommandLines({ type: 'seek', value: Number.NaN })).toEqual([]);
    expect(engineCommandLines({ type: 'fit', value: '' })).toEqual(['{"cmd":"fit","value":"contain"}\n']);
  });

  it('mpv 专属命令在通用族无对应动作 → 空数组（capabilities 收敛，不提供假能力）', () => {
    for (const cmd of [
      { type: 'aid', value: 2 }, { type: 'sid', value: -1 }, { type: 'sub-add', text: 'x' },
      { type: 'sub-font', value: 40 }, { type: 'audio-spdif', value: 'ac3' },
      { type: 'glsl-shaders', value: [] }, { type: 'sr-mode', value: 'high' },
    ] as const) {
      expect(engineCommandLines(cmd as Parameters<typeof engineCommandLines>[0]), cmd.type).toEqual([]);
    }
  });

  it('起播 load 行：缺省值补全 / 给定值原样；quit 行固定', () => {
    expect(JSON.parse(engineLoadLine({ url: 'https://v.test/a.mkv' })))
      .toEqual({ cmd: 'load', url: 'https://v.test/a.mkv', start: 0, paused: false, volume: 1, rate: 1, fit: 'contain' });
    expect(JSON.parse(engineLoadLine({ url: 'u', start: 12.5, paused: true, volume: 0.5, rate: 1.5, fit: 'cover' })))
      .toEqual({ cmd: 'load', url: 'u', start: 12.5, paused: true, volume: 0.5, rate: 1.5, fit: 'cover' });
    expect(ENGINE_QUIT_LINE).toBe('{"cmd":"quit"}\n');
    // 负 start 归 0（与 mpv `--start` 只在 >0 时下发同口径）
    expect(JSON.parse(engineLoadLine({ url: 'u', start: -3 })).start).toBe(0);
  });
});

describe('engineLines · reduceEngineEvent（json-lines 上行事件归约）', () => {
  it('loaded：置 loaded；带有限 duration 时一并落 duration 并纠正 live；live:true 则置直播', () => {
    const s = initialKernelState(true);
    expect(reduceEngineEvent(s, { event: 'loaded', duration: 123.4, live: false })).toBe(true);
    expect(s).toMatchObject({ loaded: true, duration: 123.4, live: false });
    const s2 = initialKernelState(false);
    expect(reduceEngineEvent(s2, { event: 'loaded', live: true })).toBe(true);
    expect(s2).toMatchObject({ loaded: true, live: true, duration: null });
    // 重复 loaded → 无变化
    expect(reduceEngineEvent(s, { event: 'loaded' })).toBe(false);
  });

  it('time / duration / paused / buffering：逐字段对应 MpvKernelState', () => {
    const s = initialKernelState();
    expect(reduceEngineEvent(s, { event: 'time', value: 0.2 })).toBe(true);
    expect(s.time).toBe(0.2);
    expect(s.playbackStarted).toBe(false); // ≤0.25 不算真正播起来
    expect(reduceEngineEvent(s, { event: 'time', value: 12.3 })).toBe(true);
    expect(s).toMatchObject({ time: 12.3, playbackStarted: true });
    expect(reduceEngineEvent(s, { event: 'time', value: 12.3 })).toBe(false);

    expect(reduceEngineEvent(s, { event: 'duration', value: 123.4 })).toBe(true);
    expect(s).toMatchObject({ duration: 123.4, live: false });
    expect(reduceEngineEvent(s, { event: 'duration', value: null })).toBe(true);
    expect(s.duration).toBe(null);

    expect(reduceEngineEvent(s, { event: 'paused', value: true })).toBe(true);
    expect(s.paused).toBe(true);
    expect(reduceEngineEvent(s, { event: 'paused', value: true })).toBe(false);
    expect(reduceEngineEvent(s, { event: 'buffering', value: true })).toBe(true);
    expect(s.buffering).toBe(true);
  });

  it('eof / exit / error：置标志位；error 缺 message 时给人话兜底', () => {
    const s = initialKernelState();
    expect(reduceEngineEvent(s, { event: 'eof' })).toBe(true);
    expect(s.eof).toBe(true);
    expect(reduceEngineEvent(s, { event: 'eof' })).toBe(false);
    expect(reduceEngineEvent(s, { event: 'exit' })).toBe(true);
    expect(s.exited).toBe(true);
    const e = initialKernelState();
    expect(reduceEngineEvent(e, { event: 'error', message: '解码失败' })).toBe(true);
    expect(e.error).toBe('解码失败');
    expect(reduceEngineEvent(e, { event: 'error', message: 'decode' })).toBe(true);
    expect(e.error).toBe('decode');
    expect(reduceEngineEvent(e, { event: 'error' })).toBe(true);
    expect(e.error).toBe('引擎报告错误');
  });

  it('tracks：audio/sub 归一到宿主轨道结构；内容不变 → 无变化；未知事件/非对象 → 忽略（前向兼容）', () => {
    const s = initialKernelState();
    expect(reduceEngineEvent(s, { event: 'tracks', audio: [{ id: 1, title: '国语' }, { id: 2, lang: 'jpn' }], sub: [{ id: 2 }] })).toBe(true);
    expect(s.audioTracks).toEqual([{ id: 1, title: '国语' }, { id: 2, lang: 'jpn' }]);
    expect(s.subtitles).toEqual([{ id: 2 }]);
    // 同内容再推 → false（避免无谓推送）
    expect(reduceEngineEvent(s, { event: 'tracks', audio: [{ id: 1, title: '国语' }, { id: 2, lang: 'jpn' }], sub: [{ id: 2 }] })).toBe(false);
    // 无 id 的轨道项被丢弃
    expect(reduceEngineEvent(s, { event: 'tracks', audio: [{ title: 'x' }], sub: [] })).toBe(true);
    expect(s.audioTracks).toEqual([]);

    for (const obj of [{ event: 'nope' }, { event: 'time' }, { foo: 1 }, null, 'x', 42]) {
      expect(reduceEngineEvent(initialKernelState(), obj), JSON.stringify(obj)).toBe(false);
    }
  });
});

describe('pluginPlayerEngine · 视图装配（exe 就绪判定）', () => {
  const owner = { id: 'engine-pack', name: '内核插件', dir: 'C:\\plugins\\engine-pack.winbox' };
  /** 只认「预期路径存在」的假 `exists` */
  const only = (expected: string) => (p: string) => p === expected;

  it('plugin-file：落在插件目录内 → 就绪；缺失 / 越界 → 未就绪 + 人话 note', () => {
    const c = mpv() as unknown as Parameters<typeof playerEngineFromContribute>[0];
    const full = 'C:\\plugins\\engine-pack.winbox\\files\\mpv.exe';
    const ready = playerEngineFromContribute(c, owner, '', only(full));
    expect(ready).toMatchObject({ id: 'engine:my-mpv', pluginId: 'engine-pack', pluginName: '内核插件', label: '我的 MPV', source: 'plugin-file', ready: true, path: full });

    const missing = playerEngineFromContribute(c, owner, '', () => false);
    expect(missing.ready).toBe(false);
    expect(missing.note).toBeTruthy();
    expect(missing.path).toBe(full);

    // 磁盘篡改：解析后越出插件目录 → 拒绝（不暴露越界路径）
    const escape = playerEngineFromContribute(
      mpv({ binary: { source: 'plugin-file', file: '..\\..\\evil.exe' } }) as unknown as Parameters<typeof playerEngineFromContribute>[0],
      owner, '', () => true,
    );
    expect(escape).toMatchObject({ ready: false });
    expect(escape.note).toContain('越出插件目录');
    expect(escape.path).toBeUndefined();
  });

  it('local-path：用户路径为空 / 不存在 → 未就绪；存在 → 就绪（路径即 exe）', () => {
    const c = mpv({ binary: { source: 'local-path' } }) as unknown as Parameters<typeof playerEngineFromContribute>[0];
    expect(playerEngineFromContribute(c, owner, '', () => true)).toMatchObject({ ready: false, source: 'local-path' });
    expect(playerEngineFromContribute(c, owner, '  ', () => true).note).toContain('未指定');
    expect(playerEngineFromContribute(c, owner, 'D:\\my-mpv\\mpv.exe', () => false)).toMatchObject({ ready: false, path: 'D:\\my-mpv\\mpv.exe' });
    expect(playerEngineFromContribute(c, owner, 'D:\\my-mpv\\mpv.exe', only('D:\\my-mpv\\mpv.exe')))
      .toMatchObject({ ready: true, path: 'D:\\my-mpv\\mpv.exe' });
  });

  it('capabilities 原样搬运（缺省 = 空数组，不发明能力）', () => {
    const withCaps = mpv({ capabilities: ['seek', 'fit'] }) as unknown as Parameters<typeof playerEngineFromContribute>[0];
    expect(playerEngineFromContribute(withCaps, owner, '', () => true).capabilities).toEqual(['seek', 'fit']);
    expect(playerEngineFromContribute(mpv() as never, owner, '', () => true).capabilities).toEqual([]);
  });
});
