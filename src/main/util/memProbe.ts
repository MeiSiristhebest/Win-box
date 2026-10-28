// src/main/util/memProbe.ts
/**
 * ★ 2026-10-17（用户报「播放 1080P 时吃数百 MB 内存、后台跑着五六个子进程，太臃肿」）：
 *   **内存基线探针**（诊断专用，不改任何功能行为）。
 *
 * 口径（先量化再优化，别盲猜）：
 *  ① Electron 自身进程 —— `app.getAppMetrics()` 逐进程取 workingSetSize（KB），
 *     并用 `webContents.getOSProcessId()` 把渲染进程标注成窗口编号，
 *     便于区分「主窗口常驻页缓存」与「播放器窗口」两笔账；
 *  ② 我们 spawn 的子进程 —— 按**父进程 = 主进程 pid** 归集（wmic 优先，缺失时回落 PowerShell CIM），
 *     再排除 Electron 自己那批 pid 与探针外壳（wmic/powershell/conhost/cmd）；
 *     ⇒ java / python / mpv / aria2c / ffmpeg 都会被算进来。
 *
 * 仅在 WINBOX_MEMORY_PROBE=1 时启用自动采样。播放开始（主进程 `media:state` 收到播放器窗口的 play/playing）→ 60s 窗口内每 5s 采一次
 *   （一次播放会话只跑一轮，避免反复刷屏）；另在启动后采一次「空闲基线」以作对照。
 *
 * 隐私：只落内存数字、进程名和窗口编号，**不含 URL / 窗口标题 / 凭据**（与 mediaDiag 同口径）。
 * 依赖：本模块 import electron（`app` / `BrowserWindow`），只供主进程使用。
 */
import { app, BrowserWindow } from 'electron';
import { execFile } from 'node:child_process';
import { fileLogger } from './logger';

/** 播放内存基线：采样窗口 60s、间隔 5s */
const PLAY_WATCH_MS = 60_000;
const SAMPLE_EVERY_MS = 5_000;
/** 归集子进程时排除「探针自身 / 外壳」进程 */
const HELPER_NAMES = new Set(['wmic.exe', 'powershell.exe', 'pwsh.exe', 'conhost.exe', 'cmd.exe']);

export interface Row {
  pid: number;
  name: string;
  mb: number;
}

export interface MemSample {
  reason: string;
  at: number;
  electron: Row[];
  children: Row[];
  electronMB: number;
  childMB: number;
  totalMB: number;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Electron 进程（`getAppMetrics().memory.workingSetSize` 单位是 KB）＋ 用不含标题的编号标记渲染窗口 */
export function electronRows(): Row[] {
  const labelByPid = new Map<number, string>();
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      const pid = w.webContents.getOSProcessId();
      labelByPid.set(pid, `window#${w.id}`);
    } catch {
      /* 窗口正在销毁 → 忽略 */
    }
  }
  try {
    const metrics = app.getAppMetrics();
    return metrics.map((m) => {
      const named = m as Electron.ProcessMetric & { name?: string };
      const label = labelByPid.get(m.pid);
      const svc = named.name && named.name !== 'Win-Box' ? named.name : '';
      return {
        pid: m.pid,
        name: `${m.type}${label ? `(${label})` : svc ? `(${svc})` : ''}`,
        mb: round1((m.memory?.workingSetSize ?? 0) / 1024),
      };
    });
  } catch {
    return [];
  }
}

/** `wmic process ... /format:list` 输出解析（WorkingSetSize 单位 = 字节） */
export function parseWmicList(out: string): Row[] {
  const rows: Row[] = [];
  let cur: Record<string, string> = {};
  const flush = (): void => {
    const pid = Number(cur.ProcessId);
    if (cur.Name && Number.isFinite(pid)) {
      rows.push({ pid, name: cur.Name, mb: round1((Number(cur.WorkingSetSize) || 0) / 1048576) });
    }
    cur = {};
  };
  for (const line of out.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) {
      flush();
      continue;
    }
    const i = t.indexOf('=');
    if (i > 0) cur[t.slice(0, i)] = t.slice(i + 1);
  }
  flush();
  return rows;
}

/** PowerShell `ConvertTo-Json` 输出解析（WorkingSetSize 单位 = 字节） */
export function parsePsJson(out: string): Row[] {
  let j: unknown = null;
  try {
    j = JSON.parse(out || 'null');
  } catch {
    return [];
  }
  const arr = Array.isArray(j) ? j : j ? [j] : [];
  return arr
    .map((o) => {
      const r = o as Record<string, unknown>;
      return { pid: Number(r.ProcessId), name: String(r.Name ?? ''), mb: round1((Number(r.WorkingSetSize) || 0) / 1048576) };
    })
    .filter((r) => Number.isFinite(r.pid) && !!r.name);
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 1 << 20, timeout: timeoutMs, killSignal: 'SIGKILL' }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout || ''));
    });
  });
}

