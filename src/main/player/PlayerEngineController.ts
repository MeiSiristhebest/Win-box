// src/main/player/PlayerEngineController.ts
// ★ 2026-10-18（R11）：**第三方播放内核**的主进程侧 —— 单会话管理（宿主托管，插件永不拉进程）。
//
// 形态（D1 已拍板，见 R11 spec §3 / 插件制作规范 §6.3）：
//   插件只给「引擎描述符」（`PlayerEngineContribute`：协议 / 二进制来源 / 参数模板）；
//   **宿主**负责展开参数 → `spawn(exe, args)` → （mpv-ipc）`--wid` 由参数嵌入 + JSON IPC 管道通信 /
//   （json-lines）stdin/stdout 行协议 → 状态归约 → 节流推送（`engine:state`）。
//
// ★ 与 `MpvController` **实例分离**（内置 mpv 路径零回归）：两者共享 `mpvCore` 的纯函数，但各管各的会话。
// ★ 单会话是刻意的：同一时刻只有「独立播放器窗口」的一个引擎（换集/换内核 = stop + start 新进程）。
import { spawn, type ChildProcess } from 'node:child_process';
import { connect, type Socket } from 'node:net';
import type { BrowserWindow } from 'electron';
import type { Logger } from '../../shared/types';
import type { PlayerEngineProtocol } from '../../shared/plugin';
import type { MpvCommand, MpvKernelState, MpvStartOptions } from '../../shared/player';
import { IPC } from '../../shared/ipc-channels';
import { playerIsFullscreen, playerIsMini } from './PlayerWindow';
import { hwndOf } from './MpvController';
import { initialKernelState, mpvCmdLine, mpvCommandLines, mpvObserveLines, reduceMpvMessage } from './mpvCore';
import { ENGINE_QUIT_LINE, engineCommandLines, engineLoadLine, expandEngineArgs, reduceEngineEvent, type EngineArgVars } from './engineLines';

/** 状态推送节流（与 mpv 同口径：200ms ≈ 进度条刷新率，够用） */
const PUSH_INTERVAL_MS = 200;
/** IPC 管道连接总超时（仅 `mpv-ipc`） */
const CONNECT_TIMEOUT_MS = 6000;
/** quit 后的强杀宽限 */
const QUIT_GRACE_MS = 1500;

/** 一次引擎会话的启动规格（exe 与 args 均已由宿主解析/展开） */
export interface EngineLaunchSpec {
  /** 渲染层内核值：`engine:<contributeId>` */
  id: string;
  /** 已解析的 exe 绝对路径 */
  exe: string;
  /** 已替换占位符的参数（exe 不在其中 —— 由宿主拼命令行） */
  args: string[];
  protocol: PlayerEngineProtocol;
}

export class PlayerEngineController {
  private proc: ChildProcess | null = null;
  private sock: Socket | null = null;
  private state: MpvKernelState = initialKernelState();
  private session = 0;
  private target: BrowserWindow | null = null;
  private pushTimer: NodeJS.Timeout | null = null;
  private retiring = new Set<ChildProcess>();
  private pipeSeq = 0;
  private lineBuf = '';
  private protocol: PlayerEngineProtocol = 'mpv-ipc';
  private engineId = '';
  /**
   * `start()` 可能在首个进程连上之前被再次调用（换集/换内核时 React effect 会这样）。
   * 串行化整个启动过程，避免第二次调用漏掉第一个进程而留下两个引擎实例（同 MpvController）。
   */
  private startChain: Promise<void> = Promise.resolve();
  private unbindViewport: (() => void) | null = null;

  constructor(private log: Logger) {}

  get running(): boolean {
    return !!this.proc;
  }

  /** 当前会话的引擎 id（`engine:<contributeId>`；无会话 → ''） */
  get currentId(): string {
    return this.engineId;
  }

  /** 拉起一次引擎会话（先 stop 旧会话）；返回会话号，状态经 `ENGINE_STATE` 持续推送 */
  async start(win: BrowserWindow, spec: EngineLaunchSpec, opts: MpvStartOptions): Promise<{ session: number }> {
    this.stop();
    const reservation = this.session;
    const run = this.startChain.then(() => this.startInternal(win, spec, opts, reservation));
    this.startChain = run.then(() => undefined, () => undefined);
    return run;
  }

