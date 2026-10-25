import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { looksLikeZip, readZipEntries } from '../util/syncZip';
import type { JarSpiderBridgeHost } from './JarSpiderPorts';

export const PYTHON_RUNTIME_VERSION = '3.15.0';
export const PYTHON_RUNTIME_EMBED_SHA256 = 'a6999bcbcbe56f937159ef79c2630260eca99f65f7860bc5cd20430324079a44';

/** Owns Python archive preparation, dependencies and runner placement. Process orchestration stays in the bridge. */
export class EmbeddedPythonRuntime {
  private static readonly PY_VER = PYTHON_RUNTIME_VERSION;
  private pyRuntimeTask: Promise<string> | null = null;
  constructor(private readonly options: { runtimeDir?: string; jvmDir: string; archiveSha256?: string }, private readonly getHost: () => JarSpiderBridgeHost | undefined) {}
  private get pyRuntimeDir() { return this.options.runtimeDir; }
  private get jvmDir() { return this.options.jvmDir; }
  private get pythonEmbedArchiveSha256() { return this.options.archiveSha256 ?? PYTHON_RUNTIME_EMBED_SHA256; }
  private get host() { return this.getHost(); }
  private static readonly PYTHON_EMBED_URLS = [
    `https://mirrors.huaweicloud.com/python/${EmbeddedPythonRuntime.PY_VER}/python-${EmbeddedPythonRuntime.PY_VER}-embed-amd64.zip`,
    `https://registry.npmmirror.com/-/binary/python/${EmbeddedPythonRuntime.PY_VER}/python-${EmbeddedPythonRuntime.PY_VER}-embed-amd64.zip`,
    `https://www.python.org/ftp/python/${EmbeddedPythonRuntime.PY_VER}/python-${EmbeddedPythonRuntime.PY_VER}-embed-amd64.zip`,
  ];

  private static readonly PY_WHEELS: Array<{ name: string; pkg?: string; file: string; platform?: string; required: boolean }> = [
    { name: 'requests', file: 'requests-2.34.2-py3-none-any.whl', platform: 'py3-none-any', required: true },
    { name: 'urllib3', file: 'urllib3-2.8.0-py3-none-any.whl', platform: 'py3-none-any', required: true },
    { name: 'certifi', file: 'certifi-2026.7.22-py3-none-any.whl', platform: 'py3-none-any', required: true },
    { name: 'charset_normalizer', file: 'charset_normalizer-3.5.2-py3-none-any.whl', platform: 'py3-none-any', required: true },
    { name: 'idna', file: 'idna-3.20-py3-none-any.whl', platform: 'py3-none-any', required: true },
    { name: 'lxml', file: 'lxml-6.1.3-cp315-cp315-win_amd64.whl', platform: 'cp315-cp315-win_amd64', required: false },
    // ---- ★ 2026-09-30 新增（实测缺得最多的几族）----
    { name: 'Crypto', pkg: 'pycryptodome', file: 'pycryptodome-4.0.0-cp39-abi3-win_amd64.whl', platform: 'cp39-abi3-win_amd64', required: false },
    { name: 'bs4', pkg: 'beautifulsoup4', file: 'beautifulsoup4-4.15.0-py3-none-any.whl', platform: 'py3-none-any', required: false },
    { name: 'soupsieve', file: 'soupsieve-3.0.3-py3-none-any.whl', platform: 'py3-none-any', required: false },
    { name: 'pyquery', file: 'pyquery-2.1.0-py3-none-any.whl', platform: 'py3-none-any', required: false },
    { name: 'cssselect', file: 'cssselect-1.6.0-py3-none-any.whl', platform: 'py3-none-any', required: false },
    { name: 'PIL', pkg: 'Pillow', file: 'pillow-12.3.0-cp315-cp315-win_amd64.whl', platform: 'cp315-cp315-win_amd64', required: false },
    { name: 'cryptography', file: 'cryptography-50.0.2-cp39-abi3-win_amd64.whl', platform: 'cp39-abi3-win_amd64', required: false },
    { name: 'chardet', file: 'chardet-7.6.0-py3-none-any.whl', platform: 'py3-none-any', required: false },
    { name: 'cloudscraper', file: 'cloudscraper-1.2.71-py2.py3-none-any.whl', platform: 'py2.py3-none-any', required: false },
    { name: 'requests_toolbelt', pkg: 'requests-toolbelt', file: 'requests_toolbelt-1.0.0-py2.py3-none-any.whl', platform: 'py2.py3-none-any', required: false },
    { name: 'pyparsing', file: 'pyparsing-3.3.3-py3-none-any.whl', platform: 'py3-none-any', required: false },
    { name: 'curl_cffi', file: 'curl_cffi-0.16.3-cp310-abi3-win_amd64.whl', platform: 'cp310-abi3-win_amd64', required: false },
    { name: 'cffi', file: 'cffi-2.1.1-cp315-cp315-win_amd64.whl', platform: 'cp315-cp315-win_amd64', required: false },
    { name: 'pycparser', file: 'pycparser-3.11-py3-none-any.whl', platform: 'py3-none-any', required: false },
  ];