/** 硬截止：任何外部命令卡住都不能拖住采样（否则整轮采样静默停摆） */
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(null); });
  });
}

/**
 * 按「父进程 = mainPid」归集我们 spawn 的子进程；排除 Electron 自身与探针外壳。
 * ★ 每一步都有硬截止（4s / 6s）：wmic 在系统繁忙时可能长时间无响应，
 *   没有截止会让本轮采样整体卡住（实测踩过：采到第 6 条后不再出数）。
 */
export async function childRows(mainPid: number, exclude: Set<number>): Promise<Row[]> {
  let rows: Row[] = [];
  const viaWmic = await withDeadline(
    run('wmic', ['process', 'where', `ParentProcessId=${mainPid}`, 'get', 'ProcessId,Name,WorkingSetSize', '/format:list'], 4000),
    4500,
  );
  if (viaWmic) {
    rows = parseWmicList(viaWmic);
  } else {
    const viaPs = await withDeadline(
      run('powershell', [
        '-NoProfile', '-NonInteractive', '-Command',
        `Get-CimInstance Win32_Process -Filter "ParentProcessId=${mainPid}" | Select-Object ProcessId,Name,WorkingSetSize | ConvertTo-Json -Compress`,
      ], 6000),
      6500,
    );
    if (viaPs) rows = parsePsJson(viaPs);
  }
  return rows.filter((r) => !exclude.has(r.pid) && !HELPER_NAMES.has(r.name.toLowerCase()));
}

/** 采一次并落一条 `[mem]` 单行日志（可 grep 回溯）；**永不抛**（采不到子进程也要出数） */
export async function sampleMemory(reason: string): Promise<MemSample> {
  let electron: Row[] = [];
  try { electron = electronRows(); } catch { /* ignore */ }
  let children: Row[] = [];
  try {
    children = await childRows(process.pid, new Set(electron.map((r) => r.pid)));
  } catch { /* ignore */ }
  const electronMB = round1(electron.reduce((a, r) => a + r.mb, 0));
  const childMB = round1(children.reduce((a, r) => a + r.mb, 0));
  const s: MemSample = {
    reason,
    at: Date.now(),
    electron,
    children,
    electronMB,
    childMB,
    totalMB: round1(electronMB + childMB),
  };
  fileLogger.i(formatSample(s));
  return s;
}

/** 单行可读格式：总量 + 分项明细（名字#pid=MB） */
export function formatSample(s: MemSample): string {
  const e = s.electron.map((r) => `${r.name}#${r.pid}=${r.mb}`).join(' ');
  const c = s.children.length ? s.children.map((r) => `${r.name}#${r.pid}=${r.mb}`).join(' ') : '无';
  return `[mem] ${s.reason} total=${s.totalMB}MB electron=${s.electronMB}MB(${s.electron.length}) children=${s.childMB}MB(${s.children.length}) | e=[${e}] | c=[${c}]`;
}

let watchUntil = 0;
/** 采样**串行化**：上一轮还没采完就跳过本次 tick，避免外部命令积压导致整轮静默停摆 */
let watchInFlight = false;

/**
 * 播放开始触发：60s 窗口内每 5s 采一次。同一播放会话内重复触发（play/playing 抖动）会被去重。
 * 只在**播放器窗口**的播放事件上调用（见 ipc/index.ts 的 MEDIA_STATE）。
 */
export function startPlayMemWatch(): void {
  if (process.env.WINBOX_MEMORY_PROBE !== '1') return;
  const now = Date.now();
  if (now < watchUntil) return; // 本轮窗口内重复触发 → 忽略
  watchUntil = now + PLAY_WATCH_MS + SAMPLE_EVERY_MS;
  const total = Math.floor(PLAY_WATCH_MS / SAMPLE_EVERY_MS);
  fileLogger.i(`[mem] 播放内存基线开始（${PLAY_WATCH_MS / 1000}s 窗口 / 每 ${SAMPLE_EVERY_MS / 1000}s 一次）`);
  const take = (reason: string): void => {
    if (watchInFlight) return;
    watchInFlight = true;
    void sampleMemory(reason).finally(() => { watchInFlight = false; });
  };
  take('play#0');
  let i = 0;
  const timer = setInterval(() => {
    i += 1;
    take(`play#${i}/${total}`);
    if (i >= total) {
      clearInterval(timer);
      fileLogger.i('[mem] 播放内存基线结束');
    }
  }, SAMPLE_EVERY_MS);
  timer.unref?.();
}