  private async startInternal(
    win: BrowserWindow,
    spec: EngineLaunchSpec,
    opts: MpvStartOptions,
    reservation: number,
  ): Promise<{ session: number }> {
    const exe = String(spec?.exe || '').trim();
    if (!exe) throw new Error('引擎可执行文件未就绪');
    const url = String(opts?.url || '').trim();
    if (!url) throw new Error('播放地址为空');
    if (reservation !== this.session || win.isDestroyed()) return { session: reservation };
    // 上一批退场进程必须先释放已嵌入的 HWND，另一个 VO 才能挂上去。
    await Promise.all([...this.retiring].map(proc => new Promise<void>(resolve => {
      if (proc.exitCode !== null || proc.signalCode !== null) { resolve(); return; }
      proc.once('exit', () => resolve());
    })));
    if (reservation !== this.session || win.isDestroyed()) return { session: reservation };

    this.session += 1;
    const session = this.session;
    this.target = win;
    this.protocol = spec.protocol;
    this.engineId = spec.id;
    this.state = initialKernelState(!!opts.live);
    this.lineBuf = '';

    const hwnd = hwndOf(win);
    if (!hwnd) throw new Error('无法取得播放器窗口句柄（引擎无法嵌入）');
    const pipe = spec.protocol === 'mpv-ipc'
      ? `\\\\.\\pipe\\winbox-engine-${process.pid}-${++this.pipeSeq}-${Date.now().toString(36)}`
      : '';
    const args = expandEngineArgs(spec.args, engineVars(hwnd, pipe, url, opts));
    this.log.i(`engine(${spec.id}): 启动（session=${session}，协议=${spec.protocol}）→ ${url.slice(0, 120)}`);

    const proc = spawn(exe, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    proc.on('error', (e) => {
      this.log.w(`engine(${spec.id}): 进程错误 ${e.message}`);
      if (session === this.session) this.markExited();
    });
    proc.on('exit', (code) => {
      this.log.i(`engine(${spec.id}): 进程退出 code=${String(code)}`);
      if (session === this.session) this.markExited();
    });

    if (spec.protocol === 'json-lines') {
      const onErr = (chunk: Buffer): void => this.logLines(spec.id, chunk);
      proc.stderr?.on('data', onErr);
      proc.stdout?.on('data', (d: Buffer) => this.onJsonData(d, session));
      try {
        proc.stdin?.write(engineLoadLine({
          url,
          start: opts.startTime,
          paused: opts.paused,
          volume: opts.volume ?? 1,
          rate: opts.rate ?? 1,
          fit: opts.fit,
        }));
      } catch {
        /* 写失败：进程可能已退出，由 error/exit 事件兜底 */
      }
      return { session };
    }

    // ---- mpv-ipc：stdout/stderr 只做日志，控制/状态走 JSON IPC 管道 ----
    proc.stdout?.on('data', (d: Buffer) => this.logLines(spec.id, d));
    proc.stderr?.on('data', (d: Buffer) => this.logLines(spec.id, d));
    let sock: Socket;
    try {
      sock = await this.connectPipe(pipe, CONNECT_TIMEOUT_MS);
    } catch (e) {
      if (proc === this.proc) this.stop();
      throw e;
    }
    // 连接期间可能已被 stop/换集 → 丢弃这条管道
    if (session !== this.session || proc !== this.proc) {
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      return { session };
    }
    this.sock = sock;
    const updateViewport = () => {
      if (session !== this.session || win.isDestroyed()) return;
      const height = win.getContentBounds().height;
      const titleHeight = playerIsFullscreen() ? 0 : playerIsMini() ? 18 : 38;
      try {
        sock.write(mpvCmdLine(['set_property', 'video-margin-ratio-top', titleHeight / Math.max(1, height)]));
      } catch {
        /* ignore */
      }
      win.webContents.invalidate();
    };
    win.on('resize', updateViewport);
    win.on('enter-full-screen', updateViewport);
    win.on('leave-full-screen', updateViewport);
    this.unbindViewport = () => {
      win.removeListener('resize', updateViewport);
      win.removeListener('enter-full-screen', updateViewport);
      win.removeListener('leave-full-screen', updateViewport);
    };
    updateViewport();
    sock.on('data', (d: Buffer) => this.onSockData(d, session));
    sock.on('error', () => undefined);
    sock.on('close', () => {
      if (this.sock === sock) this.sock = null;
    });
    sock.write(mpvObserveLines().join(''));
    // `paused` 没有对应占位符（地址与初始音量/倍速/位置均由参数模板承载）→ 单独下发一次
    sock.write(mpvCmdLine(['set_property', 'pause', opts.paused ? 'yes' : 'no']));
    return { session };
  }

  /** 控制命令（成功只代表已下发；按协议分派） */
  command(cmd: MpvCommand): boolean {
    if (!this.proc) return false;
    if (this.protocol === 'json-lines') {
      const lines = engineCommandLines(cmd);
      if (!lines.length) return false;
      try {
        for (const l of lines) this.proc.stdin?.write(l);
        return true;
      } catch {
        return false;
      }
    }
    const sock = this.sock;
    if (!sock) return false;
    try {
      const lines = mpvCommandLines(cmd);
      if (!lines.length) return false;
      for (const l of lines) sock.write(l);
      return true;
    } catch {
      return false;
    }
  }

  /** 停止会话（quit → 宽限后强杀；幂等） */
  stop(): void {
    this.unbindViewport?.();
    this.unbindViewport = null;
    const sock = this.sock;
    const proc = this.proc;
    const protocol = this.protocol;
    this.sock = null;
    this.proc = null;
    this.target = null;
    this.session += 1; // 在途事件/连接立即作废
    if (this.pushTimer) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
    try {
      if (protocol === 'json-lines') proc?.stdin?.write(ENGINE_QUIT_LINE);
      else sock?.write(mpvCmdLine(['quit']));
    } catch {
      /* ignore */
    }
    try {
      sock?.end();
    } catch {
      /* ignore */
    }
    try {
      if (protocol === 'json-lines') proc?.stdin?.end();
    } catch {
      /* ignore */
    }
    if (proc && !proc.killed && proc.exitCode === null && proc.signalCode === null) {
      this.retiring.add(proc);
      const quitTimer = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          /* ignore */
        }
      }, QUIT_GRACE_MS);
      proc.once('exit', () => {
        clearTimeout(quitTimer);
        this.retiring.delete(proc);
      });
    }
    this.state = initialKernelState();
    this.engineId = '';
  }

  /** 退出应用（index.ts will-quit） */
  dispose(): void {
    this.stop();
  }

  // ---- 内部 ----

  private async connectPipe(pipe: string, timeoutMs: number): Promise<Socket> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const ok = await new Promise<Socket | null>((resolve) => {
        const s = connect(pipe);
        const onErr = (): void => {
          s.removeListener('connect', onOk);
          s.destroy();
          resolve(null);
        };
        const onOk = (): void => {
          s.removeListener('error', onErr);
          resolve(s);
        };
        s.once('error', onErr);
        s.once('connect', onOk);
      });
      if (ok) return ok;
      if (Date.now() > deadline) throw new Error('引擎通信管道连接超时（进程可能启动失败）');
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  /** 引擎自身输出 → 日志（与 mpv 同口径：只落最前 200 字，避免刷屏） */
  private logLines(id: string, chunk: Buffer): void {
    for (const line of String(chunk).split(/\r?\n/)) {
      const s = line.trim();
      if (s) this.log.w(`engine(${id}): ${s.slice(0, 200)}`);
    }
  }

  /** `mpv-ipc`：JSON IPC 行 → `reduceMpvMessage` 归约 */
  private onSockData(d: Buffer, session: number): void {
    if (session !== this.session) return;
    this.lineBuf += String(d);
    const lines = this.lineBuf.split('\n');
    this.lineBuf = lines.pop() || '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (reduceMpvMessage(this.state, msg)) {
        this.schedulePush(this.state.loaded || this.state.eof || this.state.exited);
      }
    }
  }

  /** `json-lines`：stdout 每行一个 JSON 对象 → `reduceEngineEvent` 归约 */
  private onJsonData(d: Buffer, session: number): void {
    if (session !== this.session) return;
    this.lineBuf += String(d);
    const lines = this.lineBuf.split('\n');
    this.lineBuf = lines.pop() || '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      let obj: unknown;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (reduceEngineEvent(this.state, obj)) {
        this.schedulePush(this.state.loaded || this.state.eof || this.state.exited);
      }
    }
  }

  private markExited(): void {
    if (this.state.exited) return;
    this.state.exited = true;
    this.schedulePush(true);
  }

  private schedulePush(immediate: boolean): void {
    if (immediate) {
      this.pushNow();
      return;
    }
    if (this.pushTimer) return;
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      this.pushNow();
    }, PUSH_INTERVAL_MS);
  }

  private pushNow(): void {
    const w = this.target;
    if (!w || w.isDestroyed()) return;
    try {
      w.webContents.send(IPC.ENGINE_STATE, { session: this.session, state: { ...this.state } });
    } catch {
      /* 窗口已关：忽略 */
    }
  }
}

/**
 * 参数模板变量（宿主按 **mpv CLI 口径** 取值，便于引擎描述符直接照抄 mpv 命令行）：
 *   `{wid}`=HWND 十进制 / `{pipe}`=IPC 管道名 / `{url}`=地址 /
 *   `{start}`=整数秒（≤0 **不提供** → 该参数项整项丢弃）/ `{volume}`=整数百分比 0~130 /
 *   `{rate}`=倍速浮点 / `{fit}`=画面比例串（PlayerFit）。
 */
function engineVars(hwnd: string, pipe: string, url: string, opts: MpvStartOptions): EngineArgVars {
  const start = Number(opts?.startTime) || 0;
  const vol = Number(opts?.volume);
  const rate = Number(opts?.rate);
  return {
    wid: hwnd,
    ...(pipe ? { pipe } : {}),
    url,
    ...(start > 0 ? { start: Math.floor(start) } : {}),
    volume: Math.round(Math.max(0, Math.min(1.3, Number.isFinite(vol) ? vol : 1)) * 100),
    rate: Number.isFinite(rate) && rate > 0 ? rate : 1,
    fit: String(opts?.fit || 'contain'),
  };
}
