// scripts/build-main.mjs — 用 esbuild 把主进程 + preload 打成 CJS（Electron 需 CJS）
import { build, context } from 'esbuild';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
// ★ 2026-10-14：okhttp 4.x 兼容 jar（`resources/jvm/okhttp4-compat/winbox-okhttp4-compat.jar`）是
//   **派生生成物**且 `resources/jvm/**/*.jar` 不进仓库 ⇒ 随构建现场产出，否则打包后该 jar 缺失、
//   蜘蛛里 okhttp 4.x 参数序的 `RequestBody.create(String, MediaType)` 调用会退回 NoSuchMethodError。
//   上游 jar 未 provision 时静默跳过（不阻断构建）。
import { generateOkHttp4Compat } from './gen-okhttp-compat.mjs';
// ★ 2026-10-14：prefs 影子 jar（`resources/jvm/prefs-shim/winbox-prefs-shim.jar`）同样是**派生生成物**
//   且 `resources/jvm/**/*.jar` 不进仓库 ⇒ 随构建现场产出；缺失时 stubs.jar 里那个纯内存的
//   `android/content/SharedPreferences$Mem` 会让 wex 族永远读到空 cookie。
import { generatePrefsShim } from './gen-prefs-shim.mjs';
import { generateNativeBridge } from './gen-native-bridge.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const src = resolve(root, '..');
const watch = process.argv.includes('--watch');
const devReadyFile = resolve(src, '.tmp', 'dev-main-build-ready');
const devReady = { main: false, worker: false };
let devBuildSerial = 0;

function devReadyPlugin(target) {
  return {
    name: `dev-ready-${target}`,
    setup(buildContext) {
      buildContext.onStart(() => {
        devReady[target] = false;
        rmSync(devReadyFile, { force: true });
      });
      buildContext.onEnd((result) => {
        devReady[target] = result.errors.length === 0;
        if (devReady.main && devReady.worker) {
          writeFileSync(devReadyFile, JSON.stringify({ pid: process.pid, serial: ++devBuildSerial }), 'utf8');
        }
      });
    },
  };
}

try {
  const r = await generateOkHttp4Compat();
  console.log(r ? `[okhttp4-compat] 已生成（追加 ${r.added} 个重载）` : '[okhttp4-compat] 跳过（上游 okhttp-3.14.9.jar 不存在）');
} catch (e) {
  console.warn(`[okhttp4-compat] 生成失败（不阻断构建）: ${(e && e.message) || e}`);
}

try {
  const r = await generatePrefsShim();
  console.log(`[prefs-shim] 已生成（${r.bytes} bytes, 影子类 ${r.entry}）`);
} catch (e) {
  console.warn(`[prefs-shim] 生成失败（不阻断构建）: ${(e && e.message) || e}`);
}

const nativeBridge = await generateNativeBridge();
console.log(`[native-bridge] ${nativeBridge.cached ? '已就绪' : '已生成'}（${nativeBridge.bytes} bytes）`);

const opts = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  sourcemap: true,
  // ★ 2026-09-24：wasm 解压库（字幕压缩包）走 external，运行时从 node_modules 加载，
  //   wasm 二进制由代码内 `wasmBinary` 显式传入（不依赖库内部的 __dirname 路径解析）。
  // Babel 8 uses import.meta.url at runtime; keep its ESM packages external so the CJS bundle does not replace it with undefined.
  external: [
    'electron',
    'iconv-lite',
    'fast-xml-parser',
    'node-unrar-js',
    '7z-wasm',
    '@babel/core',
    '@babel/parser',
    '@babel/plugin-transform-modules-commonjs',
  ],
  logLevel: 'info',
};

// `out` = 产物名（不带扩展名）：outdir 模式（watch）与 outfile 模式共用同一份清单，避免两条路径产物名不一致
const entries = [
  { in: resolve(src, 'src/main/index.ts'), out: 'main' },
  { in: resolve(src, 'src/main/preload.ts'), out: 'preload' },
  // ★ 2026-09-29（用户要求）本地包网页源窗口的 preload（注入 window.fm 桥）
  { in: resolve(src, 'src/main/webbridge/webhomePreload.ts'), out: 'webhome-preload' },
];

/**
 * ★★ 2026-09-30：JS 蜘蛛 worker 产物（`dist/js-worker.cjs`）。
 *   主进程用 `new Worker(代码, { eval: true })` 启动它（见 engine/js/worker/JsWorkerPool.ts）——
 *   eval 方式不依赖模块路径解析，asar 内也能跑。**必须整包 bundle**（cheerio/crypto-es/iconv-lite
 *   都要内联）：eval 出来的 worker 没有自己的目录，运行时 `require('cheerio')` 会解析不到。
 */
const workerFile = resolve(src, 'dist/js-worker.cjs');
const workerOpts = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  sourcemap: false,
  external: ['electron', '@babel/core', '@babel/parser', '@babel/plugin-transform-modules-commonjs'],
  logLevel: 'info',
};

/**
 * ★★ 2026-10-18（R10）：L4 插件沙箱 worker 产物（`dist/plugin-worker.cjs`）。
 *   同 js-worker 口径：主进程 `new Worker(code, { eval: true, workerData })` 启动（见
 *   plugin/sandbox/PluginSandbox.ts）。**整包 bundle** —— 只依赖 node 内建 + 本仓代码，
 *   不 import electron（第三方代码绝不能进主进程，worker 内也没有 electron）。
 */
const pluginWorkerFile = resolve(src, 'dist/plugin-worker.cjs');

if (watch) {
  mkdirSync(dirname(devReadyFile), { recursive: true });
  rmSync(devReadyFile, { force: true });
  const ctx = await context({
    ...opts,
    plugins: [...(opts.plugins || []), devReadyPlugin('main')],
    entryPoints: entries.map((e) => ({ in: e.in, out: e.out })),
    outdir: resolve(src, 'dist'),
    outExtension: { '.js': '.cjs' },
  });
  await ctx.watch();
  // worker 也进 watch（改动即重建）
  const wctx = await context({
    ...workerOpts,
    plugins: [...(workerOpts.plugins || []), devReadyPlugin('worker')],
    entryPoints: [resolve(src, 'src/engine/js/worker/entry.ts')],
    outfile: workerFile,
  });
  await wctx.watch();
  // ★ R10：L4 插件沙箱 worker 也进 watch
  const pctx = await context({
    ...workerOpts,
    entryPoints: [resolve(src, 'src/main/plugin/sandbox/pluginWorkerEntry.ts')],
    outfile: pluginWorkerFile,
  });
  await pctx.watch();
  console.log('[main] watching...');
} else {
  for (const e of entries) {
    await build({ ...opts, entryPoints: [e.in], outfile: resolve(src, `dist/${e.out}.cjs`) });
  }
  // ★ JS 蜘蛛 worker（独立 bundle，见上面 workerOpts 注释）
  await build({ ...workerOpts, entryPoints: [resolve(src, 'src/engine/js/worker/entry.ts')], outfile: workerFile });
  // ★ R10：L4 插件沙箱 worker（独立 bundle，见上面 pluginWorkerFile 注释）
  await build({ ...workerOpts, entryPoints: [resolve(src, 'src/main/plugin/sandbox/pluginWorkerEntry.ts')], outfile: pluginWorkerFile });
  console.log('[main] build done');
}