  private static readonly PY_WHEEL_SIMPLE = [
    'https://pypi.tuna.tsinghua.edu.cn/simple/',
    'https://mirrors.huaweicloud.com/repository/pypi/simple/',
  ];

  async ensure(): Promise<string> {
    // ★ 在途任务共享：预热与调用并发时不再下载两份运行时
    if (this.pyRuntimeTask) {
      const d = await this.pyRuntimeTask;
      if (d && existsSync(join(d, 'python.exe'))) return d;
    }
    const task = this.preparePythonRuntime();
    this.pyRuntimeTask = task
      .catch(() => '')
      .finally(() => { this.pyRuntimeTask = null; });
    return task;
  }

  private async preparePythonRuntime(): Promise<string> {
    if (!this.pyRuntimeDir) throw new Error('python 源需要嵌入式 Python 运行时，但未配置下载目录');
    const dir = join(this.pyRuntimeDir, EmbeddedPythonRuntime.PY_VER);
    const pyExe = join(dir, 'python.exe');
    if (existsSync(pyExe)) {
      // 运行时已就绪但第三方库/runner 可能缺失 → 幂等补齐（首次下载中断后重试自愈）
      await this.ensureRuntimeLibs(dir);
      this.placeRunnerFiles(dir);
      return dir;
    }
    const logger = this.host?.logger;
    let lastErr = '';
    for (const url of EmbeddedPythonRuntime.PYTHON_EMBED_URLS) {
      try {
        logger?.i?.(`python: 正在准备嵌入式 Python 运行时（${EmbeddedPythonRuntime.PY_VER} embed 约 13MB + 依赖安装；配置就绪后会后台预热）…`);
        const res = await this.host!.http.request({ url, method: 'get', timeoutMs: 180000, buffer: 2 });
        const buf = Buffer.from(Array.isArray(res.content) ? res.content as unknown as number[] : Buffer.from(String(res.content), 'base64'));
        if (buf.length < 1024 * 1024) { lastErr = `下载内容过小(${buf.length}B)`; continue; }
        const digest = createHash('sha256').update(buf).digest('hex');
        if (digest !== this.pythonEmbedArchiveSha256.toLowerCase()) {
          lastErr = `Python embed SHA-256 校验失败（${digest}）`;
          continue;
        }
        mkdirSync(dir, { recursive: true });
        this.unpackZipTo(buf, dir); // embed zip 标准 deflate，readZipEntries 解压（跳过目录条目）
        if (!existsSync(pyExe)) { lastErr = '下载内容缺少 python.exe（镜像可能返回错误页）'; continue; }
        await this.ensureRuntimeLibs(dir); // 第三方库失败直接抛（requests 缺失会让 base.spider 全灭）
        this.placeRunnerFiles(dir);
        logger?.i?.('python: 嵌入式 Python 运行时已就绪 ' + dir);
        return dir;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
    throw new Error(
      `python 源需要嵌入式 Python 运行时，自动下载失败（${lastErr}）。` +
      `可手动下载 python-${EmbeddedPythonRuntime.PY_VER}-embed-amd64.zip 解压到 ${dir}，` +
      `并把 lxml/requests/urllib3 的 wheel 解压进 ${join(dir, 'Lib', 'site-packages')} 后重试`,
    );
  }

  private unpackZipTo(buf: Buffer, dir: string): void {
    const fs = require('node:fs') as typeof import('node:fs');
    for (const e of readZipEntries(buf)) {
      if (e.name.endsWith('/')) continue;
      // 路径穿越防护：拒绝 ../ 与绝对路径（镜像内容不可信）
      const rel = e.name.replace(/\\/g, '/').split('/').filter((s) => s !== '..' && s !== '.' && s !== '').join('/');
      const clean = join(dir, rel);
      if (!clean.startsWith(dir)) continue;
      try { fs.mkdirSync(dirname(clean), { recursive: true }); } catch { /* ignore */ }
      fs.writeFileSync(clean, e.bytes);
    }
  }

  private async ensureRuntimeLibs(dir: string): Promise<void> {
    const sp = join(dir, 'Lib', 'site-packages');
    const pending = EmbeddedPythonRuntime.PY_WHEELS.filter((w) => !this.dirNonEmpty(join(sp, w.name)) ||
      (w.name === 'certifi' && !existsSync(join(sp, '.certifi-2026.7.22'))));
    const WAVE = 3;
    for (let i = 0; i < pending.length; i += WAVE) {
      await Promise.all(
        pending.slice(i, i + WAVE).map(async (w) => {
          const pkgDir = join(sp, w.name);
          const ok = await this.downloadWheel(dir, w).catch((e) => {
            if (w.required) throw e;
            this.host?.logger?.w?.(`python: 可选依赖 ${w.name} 下载失败（不影响纯 py 源）: ${(e as Error).message}`);
            return false;
          });
          if (!ok && w.required) throw new Error(`python: ${w.name} 下载失败`);
          if (ok && w.name === 'certifi') writeFileSync(join(sp, '.certifi-2026.7.22'), '');
          if (ok && !this.dirNonEmpty(pkgDir)) {
            if (w.required) throw new Error(`python: ${w.name} 解压后为空`);
            this.host?.logger?.w?.(`python: 可选依赖 ${w.name} 解压后为空（跳过）`);
          }
        }),
      );
    }
  }

  private dirNonEmpty(p: string): boolean {
    try {
      const fs = require('node:fs') as typeof import('node:fs');
      return existsSync(p) && fs.readdirSync(p).length > 0;
    } catch { return false; }
  }

  private async downloadWheel(dir: string, w: { name: string; pkg?: string; file: string; platform?: string }): Promise<boolean> {
    const sp = join(dir, 'Lib', 'site-packages');
    mkdirSync(sp, { recursive: true });
    const fs = require('node:fs') as typeof import('node:fs');
    const pushEntries = (buf: Buffer): void => {
      for (const e of readZipEntries(buf)) {
        if (e.name.endsWith('/')) continue;
        const rel = e.name.replace(/\\/g, '/').split('/').filter((s) => s !== '..' && s !== '.' && s !== '').join('/');
        const clean = join(sp, rel);
        try { fs.mkdirSync(dirname(clean), { recursive: true }); } catch { /* ignore */ }
        fs.writeFileSync(clean, e.bytes);
      }
    };
    const project = w.pkg || w.name;
    for (const simpleBase of EmbeddedPythonRuntime.PY_WHEEL_SIMPLE) {
      try {
        // 1) 索引页 → 找目标文件 href（HttpClient buffer:2 返回 base64 字符串，先解码）
        const idx = await this.host!.http.request({ url: `${simpleBase}${project}/`, method: 'get', timeoutMs: 60000, buffer: 2 });
        const idxBuf = Buffer.from(Array.isArray(idx.content) ? idx.content as unknown as number[] : Buffer.from(String(idx.content), 'base64'));
        const html = idxBuf.toString('utf8');
        // 精确文件名优先（首选版本）；镜像清理旧版时退化为**同平台标签**的任一 wheel（版本无关）
        let href = html.match(new RegExp(`href="([^"]*${escapeRegExp(w.file)}[^"]*)"`))?.[1];
        if (!href && w.platform) {
          const tag = w.platform;
          const all = [...html.matchAll(/href="([^"]+\.whl[^"]*)"/g)].map((m) => m[1]);
          href = all.find((h) => h.includes(tag));
        }
        if (!href) continue;
        // href 形如 `../../packages/<hash>/<file>` → 相对 simpleBase 解析
        const real = new URL(href.replace(/&amp;/g, '&'), `${simpleBase}${project}/`).href;
        const res = await this.host!.http.request({ url: real, method: 'get', timeoutMs: 120000, buffer: 2 });
        const buf = Buffer.from(Array.isArray(res.content) ? res.content as unknown as number[] : Buffer.from(String(res.content), 'base64'));
        if (buf.length < 1024) continue; // 404/HTML 错误页
        if (!looksLikeZip(buf)) continue;
        pushEntries(buf);
        if (!this.dirNonEmpty(join(sp, w.name))) continue;
        return true;
      } catch { /* 换下一个镜像 */ }
    }
    throw new Error(`python: wheel ${w.file} 全部镜像下载失败`);
  }

  placeRunnerFiles(dir: string): void {
    try {
      const fs = require('node:fs') as typeof import('node:fs');
      const src = join(this.jvmDir, 'python-runner');
      const srcRunner = join(src, 'runner.py');
      if (!existsSync(srcRunner)) {
        this.host?.logger?.w?.('python: 随包 runner 缺失（resources/jvm/python-runner），py 源将无法运行');
        return;
      }
      const dstRunner = join(dir, 'runner.py');
      const dstBase = join(dir, 'base');
      // 随包文件不比已落盘的更新（且 base/ 存在）→ 无需重拷
      if (existsSync(dstBase) && this.mtimeMs(srcRunner) <= this.mtimeMs(dstRunner)) return;
      fs.cpSync(srcRunner, dstRunner, { force: true });
      const bSrc = join(src, 'base');
      if (existsSync(bSrc)) fs.cpSync(bSrc, dstBase, { recursive: true, force: true });
    } catch (e) {
      this.host?.logger?.w?.(`python: runner 落盘失败: ${(e as Error).message}`);
    }
  }

  private mtimeMs(p: string): number {
    try {
      const fs = require('node:fs') as typeof import('node:fs');
      return fs.statSync(p).mtimeMs;
    } catch { return 0; }
  }

  ready(): boolean {
    if (!this.pyRuntimeDir) return false;
    const dir = join(this.pyRuntimeDir, EmbeddedPythonRuntime.PY_VER);
    return existsSync(join(dir, 'python.exe')) && existsSync(join(dir, 'runner.py')) &&
      existsSync(join(dir, 'Lib', 'site-packages', '.certifi-2026.7.22')) &&
      EmbeddedPythonRuntime.PY_WHEELS.every(w => !w.required || this.dirNonEmpty(join(dir, 'Lib', 'site-packages', w.name)));
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
