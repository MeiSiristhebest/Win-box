import { EmbeddedPythonRuntime } from './EmbeddedPythonRuntime';
// src/engine/spider/JarSpiderBridge.ts
// ★ 等效 DexClassLoader 的 JVM 桥（Windows）。
// 流程：jar(dex) URL → 下载 → 提取 classes.dex → dex2jar 转换 → JVM 子进程 SpiderRunner 反射调用。
// 运行时资产（resources/jvm/）：jre/（jlink 裁剪）、d2j/（dex2jar 20M）、stubs/（安卓 stub + Spider 基类 + SpiderRunner）、libs/（okhttp/gson/jsoup）。
// 引擎层契约：所有宿主能力经 EngineHost 注入；本文件只做进程编排，不 import electron。
import { spawn } from 'node:child_process';
import {
  mkdirSync, existsSync, readFileSync, writeFileSync, statSync,
  renameSync, rmSync, copyFileSync,
} from 'node:fs';
import { totalmem } from 'node:os';
import { join, basename, resolve } from 'node:path';
import type { JarSpiderBridgeHost, JarResourceMergeLogger, JarSpiderRuntimePort } from './JarSpiderPorts';
import { md5Hex } from '../util/md5';
import { contentHashOf, recordContentKey, tryCloneByContent } from './jarContentIndex';
import { buildZip, listZipEntries, looksLikeZip, readZipEntries } from '../util/syncZip';
import { OneShotProcessBudget, SpiderProcPool, poolEnabled, servePoolKey, WARM_METHOD, type PoolResult } from './SpiderProcPool';
import { fixSelfSuperCallsInJarFile } from './classFix';
// ★ 2026-10-14：补全蜘蛛 jar 自带的极简 com.github.catvod.spider.Proxy（补 getProxyUrlDo）——
//   否则该类调用必 NoSuchMethodError（安卓端由 App dex 的同名完整类兜住，桌面端没有）。
import { patchSpiderProxyInJarFile } from './appProxyStub';
import {
  DetachedDex2jarCoordinator,
  DEX2JAR_TIMEOUT_MS,
  type DetachedDex2jarPort,
} from './DetachedDex2jar';
import { formatDuration } from './formatDuration';
import { normalizeJarUrl } from './jarSpiderUrl';
// ★ 2026-10-14：部分蜘蛛按 **okhttp 4.x** 参数序调用 `RequestBody.create`，桌面端只有 3.14.9 ⇒
//   必 NoSuchMethodError。修法 = 把「补了 4.x 重载的 RequestBody」打成小 jar 排在 -cp 最前
//   （父加载器先命中者生效，覆盖一切来源的调用者，含 Java 侧 runtime-dex 产物；见 okhttp4Compat.ts）。
import { OKHTTP4_COMPAT_JAR } from './okhttp4Compat';
import { PREFS_SHIM_JAR } from './prefsShim';
import { NativeSpiderRuntime } from './NativeSpiderRuntime';
import { createSpiderShellCompatibilityPorts, SpiderShellCompatibility } from './SpiderShellCompatibility';
import { extractBridgeNotes } from './spiderDiagnostics';
import type { SpiderCallResult } from './spiderCallResult';
import type { PythonSpiderRuntimePort } from './PythonSpiderRuntimePort';
import { PythonSpiderRuntimeAdapter } from './PythonSpiderRuntimeAdapter';
import {
  NATIVE_CALL_MIN_TIMEOUT_MS as nativeCallMinimumTimeout,
  d2jHeapMb as estimateD2jHeapMb,
  isOomOutput as hasOutOfMemoryEvidence,
  spiderProxyPort as deterministicSpiderProxyPort,
  totalDexBytes as estimateTotalDexBytes,
} from './jarBridgePolicy';
import {
  createJarExecutionLaunchPlan,
  buildJarJvmPrefix,
  decideJarPoolCallResult,
} from './jarExecutionPolicy';
import {
  ConvertedJarArtifactInspector,
  isUsableConvertedJar as isUsableConvertedJarFile,
} from './convertedJarArtifact';
import { prepareConvertedJarArtifact } from './JarArtifactPreparation';
import { repairDexConstructorArtifact } from './dexConstructorRepair';
import { runDexConstructorRepairProcess } from './dexConstructorRepairProcess';
import { runJarConversionWorkflow, type JarConversionWorkflowEvent } from './JarConversionWorkflow';
import { ConversionInFlightError, JarConversionRegistry } from './JarConversionRegistry';
import { JarClasspathResolver } from './JarClasspathResolver';
import { abortError, throwIfAborted } from '../util/abort';
import { spiderPoolCapacityResult } from './spiderPoolFailure';
import { Dex2jarConversion } from './Dex2jarConversion';
import { JarArchiveDownloader } from './JarArchiveDownloader';
import { mergeJarResourceEntries } from './jarResourceMerge';
import { SpiderSubprocessRunner } from './SpiderSubprocessRunner';
import { JarSpiderRuntimeSession } from './JarSpiderRuntimeSession';
import { decideJarCallFallback } from './jarCallFallbackPolicy';
import { ensureConvertedJarCacheVersion } from './convertedJarCacheVersion';

/**
 * ★ 转换产物格式版本（导出：单测与诊断用；**改变了「产物内容」就必须 +1**）。
 * 历史：
 * - v1：只写 dex2jar 输出（**丢掉了 assets/**，加固壳因此全废，第十二轮修复）
 * - v2：补齐 raw jar 的非 dex 资源（assets/**、META-INF/** 等）
 * - v3：修补「super 调用被转成自递归 invokespecial」（classFix.ts）—— 旧产物里这些类
 *       一调用就 StackOverflowError（整族盘搜蜘蛛受影响），必须作废重转才生效
 * - v4：普通 JAR 也执行 DexJarRepair，恢复被 dex2jar 误译的 NEW 类型及缺失构造器
 * - v5：补全 jar 自带的极简 `com.github.catvod.spider.Proxy`（补 `getProxyUrlDo`；见 appProxyStub.ts）
 *       —— 旧产物里该类调用必 NoSuchMethodError，必须作废重转才生效
 */
export const CONVERTED_CACHE_VERSION = 5;

export { formatDuration } from './formatDuration';
export { normalizeJarUrl } from './jarSpiderUrl';

/** The Python archive is checked against the digest published by Python.org. */
export { PYTHON_RUNTIME_VERSION, PYTHON_RUNTIME_EMBED_SHA256 } from './EmbeddedPythonRuntime';

export interface JarBridgeOptions {
  /** resources/jvm 目录（含 jre/d2j/stubs/libs） */
  jvmDir: string;
  /** 转换后的 jar 缓存目录 */
  cacheDir: string;
  /** 单次调用超时 ms */
  callTimeoutMs?: number;
  /**
   * shell-shim（方案 A 影子类）的真实实现路径：一份含真实 Spider 的 jar/目录。
   * 非空即启用 shell-shim（把 shell-shim.jar 插到子进程 classpath 最前，
   * 并透传 -Dtvbox.shellShimClasses）—— 见第十八轮结论。
   * 默认 undefined / 空 = 关闭，普通源行为完全不变。
   * 优先级高于环境变量 TVBOX_SHELL_SHIM_CLASSES（两者与 Java 影子类自身约定一致）。
   */
  shellShimClasses?: string;
  /**
   * ★ 嵌入式 CPython（.py 蜘蛛运行时）按需下载落盘目录（需可写；安装版建议 userData）。
    * 首次遇到 .py 源时下载并校验嵌入式 Python，再解压第三方库到此处，
   * 联网即可用、离线降级为 PY_UNSUPPORTED。缺省未配置则 .py 源降级。
   */
  pyRuntimeDir?: string;
  /** Synthetic archives in tests use their own digest. Production callers must omit this. */
  pythonEmbedArchiveSha256?: string;
  /**
   * ★ 2026-09-26：**ARM 原生桥**（unidbg）运行时按需下载落盘目录（需可写；安装版建议 userData）。
   *   蜘蛛 jar 内含 ARM/AArch64 `.so`（摸鱼/fty 等加固壳）时，首次调用会下载 unidbg 运行期
   *   （约 39MB，18 个 jar）到 `<nativeRuntimeDir>/<ver>/`，由 SpiderRunner 在**同一个类加载器**里
   *   起 unidbg 会话，并把 jar 里的 native 方法改写成转发实现（见 resources/jvm/native-bridge/）。
   *   缺省未配置则含 .so 的源按旧行为降级（native 调用抛 UnsatisfiedLinkError）。
   */
  nativeRuntimeDir?: string;
  /**
   * ★ 2026-09-25：**网络代理**注入点（由宿主提供，引擎保持平台无关）。
   *   返回 JVM 参数（`-Dhttp.proxyHost=…` 等）与子进程环境变量（`HTTP_PROXY` 等）；
   *   蜘蛛自己的 HTTP 请求走代理，才能访问被 DNS 污染 / TLS SNI 阻断的站点。
   *   每次调用现取（用户改了设置即时生效，无需重启）。
   */
  proxyProvider?: () => { jvmArgs: string[]; env: Record<string, string> };
  /**
   * ★ 2026-09-25：机器总内存（字节）。缺省取 `os.totalmem()`；
   * 只用于换算 dex2jar 的堆上限（见 d2jHeapMb），单测注入以便稳定断言、不依赖跑测机器的内存。
   */
  totalMemBytes?: number;
  /** Optional process boundary for detached dex2jar work, primarily for deterministic hosts. */
  detachedDex2jar?: DetachedDex2jarPort;
}

/**
 * ★ 2026-09-25：dex2jar 转换失败的**抑制窗口**。
 *   大 jar 的一次失败要付几十秒~几分钟 CPU（实测 11.3MB dex 转换 4 分钟、OOM 也要 2 分钟），
 *   而 100+ 源的大配置（摸鱼 / 18 类）**每个源都会来要一次转换** —— 不抑制就是「搜一次卡几分钟、
 *   大部分源全报错」。窗口内重复请求直接复用上次的失败原因，过期后允许重试（网络抖动可自愈）。
 */
/**
 * ★★ 2026-09-27「关软件也要转完 + 等待有感知」：dex2jar 转换**脱离 App 进程**，靠三个陪伴文件协调 ★★
 *
 * 每个 jar（按 URL 的 md5 为 key）在转换缓存目录里有三个兄弟文件：
 *
 * | 文件 | 作用 |
 * |---|---|
 * | `<key>.part.jar` | dex2jar 的 `-o` 输出。**写完整才有中央目录（EOCD）**，所以「写完了吗」= 末尾有没有 EOCD |
 * | `<key>.lock`     | 正在跑的那次转换（JSON：`pid`/`startedAt`/`heapMb`）—— App 重启后凭它**接管等待**而不是重转 |
 * | `<key>.d2j.log`  | dex2jar 的 stdout/stderr **落盘**（不走管道：App 退出后管道断裂会让它抛 IOException，反而把转换带崩） |
 *
 * 为什么必须这样（2026-09-26 真机日志实录）：同一只加固 jar 一天内被重转 5 次、每次 3.5 分钟 ——
 * 用户的原话是「**每次打开软件都要等很久**」。根因不是 dex2jar 慢，而是转换**随 App 进程生死**：
 * 关窗口 / 重启 / 点「清理缓存」，3 分钟的转换白跑，下次进源从头再来。
 * 现在：转换由 **detached 子进程**跑完并落盘（App 关了也继续），下次启动**收编**产物（秒级），
 * 正在跑的则**接管等待**（不重复起第二个进程 —— 两个进程写同一个 part 会把产物写坏）。
 */
/**
 * ★ 2026-09-27：**后台转换仍在进行**（不是失败）。
 *   与「转换失败」的区别：不计入转换登记簿的失败抑制窗口，
 *   上层的自动重试/用户点一次就能立刻再问一次进度，而不是被窗口挡住两分钟。
 */
export { ConversionInFlightError };

/**
 * ★★ 2026-09-26：蜘蛛 JVM 内「宿主代理」端口（确定性分配，勿随意改公式）★★
 *   背景：壳/蜘蛛用 `com.github.catvod.spider.ProxyOrigin.buildUrl(url, headers)` 把真实 url+请求头
 *   存进**本 JVM 的静态表**，再吐 `<host>/proxy?do=proxy&key=…`（见资源侧 `com.github.catvod.Proxy`）。
 *   key 只有本 JVM 能解 → 该 JVM 必须起一个小 HTTP 服务，并让宿主知道它的端口（播放期间把它钉住）。
 *   这里按「加载器参数」做确定性散列（同一批 jar → 同一端口），与池 key 一一对应；
 *   落在 19970~19999（避开 9978 本地代理与常见端口）。端口被占时 Java 侧会退化为临时端口（此时钉不住，仅影响回收保护）。
 */
export function spiderProxyPort(loadCp: string, base = 19970, span = 30): number {
  return deterministicSpiderProxyPort(loadCp, base, span);
}

/**
 * ★ 2026-09-26：含 ARM `.so` 的加固壳源的**单次调用预算下限**（ms）。
 *   守卫/加密要走 unidbg 模拟（同进程全局串行），实测 App88：home 53.9s、detail 295.5s
 *   （首调另付 ~10s 模拟器启动）。用默认 20s 预算 ⇒ 「守卫已通」也会被超时判死、用户看到的仍是失败。
 *   只对 nativeJars 非空的 jar 抬底；普通源（无 .so）行为完全不变。
 *   ★ 后续优化方向：减少壳内加密往返 / 缩短模拟器调用开销，届时可下调此值。
 */
export const NATIVE_CALL_MIN_TIMEOUT_MS = nativeCallMinimumTimeout;

/**
 * ★ 2026-09-25：**dex2jar 转换堆（MB）按 dex 体积自适应**。
 *
 *   事故：一个 11.3MB 的 `classes.dex`（Fish 系大 jar，1300+ 类）在写死的 `-Xmx256m` 下
 *   必然 `OutOfMemoryError`（dex2jar 的 IR 优化阶段 RemoveLocalFromSSA），
 *   表现为「该 jar 的所有源全部无法加载 / 无法搜索」—— 历史注释里「256m 处理 1MB 级 dex
 *   绰绰有余」对 400KB~1MB 的 jar 成立，对 10MB 级不成立。
 *
 *   实测锚点：同一只 jar 256m 必 OOM；1024m 正常完成（产物 4.8MB 类文件）。
 *   故按 `~128MB / 1MB dex` 给余量，再按机器总内存的 1/4 收口（夹在 [256, 1792]）：
 *   小内存机器不会被大堆拖垮，大内存机器能拿下大 jar。
 *
 * @param dexBytes     raw jar 内 `classes*.dex` 解压体积合计
 * @param totalMemBytes 机器总内存（`os.totalmem()`；便于单测注入）
 * @param attempt      第几次尝试（OOM 后按 2× 重试）
 */
export function d2jHeapMb(dexBytes: number, totalMemBytes: number, attempt = 1): number {
  return estimateD2jHeapMb(dexBytes, totalMemBytes, attempt);
}

/** raw jar 内 `classes*.dex` 的解压体积合计；读不出（非 zip / 无 dex）时按 raw 体积 ×3 兜底 */
function totalDexBytes(rawJar: Buffer): number {
  return estimateTotalDexBytes(rawJar);
}

/** 转换子进程输出里是否出现了「堆不够」的证据（dex2jar OOM 只在 stderr 留栈） */
export function isOomOutput(output: string): boolean {
  return hasOutOfMemoryEvidence(output);
}

/**
 * ★ 2026-09-26（用户报「摸鱼/R18 的配置一个主页都加载不出来」）：
 *   **转换产物有效性判定** —— 不能只看「文件存在且 size>0」。
 *
 *   dex2jar 带 `--force` 时**一启动就建输出流**，中途被杀（超时 / OOM / 用户关窗口 / 磁盘满）
 *   会在磁盘上留下一个 **22 字节的空 zip**（`PK\x05\x06` + 18 个 0）。旧逻辑只判 size>0
 *   → 这个残骸被当成「已转换好」的缓存，`resolvePaths` 照常交给 JVM →
 *   该 jar 的**全部源**一起报类找不到（现象：整份配置的主页/搜索全废，清理缓存前永不恢复）。
 *
 *   判据：是 zip，且**至少含一个 `.class`**（dex2jar 的正常产出必然是 .class）。
 *   只读中央目录，不解析内容，开销可忽略。
 */
export function isUsableConvertedJar(file: string): boolean {
  return isUsableConvertedJarFile(file);
}


export class JarSpiderBridge implements PythonSpiderRuntimePort, JarSpiderRuntimePort {
  private readonly jvmDir: string;
  private readonly cacheDir: string;
  private readonly callTimeoutMs: number;
  private readonly shellCompatibility: SpiderShellCompatibility;
  private readonly pythonRuntime: PythonSpiderRuntimeAdapter;
  /** ARM .so 检测与按需运行时准备由独立服务负责。 */
  private readonly nativeRuntime: NativeSpiderRuntime;
  /** ★ 网络代理注入点（宿主提供；空 = 不走代理） */
  private readonly proxyProvider?: () => { jvmArgs: string[]; env: Record<string, string> };
  /** ★ 机器总内存（dex2jar 堆上限的收口依据；见 d2jHeapMb） */
  private readonly totalMemBytes: number;
  /** jar URL → 转换后 jar 本地路径（进程内缓存） */
  private readonly conversionRegistry = new JarConversionRegistry();
  /** Missing entry classes are resolved through an isolated, content-aware classpath policy. */
  private readonly classpathResolver: JarClasspathResolver;
  /** Owns the size/mtime validation cache for converted archives. */
  private readonly convertedJarArtifactInspector: ConvertedJarArtifactInspector;
  /** 多个源共用一只 jar 时，后台预热只挂一条完成/失败日志。 */
  private warmupLocks = new Map<string, Promise<void>>();
  /** 全局 spider jar（配置顶层 spider 字段），site.jar 优先 */
  private globalJar = '';
  /** 已上屏过的原生桥消息（stderr 跨请求累积，去重防刷屏；见 noteBridgeLog） */
  private bridgeNotesSeen = new Set<string>();
  /** Owns per-source proxy identity, pool pinning identity, and shell-shim preference. */
  private readonly runtimeSession = new JarSpiderRuntimeSession();
  /** One-shot child-process I/O and shutdown cleanup live at a dedicated adapter boundary. */
  private readonly subprocessRunner: SpiderSubprocessRunner;
  /** ★ 2026-10-09：按源 key 查宿主代理端口（未调用过 → null） */
  proxyPortForTag(tag: string): number | null {
    return this.runtimeSession.proxyPortForSource(tag);
  }
  /** ★ 子进程常驻复用池（--serve/-serve；进程复用加速首页/搜索；单测与显式关闭时禁用） */
  private readonly pool: SpiderProcPool | null;
  /** Shared cold-start limiter; uses the pool's accounting when pooling is on. */
  private readonly processAdmission: Pick<SpiderProcPool, 'tryAcquireFallbackProcessSlot'>;
  private readonly poolReclaimTimer?: ReturnType<typeof setInterval>;
  /** Detached JVM conversion lifecycle is isolated behind its process port. */
  private readonly detachedDex2jar: DetachedDex2jarPort;
  /** Owns adaptive heap sizing and OOM recovery for the conversion subprocess. */
  private readonly dex2jarConversion: Dex2jarConversion;
  /** Owns HTTP disguise retries and rejects non-archive responses before conversion. */
  private readonly jarArchiveDownloader: JarArchiveDownloader;
  /**
   * ★ 2026-09-27：**转换进度表**（jar URL → 起转时间 + 是否「接管」上次会话的后台转换）。
   *   供上层在等待期显示「已等 X」——用户诉求「等待要有感知」（见 conversionProgress）。
   */

  constructor(opts: JarBridgeOptions, private host?: JarSpiderBridgeHost) {
    this.jvmDir = opts.jvmDir;
    this.cacheDir = opts.cacheDir;
    this.jarArchiveDownloader = new JarArchiveDownloader(this.host ? {
      http: this.host.http,
      logAttempt: (message) => this.host?.logger.i(message),
    } : undefined);
    this.classpathResolver = new JarClasspathResolver(this.cacheDir);
    this.convertedJarArtifactInspector = new ConvertedJarArtifactInspector({
      fingerprint: (file) => {
        const stat = statSync(file);
        return `${stat.size}:${stat.mtimeMs}`;
      },
      isUsable: isUsableConvertedJarFile,
    });
    this.callTimeoutMs = opts.callTimeoutMs ?? 20000;
    this.shellCompatibility = new SpiderShellCompatibility(
      this.jvmDir,
      opts.shellShimClasses,
      process.env['TVBOX_SHELL_SHIM_CLASSES'] ?? '',
      createSpiderShellCompatibilityPorts(
        (path) => readFileSync(path),
        existsSync,
        (message) => this.host?.logger.w(message),
      ),
    );
    const embeddedPythonRuntime = new EmbeddedPythonRuntime(
      { runtimeDir: opts.pyRuntimeDir, jvmDir: opts.jvmDir, archiveSha256: opts.pythonEmbedArchiveSha256 },
      () => this.host,
    );
    this.nativeRuntime = new NativeSpiderRuntime({
      jvmDir: opts.jvmDir,
      runtimeDir: opts.nativeRuntimeDir,
      ports: {
        downloadArtifact: async (url) => {
          if (!this.host) throw new Error('原生运行时下载需要 EngineHost');
          const response = await this.host.http.request({ url, method: 'get', timeoutMs: 180000, buffer: 2 });
          return Buffer.from(
            Array.isArray(response.content)
              ? (response.content as unknown as number[])
              : Buffer.from(String(response.content), 'base64'),
          );
        },
        logInfo: (message) => this.host?.logger.i(message),
        logWarning: (message) => this.host?.logger.w(message),
      },
    });
    this.proxyProvider = opts.proxyProvider;
    this.totalMemBytes = opts.totalMemBytes ?? totalmem();
    this.subprocessRunner = new SpiderSubprocessRunner({
      spawn,
      processEnvironment: () => process.env,
      proxyEnvironment: () => this.proxyProvider?.().env ?? {},
      logBridgeNotes: (text) => this.noteBridgeLog(text),
      logError: (message) => this.host?.logger.e(message),
      logWarning: (message) => this.host?.logger.w(message),
      logInfo: (message) => this.host?.logger.i(message),
    }, this.callTimeoutMs);
    this.detachedDex2jar = opts.detachedDex2jar ?? new DetachedDex2jarCoordinator(this.cacheDir, {
      info: (message) => this.host?.logger.i(message),
    });
    this.dex2jarConversion = new Dex2jarConversion(
      this.detachedDex2jar,
      this.totalMemBytes,
      {
        info: (message) => this.host?.logger.i(message),
        warn: (message) => this.host?.logger.w(message),
      },
      (partPath) => { try { rmSync(partPath, { force: true }); } catch { /* ignore */ } },
    );
    mkdirSync(this.cacheDir, { recursive: true });
    // ★ 老版本留下的转换产物可能缺 assets（v1 格式）→ 必须作废重转，否则本轮修复不生效
    this.ensureCacheVersion();
    // 池默认启用（生产）；禁用时走一次性路径，但仍由独立 admission budget 限制同时冷启动数。
    if (poolEnabled()) {
      this.pool = new SpiderProcPool((spec) => {
        const child = spawn(spec.exe, spec.serveArgv, {
          windowsHide: true,
          // ★ serve 进程 stdout 走行协议（池按物理行分帧），stderr 必须**消费**而不是 'ignore'：
          //   防止管道写满并记录桥接提示。没有请求身份的 stderr 不用来判定某次调用失败。
          stdio: ['pipe', 'pipe', 'pipe'],
          ...(spec.env ? { env: { ...process.env, ...spec.env } } : {}),
        });
        return child;
      }, {
        onDiagnostic: (line) => this.noteBridgeLog(line),
        onOutputLimit: (stream, maxBytes) => this.host?.logger.w(
          `jvm-bridge serve ${stream} 超过 ${maxBytes} 字节安全上限，已回收该进程`,
        ),
      });
      this.processAdmission = this.pool;
      // 空闲进程每 15s 回收一次（同 key 只保留 1 个热进程，并行期多开的进程 30s 后回收）
      this.poolReclaimTimer = this.pool.startReclaimTimer();
    } else {
      this.pool = null;
      this.processAdmission = new OneShotProcessBudget();
    }
    this.pythonRuntime = new PythonSpiderRuntimeAdapter({
      runtime: embeddedPythonRuntime,
      runtimeDir: opts.pyRuntimeDir,
      pool: this.pool,
      proxyProvider: this.proxyProvider ? () => ({ env: this.proxyProvider!().env }) : undefined,
      logInfo: (message) => this.host?.logger.i(message),
      submitToPool: (exe, key, serveArgv, className, method, args, env, timeoutMs, preferredPort, signal) =>
        this.poolSubmit(exe, key, serveArgv, className, method, args, env, timeoutMs, preferredPort, signal),
      runSubprocess: (exe, argv, className, method, timeoutMs, env, signal) =>
        this.runSubprocessWithinProcessBudget(exe, argv, className, method, timeoutMs, env, signal),
    });
  }

  /** 原生桥消息上屏（子进程 stderr 跨请求累积 → 同一行只上屏一次；失败/降级类走 warn） */
  private noteBridgeLog(text: string): void {
    for (const line of extractBridgeNotes(text)) {
      if (this.bridgeNotesSeen.has(line)) continue;
      if (this.bridgeNotesSeen.size > 200) this.bridgeNotesSeen.clear();
      this.bridgeNotesSeen.add(line);
      if (/失败|降级|不可用/.test(line)) this.host?.logger.w(`jar: ${line}`);
      else this.host?.logger.i(`jar: ${line}`);
    }
  }

  get defaultJar(): string {
    return this.globalJar;
  }

  /**
   * ★ 2026-09-26：丢弃全部常驻蜘蛛进程（下次调用按新参数重新拉起）。
   *   用于「池 key 感知不到的状态变化」——典型是**网盘凭据**：Cloud_* 系蜘蛛在 init 时读
   *   `<userData>/tvfan/Cloud-drive.txt`，文件内容变了但池 key（类名+ext）没变 →
   *   旧 cookie 会一直生效（表现为「刚绑定完还是播不了/取不到列表」）。
   *   `dispose()` 会 kill 全部子进程并清空分组，池对象本身可继续使用（下次 submit 自动重建）。
   */
  resetPool(): void {
    this.pool?.dispose();
    this.runtimeSession.resetProxyRouting();
  }

  /** 导入配置后由宿主设置全局 spider jar URL */
  setDefaultJar(url: string): void {
    this.globalJar = (url || '').trim();
  }

  /** 随包 JRE 的 java.exe 路径（**不做存在性检查**，供「是否 JVM 子进程」这类判定用；不抛异常） */
  private javaExePath(): string {
    return join(this.jvmDir, 'jre', 'bin', 'java.exe');
  }

  private javaExe(): string {
    const p = this.javaExePath();
    if (!existsSync(p)) {
      // 附带 jvmDir 实况，便于区分「资源目录定位错」与「资源真的没打进去」
      let probe = '';
      try {
        const fs = require('node:fs') as typeof import('node:fs');
        const parent = join(this.jvmDir, '..');
        const siblings = fs.existsSync(parent) ? fs.readdirSync(parent).slice(0, 20).join(', ') : '(不存在)';
        const jvmEntries = fs.existsSync(this.jvmDir) ? fs.readdirSync(this.jvmDir).join(', ') : '(目录不存在)';
        probe = `\n  资源目录: ${this.jvmDir}\n  同级条目: ${siblings}\n  jvm 内: ${jvmEntries}`;
      } catch { /* ignore */ }
      throw new Error(`JRE 缺失: ${p}${probe}`);
    }
    return p;
  }

  /**
   * 父加载器 classpath 组成：**prefs 影子 jar → stubs.jar → okhttp4 兼容 jar → libs/*.jar**（顺序即优先级）。
   *
   * ★ 2026-10-14：prefs 影子 jar **必须排在最前（先于 stubs.jar）** —— 它只影子一个类
   *   `android/content/SharedPreferences$Mem`（见 prefsShim.ts）。stubs.jar 里那个是**纯内存**
   *   实现（`static Map INST` + 每实例 `Map data`，从不落盘），于是 wex 族（玩偶/虎斑/爱看…）的
   *   `Wex_ucpan_cookie / Wex_baidu_cookie / Wex_quark_cookie`（存于 SharedPreferences
   *   `NewWexFnw_preferences`）永远是空的 ⇒ 已绑定仍报「还没有配置 UC/百度 Cookie」。
   *   父 cp 先命中者生效 ⇒ 排最前才能盖住 stubs.jar 里的原类。
   *   影子 jar 由 `scripts/gen-prefs-shim.mjs` 生成并入库；缺失时静默退回原桩行为（仅少这个修复）。
   *
   * ★ 2026-10-14：okhttp4 兼容 jar **必须排在 libs 之前** —— 它只影子 `okhttp3/RequestBody`
   *   （= 3.14.9 原类 + 追加的 okhttp 4.x 参数序 `create` 重载，见 okhttp4Compat.ts）。
   *   问题调用发生在 **Java 侧 runtime-dex 产物**里（Node 端改写 jar 够不到），
   *   只有「给宿主类补方法」这一条路能全覆盖。
   */
  private classpathJars(): string {
    const fs = require('node:fs') as typeof import('node:fs');
    const parts: string[] = [];
    const prefsShim = join(this.jvmDir, 'prefs-shim', PREFS_SHIM_JAR);
    if (fs.existsSync(prefsShim)) parts.push(prefsShim);
    parts.push(join(this.jvmDir, 'stubs', 'stubs.jar'));
    const compat = join(this.jvmDir, 'okhttp4-compat', OKHTTP4_COMPAT_JAR);
    if (fs.existsSync(compat)) parts.push(compat);
    parts.push(...this.libJars());
    return parts.join(';');
  }

  private libJars(): string[] {
    const libDir = join(this.jvmDir, 'libs');
    const out: string[] = [];
    try {
      const fs = require('node:fs') as typeof import('node:fs');
      for (const f of fs.readdirSync(libDir)) if (f.endsWith('.jar')) out.push(join(libDir, f));
    } catch { /* ignore */ }
    return out;
  }

  /**
   * 下载 + 转换 jar（去重并发），返回转换后 jar 的本地路径。
   *
   * ★ 入口统一规范化 URL：配置里 jar 常写成 `URL;md5;xxxx` 形态。
   *   上游 TVBox 的 `jar` 字段以分号分隔，只有第一段是真正 URL，`;md5;` 是校验后缀。
   *   历史 bug：`SpiderHost.setSpiderJar()` 把**带后缀的完整串**传进 warmup，
   *   而 `JarSpider.jarUrls()` 在调用时已 `.split(';')[0]` 剥掉后缀 ——
   *   两条路径得到不同的 URL，于是预热下载到的是 404 页面（9KB），
   *   转换产物为空 → `dex2jar 转换产物为空` → 源"无法加载"。
   *   在此处集中剥离，保证所有调用方（warmup / JarSpider / 未来新增）行为一致。
   */
  async ensureConverted(jarUrl: string): Promise<string> {
    const url = normalizeJarUrl(jarUrl);
    if (!url) throw new Error(`jar URL 为空: ${jarUrl}`);
    return this.conversionRegistry.ensure(url, (path) => this.convertedJarArtifactInspector.isUsable(path), () => this.doConvert(url));
  }

  /**
   * 确保转换缓存目录存在。
   *
   * 构造函数已 mkdirSync 一次，但缓存目录可能在此后被外部因素删除
   * （用户清理、杀软、崩溃残留、旧版本升级等），届时 writeFileSync 会抛
   * `ENOENT: no such file or directory, open '...raw.jar'` —— 这个错误信息
   * 有极强的误导性（看起来像 jar 下载失败，实际是目录缺失）。
   * 上游 ApiConfig.downloadJarAsync 同样在写入前 `cacheDir.mkdirs()`（ApiConfig.java:450）。
   * 因此每次写入前兜底重建，把「目录消失」这类环境问题自动抹平。
   */
  private ensureCacheDir(): void {
    if (existsSync(this.cacheDir)) return;
    mkdirSync(this.cacheDir, { recursive: true });
    this.host?.logger.w(`jvm-bridge 缓存目录缺失，已重建: ${this.cacheDir}`);
  }

  /**
   * 转换产物格式版本 —— 改变了「产物内容」就必须 +1（历史见 CONVERTED_CACHE_VERSION）。
   *
   * 为什么必须有版本号：老用户机器上 `<cache>/spider/converted/<md5>.jar` 是旧版产物，
   * 命中缓存就直接用了 —— 新代码的修补逻辑**永远不会执行**，修复形同虚设。
   * 这里在缓存目录里放一个版本戳，版本不符就把转换产物整体作废重转
   * （只删 `.jar`，不动别的；raw jar 一并删掉以保证重新下载最新内容）。
   */
  /** 版本不符时清空转换产物，强制重转。失败只警告，不影响主流程。 */
  private ensureCacheVersion(): void {
    // ★ 2026-09-23 / 2026-09-24 修复「每次清缓存后首次进源要等 30s+」：
    //   ① 首装/清缓存后 cacheDir 不存在 → 先建目录并写戳（老实现直接 return，导致戳从未写入）；
    //   ② ★ **戳缺失不再当作「旧版本产物」**：缺失只可能是「清理缓存按钮/外部清理」而不是真升级，
    //      此时保留磁盘上已有的转换产物（它们本来就是当前版本的产物），只补写戳。
    //      真升级（戳存在且值不同）才作废重转 —— 用户实测：清缓存后第一次进源要 37s
    //      （下载 + dex2jar + JVM 冷启动全在这一条请求里），进而被源超时打断成「加载失败」。
    const stamp = join(this.cacheDir, '.converted-version');
    ensureConvertedJarCacheVersion(this.cacheDir, stamp, CONVERTED_CACHE_VERSION, {
      exists: existsSync,
      createDirectory: (directory) => mkdirSync(directory, { recursive: true }),
      readText: (path) => readFileSync(path, 'utf8'),
      writeText: (path, contents) => writeFileSync(path, contents),
      listEntries: (directory) => {
        const fs = require('node:fs') as typeof import('node:fs');
        return fs.readdirSync(directory);
      },
      removeFile: (directory, name) => {
        const fs = require('node:fs') as typeof import('node:fs');
        fs.rmSync(join(directory, name), { force: true });
      },
      info: (message) => this.host?.logger.i(message),
      warn: (message) => this.host?.logger.w(message),
    });
  }

  private async doConvert(jarUrl: string): Promise<string> {
    const key = md5Hex(jarUrl);
    const target = join(this.cacheDir, `${key}.jar`);
    // ★ 有效性判定（不是「文件存在且 size>0」）：见 isUsableConvertedJar —— 空 zip 残骸必须重转
    if (this.convertedJarArtifactInspector.isUsable(target)) return target;
    try {
      return await this.doConvertUncached(jarUrl, key, target);
    } catch (e) {
      // ★ 残骸清理：target 只会由「校验过的 part 原子改名」产生，正常路径不存在残骸；
      //   这里保留兜底（旧版本留下的 / 改名竞态），因为「文件存在就当缓存」的代价是整份配置的源全废。
      try {
        rmSync(target, { force: true });
      } catch { /* ignore */ }
      throw e;
    }
  }

  private async doConvertUncached(jarUrl: string, key: string, target: string): Promise<string> {
    if (!this.host) throw new Error('JarSpiderBridge 需要 EngineHost 才能下载 jar');
    // ★ 写盘前确保目录存在（对齐上游 downloadJarAsync 的 cacheDir.mkdirs()）
    this.ensureCacheDir();
    // 下载也算在「用户等待」里：进度计时从这里开始（下载 + 转换是一条链）
    const startedAt = Date.now();
    this.conversionRegistry.startProgressIfAbsent(jarUrl, { startedAt, attached: false, stage: 'download' });
    this.host?.logger.i(`jvm-bridge jar 准备开始（key=${key.slice(0, 8)}，下载阶段）`);
    try {
      const output = await this.doConvertStage(jarUrl, key, target);
      this.host?.logger.i(`jvm-bridge jar 准备完成（key=${key.slice(0, 8)}，总耗时 ${Date.now() - startedAt}ms）`);
      return output;
    } finally {
      this.conversionRegistry.clearProgress(jarUrl);
    }
  }

  private async doConvertStage(jarUrl: string, key: string, target: string): Promise<string> {
    const { bytes: jarBytes, usedLabel } = await this.jarArchiveDownloader.download(jarUrl, isJarOrDex);
    return runJarConversionWorkflow({ jarUrl, key, target, jarBytes, usedLabel }, {
      now: () => Date.now(),
      onEvent: (event: JarConversionWorkflowEvent) => {
        switch (event.type) {
          case 'download-completed':
            this.host?.logger.i(
              `jvm-bridge jar 下载完成（key=${event.key.slice(0, 8)}，${event.byteLength}B，耗时 ${event.elapsedMs}ms）`,
            );
            break;
          case 'download-retry-succeeded':
            this.host?.logger.i(`jvm-bridge jar 按「${event.usedLabel}」重试成功（首次响应未通过 jar 校验）：${event.jarUrl}`);
            break;
          case 'content-reused':
            this.host?.logger.i(
              `jvm-bridge 内容哈希复用：jar 内容未变（${(event.byteLength / 1048576).toFixed(2)}MB），` +
                `直接复用已有产物、跳过 dex2jar（${basename(event.from || '')} → ${basename(event.target)}）：${event.jarUrl}`,
            );
            break;
          case 'detached-part-adopted':
            this.host?.logger.i(`jvm-bridge 已收编后台完成的转换产物（上次会话遗留，无需重转）：${basename(event.target)}`);
            break;
          case 'attached-to-detached-conversion':
            this.host?.logger.i(
              `jvm-bridge 检测到 jar 的后台转换仍在进行（pid=${event.pid}，已 ${formatDuration(event.elapsedMs)}）→ 接管等待`,
            );
            break;
        }
      },
      progress: {
        startedAt: (url) => this.conversionRegistry.progressView(url)?.startedAt ?? null,
        setConvertStage: (url) => this.conversionRegistry.setStage(url, 'convert'),
        attachTo: (url, startedAt) => this.conversionRegistry.attachToProgress(url, startedAt),
      },
      cache: {
        ensureDirectory: () => this.ensureCacheDir(),
        rawJarPath: (cacheKey) => join(this.cacheDir, `${cacheKey}.raw.jar`),
        writeRawJar: (path, bytes) => writeFileSync(path, bytes),
        contentKey: contentHashOf,
        reuseByContent: (contentKey, cacheKey) => tryCloneByContent(
          this.cacheDir,
          contentKey,
          cacheKey,
          (path) => this.convertedJarArtifactInspector.isUsable(path),
        ),
        complete: (url, output, contentKey) => this.finishConvert(url, output, contentKey),
      },
      artifacts: {
        adoptPart: (cacheKey, rawPath, output, strict) => this.adoptFinishedPart(cacheKey, rawPath, output, strict),
      },
      detached: {
        readLock: (cacheKey) => this.detachedDex2jar.readLock(cacheKey),
        isAlive: (lock) => this.detachedDex2jar.isAlive(lock),
        clearLock: (cacheKey) => this.detachedDex2jar.clearLock(cacheKey),
        waitForAttached: (cacheKey, lock, adoptPart) =>
          this.detachedDex2jar.waitForAttached(cacheKey, lock, adoptPart),
      },
      converter: {
        convert: ({ rawJar, key: cacheKey, jarBytes: bytes }) => {
          const rawBytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
          return this.dex2jarConversion.convert({
            executable: this.javaExe(),
            classpath: this.dirJars(join(this.jvmDir, 'd2j')).join(';'),
            rawJar,
            key: cacheKey,
            dexBytes: totalDexBytes(rawBytes),
            rawJarBytes: rawBytes.length,
          });
        },
      },
    });
  }

  /**
   * ★ 2026-09-27：某 jar 的转换进度（上层在「等待期」显示「已等 X」）。
   * @returns null = 当前没有转换在跑；attached = 正在接管上次会话遗留的后台转换
   */
  conversionProgress(jarUrl: string): { elapsedMs: number; attached: boolean; stage: 'download' | 'convert' } | null {
    const url = normalizeJarUrl(jarUrl);
    if (!url) return null;
    const { elapsedMs, attached, stage } = this.conversionRegistry.progressView(url) ?? {};
    if (elapsedMs === undefined || attached === undefined || stage === undefined) return null;
    return { elapsedMs, attached, stage };
  }

  /** Publish the conversion cache entry only after a validated artifact is ready. */
  private finishConvert(jarUrl: string, target: string, contentKey?: string): void {
    if (this.jarNeedsNative(target)) this.prewarmNativeRuntime();
    if (contentKey) recordContentKey(this.cacheDir, contentKey, md5Hex(jarUrl));
  }

  private async adoptFinishedPart(key: string, rawJar: string, target: string, strict: boolean): Promise<boolean> {
    return prepareConvertedJarArtifact({ key, rawJar, target, strict }, {
      partPath: (partKey) => this.detachedDex2jar.partPath(partKey),
      sizeOf: (partPath) => {
        try { return existsSync(partPath) ? statSync(partPath).size : 0; } catch { return 0; }
      },
      isUsable: (partPath) => isUsableConvertedJar(partPath),
      mergeRawResources: (source, partPath) => copyJarResources(source, partPath, this.host?.logger),
      repairDexConstructors: (source, partPath) => this.repairDexConstructors(source, partPath),
      repairSelfSuperCalls: (partPath) => fixSelfSuperCallsInJarFile(
        partPath,
        [join(this.jvmDir, 'stubs', 'stubs.jar'), ...this.libJars()],
        { i: (message) => this.host?.logger.i(message), w: (message) => this.host?.logger.w(message) },
      ),
      patchSpiderProxy: (partPath) => patchSpiderProxyInJarFile(partPath, {
        i: (message) => this.host?.logger.i(message),
        w: (message) => this.host?.logger.w(message),
      }),
      promote: (partPath, destination) => {
        try { rmSync(destination, { force: true }); } catch { /* best effort */ }
        try { renameSync(partPath, destination); } catch { /* best effort */ }
        return this.convertedJarArtifactInspector.isUsable(destination);
      },
    });
  }

  private dirJars(dir: string): string[] {
    const out: string[] = [];
    try {
      const fs = require('node:fs') as typeof import('node:fs');
      for (const f of fs.readdirSync(dir)) if (f.endsWith('.jar')) out.push(join(dir, f));
    } catch { /* ignore */ }
    return out;
  }

  /** 修复在副本上异步执行；退出/失败后仍可收编原始 part，不必重跑 dex2jar。 */
  private async repairDexConstructors(rawJar: string, part: string): Promise<void> {
    const bridgeJar = join(this.jvmDir, 'native-bridge', 'native-bridge.jar');
    const result = await repairDexConstructorArtifact({
      rawJar: resolve(rawJar),
      partialJar: resolve(part),
      bridgeJar,
      timeoutMs: DEX2JAR_TIMEOUT_MS,
    }, {
      shouldRepair: (path) => {
        const raw = readFileSync(path);
        return !looksLikeZip(raw) || listZipEntries(raw).some(name => /^classes\d*\.dex$/i.test(name));
      },
      repairToolExists: existsSync,
      runtime: () => ({
        javaExecutable: resolve(this.javaExe()),
        bridgeJar: resolve(bridgeJar),
        dex2jarClasspath: this.dirJars(join(this.jvmDir, 'd2j')).map(path => resolve(path)).join(';'),
      }),
      workspacePath: (partialPath) => `${partialPath}.constructors.jar`,
      copy: copyFileSync,
      run: (command) => runDexConstructorRepairProcess(command, {
        spawn: (executable, args, options) => spawn(executable, args, options),
        track: (child) => this.subprocessRunner.track(child),
        release: (child) => this.subprocessRunner.release(child),
      }),
      isUsable: (path) => isUsableConvertedJar(path),
      promote: (workspaceJar, partialJar) => renameSync(workspaceJar, partialJar),
      remove: (path) => { try { rmSync(path, { force: true }); } catch { /* next repair overwrites a stale copy */ } },
    });
    if (result.status === 'skipped' && result.reason === 'repair-tool-missing') {
      this.host?.logger.w('jvm-bridge DEX 构造器修复工具缺失，跳过修复');
    }
    if (result.status === 'repaired') {
      this.host?.logger.i(`jvm-bridge DEX 构造器修复完成 ${result.fixedSites} 处（${basename(part)}）`);
    }
  }

  /**
   * URL → 已转换的本地 jar 路径（须先 ensureConverted）。传入值同样规范化，避免键不匹配。
   *
   * ★ 只返回**磁盘上真实存在**的路径。
   *   原因：缓存目录可能被外部清理（杀软/磁盘清理/用户手动），此时内存里的
   *   converted 映射就变成了**失效条目**。若原样交给 SpiderRunner，它会拿到一个
   *   指向不存在文件的 jar 参数 → 所有蜘蛛类都报
   *   `ClassNotFoundException: com.github.catvod.spider.Xxx`，
   *   而这类报错极易被误读成"桌面版缺接口"（实测整套配置 95 个源集体报这句）。
   *   这里顺手把失效条目清掉，下次调用会重新下载转换，即自动恢复。
   * ★ 2026-09-26：另外要求产物**有效**（见 artifactOk）—— 存在但只是个空 jar 的残骸同样清掉。
   */
  resolvePaths(urls: string[]): string[] {
    const out: string[] = [];
    for (const u of urls) {
      const key = normalizeJarUrl(u);
      const p = this.conversionRegistry.convertedPath(key);
      if (!p) continue;
      if (existsSync(p) && this.convertedJarArtifactInspector.isUsable(p)) {
        out.push(p);
      } else {
        this.conversionRegistry.forgetConvertedPath(key);
        this.host?.logger.w(`jvm-bridge 转换产物已失效，已清除缓存条目: ${p}`);
      }
    }
    return out;
  }

  /**
   * ★ 预热候选解析：jar URL → **磁盘上已存在的**转换产物路径（空串 = 还没转换过）。
   * 与 resolvePaths 的区别：不下载、不转换 —— 预热是启动路径上的"锦上添花"，
   * 绝不能把 jar 下载 + dex2jar 的重活压到启动阶段（真机启动体验优先）。
   */
  peekConverted(jarUrl: string): string {
    const url = normalizeJarUrl(jarUrl);
    if (!url) return '';
    const cached = this.conversionRegistry.convertedPath(url);
    if (cached && existsSync(cached) && this.convertedJarArtifactInspector.isUsable(cached)) return cached;
    if (cached) this.conversionRegistry.forgetConvertedPath(url);
    const p = join(this.cacheDir, `${md5Hex(url)}.jar`);
    // ★ 残骸（空 zip）不算「已转换」：否则闸门会把该源标成 ready，实际一调就类找不到
    return this.convertedJarArtifactInspector.isUsable(p) ? p : '';
  }

  /**
   * ★ 预热：提前 spawn `count` 个常驻 SpiderRunner --serve，并发 `__warm__` 探针
   * （把「加载蜘蛛类 + 预建实例（含 init(ext)）」也提前做掉，见 SpiderRunner.serve）。
   *
   * @param ext 该源的 init ext（预热实例与真实调用同键 —— 同 ext 才会被复用）
   * @returns 实际新起的进程数（0 = 未预热：池禁用/路径缺失/已热/额度不足）
   */
  prewarmJar(jarPaths: string[], className: string, count = 1, ext = ''): number {
    if (!this.pool || jarPaths.length === 0 || !jarPaths.every((p) => existsSync(p))) return 0;
    // ★★ 2026-09-27（实测「订阅里每个源都空」的 App 侧根因，勿回退）★★
    //   此前预热 argv 用 `classpathJars()`（**不含原生桥/ undibg**）且不带 `-Dtvbox.native.*`，
    //   于是预热出来的常驻 JVM 里壳的 DexNative 是**未改写**的：`Init.init` 走原始
    //   `System.load(ARM .so)` → UnsatisfiedLinkError → Init 崩 → **该进程上所有请求恒空**，
    //   而池按 key 长期复用它（用户侧就是「装完第一次进源，每个源都提示蜘蛛返回空结果」）。
    //   现在：与 callJar **同口径**拼 argv（原生 jar + native props），且**运行时未就绪就不预热**
    //   —— 预热绝不生产「没有桥」的僵尸进程。
    const shimClasses = this.shellCompatibility.includeFoniImplementation(
      className,
      this.shellCompatibility.classesPath() || this.shellCompatibility.resolveForJars(jarPaths),
    );
    const shimJar = this.shellCompatibility.shimJarPath();
    // ★ 2026-09-29（守卫空 NPE 兜底）：已切 shell-shim 路线的 jar 预热同样不启用原生桥（见 callImpl 注释）
    const preferShim = shimClasses !== '' && this.runtimeSession.prefersShellShim(jarPaths.join(';'));
    const needsNative = !preferShim && this.nativeNeeded(jarPaths);
    const nativeJars = needsNative ? (this.nativeRuntime.readyJars ?? []) : [];
    if (needsNative && nativeJars.length === 0) return 0;
    // ★ 与 callJar 同口径：-cp 只放运行时（stubs/libs/桥/unidbg），蜘蛛 jar/shim jar 只走加载器参数 ——
    //   否则父加载器抢占原始类，native 改写产物（子加载器最前）不生效。
    const shimJarAvailable = Boolean(shimClasses && existsSync(shimJar));
    const launchPlan = createJarExecutionLaunchPlan({
      classpaths: {
        runtimeJars: [this.classpathJars()],
        nativeJars,
        spiderJars: jarPaths,
        shimClasses,
        shimJar: { path: shimJar, available: shimJarAvailable },
      },
      nativeArguments: this.nativeProps(nativeJars),
    });
    const serveArgv = launchPlan.serveArgv(
      this.jvmPrefix(launchPlan.runtimeClasspath, true, launchPlan.loaderClasspath),
    );
    const key = servePoolKey(this.javaExe(), serveArgv);
    return this.pool.warm(key, { exe: this.javaExe(), serveArgv, key }, count, { className, method: WARM_METHOD, args: [ext] });
  }

  /**
   * ★ 预热：提前 spawn 常驻 Python runner（-serve）并发 `__warm__` 探针（预建实例进缓存）。
   * 运行时/脚本任一未落盘 → 直接 0：预热**绝不触发**嵌入式 Python 下载（那是 11MB 级重活）。
   */
  prewarmPython(pyPath: string, clsName: string, count = 1, ext = '', siteKey = ''): number {
    return this.pythonRuntime.prewarmPython(pyPath, clsName, count, ext, siteKey);
  }

  /**
   * 某 key 已热进程数（诊断/预热去重用）。池禁用时返回 0。
   */
  warmCount(poolKey: string): number {
    return this.pool?.aliveForKey(poolKey) ?? 0;
  }

  /** 池内常驻进程总数（诊断/日志/基准脚本用） */
  alivePoolCount(): number {
    return this.pool?.aliveCount ?? 0;
  }

  /** ★ 2026-10-17（B1）：播放期收缩 —— 布防常驻池在「整体空闲 30s」后收敛到 1 个热进程 */
  armPoolShrink(): void {
    this.pool?.armPlaybackShrink();
  }

  /** ★ 嵌入式 Python 运行时是否已落盘（同步判定，全源搜索就绪闸门用；**绝不触发下载**） */
  pyRuntimeReady(): boolean { return this.pythonRuntime.pyRuntimeReady(); }

  /**
   * ★ 正在进行的转换/下载（未完成时返回 promise；已就绪或从未启动返回 null）。
   * 全源搜索的「预备等待」用它：等一等正在转换的 jar（而不是直接跳过 → 空结果）。
   */
  pendingConvert(jarUrl: string): Promise<string> | null {
    const url = normalizeJarUrl(jarUrl);
    if (!url || this.conversionRegistry.hasConvertedPath(url)) return null;
    return this.conversionRegistry.pending(url);
  }

  /** 同步读取仍在抑制窗口内的失败；失败不等于「正在准备」，过期后允许重新尝试。 */
  conversionFailure(jarUrl: string): string {
    const url = normalizeJarUrl(jarUrl);
    return this.conversionRegistry.failure(url);
  }

  /**
   * 调用蜘蛛方法（jarPaths 为转换后的本地 jar 路径；className 形如 com.github.catvod.spider.Doll）。
   *
   * 入口类缺失时只使用唯一包含该类的缓存构建；不能混载所有订阅 jar。
   * 不同构建的同名混淆依赖不兼容，多个不同候选时诚实报配置不匹配。
   */
  async call(
    jarPaths: string[],
    className: string,
    method: string,
    args: string[],
    timeoutMs?: number,
    tag?: string,
    signal?: AbortSignal,
  ): Promise<SpiderCallResult> {
    throwIfAborted(signal);
    const fallbackKey = jarPaths.join(';') + '\n' + className;
    const entry = className.replace(/\./g, '/') + '.class';
    const rememberedCandidate = this.classpathResolver.rememberedCandidate(fallbackKey, jarPaths, entry);
    if (rememberedCandidate) {
      return this.callImpl([rememberedCandidate], className, method, args, timeoutMs, tag, signal);
    }
    const firstAttempt = await this.callImpl(jarPaths, className, method, args, timeoutMs, tag, signal);
    throwIfAborted(signal);
    // ★★ 2026-09-29（设备实证「切换部分源 NPE」的兜底，勿删）★★
    //   现象：加固壳的守卫类（csp_DouDouGuard / csp_T4Guard …）报
    //   `NullPointerException: Cannot invoke "com.github.catvod.crawler.Spider.init(android.content.Context, String)"`
    //   —— 根因是 `BaseSpiderGuard.<init>` 里 `Init.getSpider(类名)` 没拿到真实蜘蛛（原生解密这一环
    //   没产出加载器 / 运行时 dex 产物异常），字段留 null，随后首个 init() 必崩。
    //   兜底：只要这只壳 jar 有内置真实实现（`shell-shim/real/<guard>.jar`），改用 **shell-shim 路线**
    //   重试一次，并记住该 jar（后续 home/detail/play 与预热都走同一条路线，见 callImpl/prewarmJar 的 preferShim）。
    //   为什么可行：shell-shim 影子 DexNative 用真实实现 jar 直接回答 getLoader/getSpider，完全不依赖
    //   ARM 模拟/运行时 dex 转换（探针实测：DouDouGuard home 1.9s 拿到 10658B 数据）。
    const jarKey = jarPaths.join(';');
    let shim = '';
    let shellShimRetryAvailable = false;
    if (firstAttempt.failureKind === 'guard-inner-spider-null' && !this.runtimeSession.prefersShellShim(jarKey)) {
      shim = this.shellCompatibility.classesPath() || this.shellCompatibility.resolveForJars(jarPaths);
      shellShimRetryAvailable = Boolean(shim && existsSync(this.shellCompatibility.shimJarPath()));
    }

    let declaredEntryPresent = false;
    let candidates: string[] = [];
    if (firstAttempt.failureKind === 'spider-class-missing') {
      // 入口类本来存在：缺失的是内部依赖，混进其它版本并不能修复它。
      declaredEntryPresent = this.classpathResolver.containsClass(jarPaths, entry);
      if (!declaredEntryPresent) candidates = this.classpathResolver.uniqueCandidates(jarPaths, entry);
    }

    const decision = decideJarCallFallback({
      firstAttempt,
      className,
      shellShimRetryAvailable,
      declaredEntryPresent,
      uniqueCandidates: candidates,
    });
    if (decision.type === 'return') return decision.result;
    if (decision.type === 'retry-shell-shim') {
      // Store the preference for later home/detail/play calls and prewarm so all paths use one implementation.
      this.runtimeSession.rememberShellShimPreference(jarKey);
      this.host?.logger.w(
        `jvm-bridge ${className}: 守卫内层蜘蛛为空（原生解密未产出加载器）→ 改用 shell-shim 真实实现重试：${shim}`,
      );
      return this.callImpl(jarPaths, className, method, args, timeoutMs, tag, signal);
    }

    this.host?.logger.i(`jvm-bridge ${className}: 入口类只在一个缓存构建中存在 → 独立加载 ${basename(decision.candidate)}（不混载其它订阅）`);
    const result = await this.callImpl([decision.candidate], className, method, args, timeoutMs, tag, signal);
    throwIfAborted(signal);
    if (result.output.trim() && !result.reason) this.classpathResolver.remember(fallbackKey, decision.candidate);
    return result;
  }

  private async callImpl(
    jarPaths: string[],
    className: string,
    method: string,
    args: string[],
    timeoutMs?: number,
    tag?: string,
    signal?: AbortSignal,
  ): Promise<SpiderCallResult> {
    throwIfAborted(signal);
    // ★ shell-shim（方案 A 影子类，见 stubs-src/shell-shim/DexNative.java）——
    //   遇到加固/壳 jar（内含 native 版 DexNative）时，把 shell-shim.jar 排在
    //   classpath **最前**，靠类加载顺序覆盖壳里那个 native 版本，从而绕过
    //   ARM .so 加载（第十八轮结论 §六的应用侧接入）。
    //   默认关闭：只有拿到"真实实现 jar"路径（shellShimClasses 参数或
    //   TVBOX_SHELL_SHIM_CLASSES 环境变量）时才启用，普通源行为完全不变。
    const shimClasses0 = this.shellCompatibility.classesPath() || this.shellCompatibility.resolveForJars(jarPaths);
    // ★ AppSx/AppTT/AppSK 系追加完整构建 foni-spider.jar（优先加载，见 shimWithFoni 注释）
    const shimClasses = this.shellCompatibility.includeFoniImplementation(className, shimClasses0);
    const shimJar = this.shellCompatibility.shimJarPath();
    // ★★ 2026-09-29（守卫空 NPE 兜底，见 call()）：本 jar 已切到 shell-shim 路线后**不再启用原生桥** ——
    //   只要原生桥被启用，SpiderRunner 会把「改写产物目录」排在子加载器**最前**（实测 -verbose:class：
    //   DexNative 来自 *.jar.patched/），shell-shim.jar 里的影子 DexNative 永远抢不到 → 「有真实实现
    //   却仍走原生解密」。跳过原生桥（不传 -Dtvbox.native.*）后加载顺序回到 [shell-shim.jar, 蜘蛛 jar]，
    //   影子生效、无需 ARM 模拟，启动更快也更稳。
    const preferShim = shimClasses !== '' && this.runtimeSession.prefersShellShim(jarPaths.join(';'));
    // ★ 2026-09-26 原生桥（ARM .so）：jar 内含 .so 时按需准备 unidbg 运行时，
    //   并把桥 jar + 运行时 jar 拼进 classpath；工作/改写目录经 -Dtvbox.native.* 透传给运行器。
    //   普通源 nativeJars 为空 → classpath/argv 与历史完全一致。
    const nativeJars = !preferShim && this.nativeNeeded(jarPaths) ? await this.ensureNativeRuntime() : [];
    throwIfAborted(signal);
    // ★★ 2026-09-26 修复（壳「守卫握手 / 加密路径」总闸，勿回退）★★
    //   此前 `cpParts = [stubs+libs, ...jarPaths, …]` 被**同时**喂给 `-cp`（父加载器 = 应用加载器）
    //   和 SpiderRunner 的加载器参数。父加载器先于子加载器解析 → jar 里的**原始类**永远赢，
    //   SpiderRunner 子加载器 URL 里排最前的「native 改写产物目录」形同虚设 →
    //   壳的 `FishNative.load()→System.load(ARM .so)` 照旧抛 UnsatisfiedLinkError →
    //   `merge.u.j.a`（SO 就绪标记）恒 false → 守卫/加密全线降级（App88「bridge request encryption failed」、
    //   壳源详情有剧集空）。桥的静态状态与改写类也因此分属两个加载器，桥只「复用产物」却不生效。
    //   正确分工：**-cp 只放运行时**（stubs/libs/桥/unidbg）；**蜘蛛 jar 只走加载器参数**（子加载器，
    //   顺序 = 改写产物目录 → shell-shim jar → 蜘蛛 jar）。
    const shimJarAvailable = Boolean(shimClasses && existsSync(shimJar));
    const launchPlan = createJarExecutionLaunchPlan({
      classpaths: {
        runtimeJars: [this.classpathJars()],
        nativeJars,
        spiderJars: jarPaths,
        shimClasses,
        shimJar: { path: shimJar, available: shimJarAvailable },
      },
      nativeArguments: this.nativeProps(nativeJars),
    });
    if (shimClasses && !shimJarAvailable) {
      this.host?.logger.w(`jvm-bridge 已启用 shell-shim（${shimClasses}），但未找到 shell-shim.jar: ${shimJar}，影子类不会生效`);
    }
    // ★★ 2026-10-09（孤儿端口场景修复，勿回退）★★：tag → 端口映射**只信 serve 信封自报的 `pp`**
    //   （见下方 r.proxyPort），不再在调用前预登记确定性散列端口 —— 确定性端口（19970~19999）
    //   只是「期望值」：被上一会话残留 JVM（孤儿）或同 key 并存 JVM 占用时，本 JVM 会退化临时
    //   端口，预登记的猜测值会把播放地址改写到**别的 JVM**（旧 stubs / 无状态），白等预检超时
    //   （最长 20s）才落原生通道。一次性回退路径无信封 → 拿不到端口 → playInner 诚实落原生兜底。
    const argv = launchPlan.oneShotArgv(
      this.jvmPrefix(launchPlan.runtimeClasspath, false, launchPlan.loaderClasspath),
      { className, method, args },
    );
    // Keep the native-runtime budget consistent across pooled execution and cold recovery.
    // A transport failure in --serve must not shorten the retry for the same .so-backed call.
    const executionTimeoutMs = nativeJars.length
      ? Math.max(timeoutMs ?? this.callTimeoutMs, NATIVE_CALL_MIN_TIMEOUT_MS)
      : timeoutMs ?? this.callTimeoutMs;
    // ★ 进程池：常驻 JVM（--serve）跨请求复用 → 二次调用跳过冷启动。
    //   serve argv = javaPrefix + [SpiderRunner, --serve, loadCp]（loadCp 已含 shim jar + 蜘蛛 jar）。
    //   ★ 仅**传输层失败**（进程崩溃/超时/写入失败）才回退一次性保底；
    //     蜘蛛合法返回空串（空搜索）不再误判失败去多打一次冷启动。
    if (this.pool) {
      const serveArgv = launchPlan.serveArgv(
        this.jvmPrefix(launchPlan.runtimeClasspath, true, launchPlan.loaderClasspath),
      );
      const key = servePoolKey(this.javaExe(), serveArgv);
      // 本地代理端口 → 池 key：/proxy/<port> 被访问时据此把该 JVM 钉住（播放期间不回收）
      this.runtimeSession.rememberExpectedProxyPort(spiderProxyPort(launchPlan.loaderClasspath), key);
      // ★ 2026-09-26：**含 .so 的加固壳源要更长的预算** —— 守卫/加密走 unidbg 模拟（全局串行），
      //   实测 App88：home ~54s、detail ~295s（首调还要付 ~10s 模拟器启动）；20s 默认预算下
      //   「守卫已通」也会被超时判死。只对这类 jar 抬底，普通源行为不变。
      const tmo = executionTimeoutMs;
      let cancellationError: Error | undefined;
      try {
        const preferredPort = this.runtimeSession.preferredPlaybackPort(tag, method);
        const r = await this.poolSubmit(this.javaExe(), key, serveArgv, className, method, args, this.proxyProvider?.().env ?? {}, tmo, preferredPort, signal);
        throwIfAborted(signal);
        // ★ 2026-09-28：信封 ok=false（蜘蛛自己抛）→ 传输层成功、不回退一次性，但必须
        //   ①把翻译后的错误保留在本次返回值中
        //   ②让 call() 的「类缺失 → 缓存 jar 并集兜底重试」重新生效
        //   （旧行为把错误串当正常 data 直接返回，两条路都断了；见 PoolResult.error）。
        if (r.ok) {
          // ★ 2026-10-09：以**该 serve 进程自报**的宿主代理端口为准（多 JVM 时 -Dtvbox.proxy.port
          //   只有第一只能绑到）—— 改写必须打到「真正服务过调用的这一只」，Pan.proxy 状态在它内存。
          //   ★ 孤儿端口场景补：实际端口（含退化临时端口）也登记进 port→key 表 ——
          //     /proxy/<临时端口> 被访问时的「钉住防回收」此前查不到 key 而失效（播放中
          //     可能被池额度压力 LRU 回收 → 断流）。
          const proxyIdentity = this.runtimeSession.rememberProxyResult({
            tag,
            method,
            proxyPort: r.proxyPort,
            poolKey: key,
            error: r.error,
          });
          if (proxyIdentity.pinForDetailSelection) {
            this.pool?.pin(key, 2 * 60_000); // 给用户选集留出时间，避免详情会话被 LRU 回收。
          }
        }
        const decision = decideJarPoolCallResult({
          ok: r.ok,
          data: r.data,
          reason: r.reason,
          error: r.error,
          timeoutMs: tmo,
        });
        if (decision.type === 'completed') {
          if (decision.runtimeError) {
            // Keep the raw exception beside the translated message for runtime diagnostics.
            this.host?.logger.i(
              `jvm-bridge ${className}.${method} 失败原因: ${decision.runtimeError.reason}｜原始: ${decision.runtimeError.raw.slice(0, 300)}`,
            );
          }
          if (r.reason === 'queue-timeout') {
            this.host?.logger.w(`jvm-bridge ${className}.${method}: ${decision.result.reason}`);
          } else if (r.reason === 'timeout') {
            this.host?.logger.i(`jvm-bridge ${className}.${method} 失败原因: ${decision.result.reason}`);
          }
          return decision.result;
        }
        if (decision.type === 'cancelled') {
          cancellationError = signal ? abortError(signal) : new Error('搜索已取消');
        }
      } catch {
        if (signal?.aborted) throw abortError(signal);
        /* 池异常 → 回退一次性 */
      }
      if (cancellationError) throw cancellationError;
    }
    throwIfAborted(signal);
    return this.runSubprocessWithinProcessBudget(this.javaExe(), argv, className, method, executionTimeoutMs, undefined, signal);
  }

  /**
   * Keep cold recovery inside the same JVM/Python process cap as pooled children.
   * The slot is released only after the one-shot runner settles, including errors.
   */
  private async runSubprocessWithinProcessBudget(
    exe: string,
    argv: string[],
    className: string,
    method: string,
    timeoutMs?: number,
    env?: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<SpiderCallResult> {
    const release = this.processAdmission.tryAcquireFallbackProcessSlot();
    if (!release) {
      return spiderPoolCapacityResult('capacity-exhausted')!;
    }
    try {
      return await this.subprocessRunner.run(exe, argv, className, method, timeoutMs, env, signal);
    } finally {
      release?.();
    }
  }

  /**
   * .py 蜘蛛（嵌入式 CPython3）调用入口。
   * spawn <pyRuntimeDir>/<PY_VER>/python.exe runner.py，argv 语义与旧 PythonRunner 对齐：
   *   <pyPath> <className> <method> [ext] [args...]
   * runner.py 与 python.exe 同目录（ensurePythonRuntime 落盘），首行注入 sys.path
   * （Lib/site-packages/base），已处理 embed 包 _pth 隔离。
   * ★ 中文 Windows Python 默认 stdout GBK → 必须显式 PYTHONIOENCODING=utf-8。
   */
  async callPython(pyPath: string, clsName: string, method: string, args: string[], timeoutMs?: number, siteKey = '', signal?: AbortSignal): Promise<SpiderCallResult> {
    return this.pythonRuntime.callPython(pyPath, clsName, method, args, timeoutMs, siteKey, signal);
  }

  /** 进程池提交：同类请求复用同一 serve 进程。ok=false 仅表示进程/传输层失败（调用方回退一次性）。 */
  private async poolSubmit(
    exe: string,
    key: string,
    serveArgv: string[],
    className: string,
    method: string,
    args: string[],
    env?: Record<string, string>,
    timeoutMs?: number,
    preferredPort?: number,
    signal?: AbortSignal,
  ): Promise<PoolResult> {
    if (!this.pool) return { ok: false, data: '' };
    const id = `${exe.includes('python') ? 'py' : 'jvm'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise<PoolResult>((resolve) => {
      void this.pool!
        .submit(key, { exe, serveArgv, env, key }, { id, className, method, args }, timeoutMs, preferredPort, signal)
        .then(resolve)
        .catch(() => resolve({ ok: false, data: '' }));
    });
  }

  /** Python runtime directory used by the bundled bridge. */
  /**
   * ★ 2026-09-24 后台预热嵌入式 Python 运行时（不阻塞、幂等）：
    * 由 SpiderHost 在配置就绪/清缓存后调用 —— 把「13MB embed 下载 + 解压 + wheel 安装」提前到
   * 用户第一次进 .py 源之前完成，首次加载只剩「spawn 进程 + 蜘蛛 init」。
   * 失败静默（首次正常调用时会重试并上屏真实原因）。
   */
  prewarmPythonRuntime(): Promise<string> {
    return this.pythonRuntime.prewarmPythonRuntime();
  }

  /** Kept as a private seam for runtime verification; ownership lives in the Python adapter. */
  private ensurePythonRuntime(): Promise<string> {
    return this.pythonRuntime.ensureRuntime();
  }

  /**
   * ★ 2026-09-26：**是否需要原生桥**（同步判定，避免在普通路径上引入 await ——
   * 否则 spawn 会被推迟到微任务，调用方「紧接着断言子进程」的既有行为会被打破）。
   * 条件：宿主配置了运行时目录 + 桥 jar 在 + 至少一只 jar 含 `.so` 或 native 声明。
   */
  private nativeNeeded(jarPaths: string[]): boolean {
    return this.nativeRuntime.shouldEnable(jarPaths);
  }

  /** 原生桥注入的 JVM 参数：工作目录（.so/rootfs）与改写产物目录，运行器据此启用桥 */
  private nativeProps(nativeJars: string[]): string[] {
    return this.nativeRuntime.jvmProperties(nativeJars);
  }

  /** 包内 .so 或声明 native 方法（运行时下载库的壳）；按产物路径缓存。 */
  private jarNeedsNative(jarPath: string): boolean {
    return this.nativeRuntime.containsNativeCode(jarPath);
  }

  /** 后台预热原生运行时（不阻塞、幂等；转换产物含 .so 时触发） */
  private prewarmNativeRuntime(): void {
    this.nativeRuntime.prewarm();
  }

  private async ensureNativeRuntime(): Promise<string[]> {
    return this.nativeRuntime.ensure();
  }

  /** 生成 JVM 子进程的公共前置参数（旗标 + classpath），jar/python 模式共用。 */
  private jvmPrefix(cp: string, serve = false, portKey = cp): string[] {
    const sandboxDir = join(this.cacheDir, "..", "sandbox");
    try {
      if (!existsSync(sandboxDir)) mkdirSync(sandboxDir, { recursive: true });
    } catch {
      /* Let the runner use its default directory if the sandbox cannot be created. */
    }
    return buildJarJvmPrefix({
      runtimeClasspath: cp,
      loaderClasspath: portKey,
      serve,
      sandboxDirectory: sandboxDir,
      javaExecutable: this.javaExe(),
      dex2jarClasspath: this.dirJars(join(this.jvmDir, "d2j")).join(";"),
      dex2jarCacheDirectory: join(this.cacheDir, "runtime-dex"),
      proxyJvmArgs: this.proxyProvider?.().jvmArgs ?? [],
    });
  }

  /**
   * ★ 2026-09-26：TS 侧本地代理收到 `/proxy/<port>` 时调用 —— 把该 port 对应的蜘蛛 JVM 钉住，
   * 避免播放中段被池回收（回收器跳过钉住的进程；到期自动失效）。
   */
  pinSpiderProxy(port: number, ttlMs = 10 * 60_000): void {
    const key = this.runtimeSession.poolKeyForProxyPort(port);
    if (key) this.pool?.pin(key, ttlMs);
  }

  /** 预热：下载+转换（导入配置后后台跑，避免首次点开卡住） */
  warmup(jarUrl: string): Promise<void> {
    const url = normalizeJarUrl(jarUrl);
    const pending = this.warmupLocks.get(url);
    if (pending) return pending;
    if (this.conversionFailure(url)) return Promise.resolve();
    const task = this.ensureConverted(url).then(() => undefined).catch((e) => {
      this.host?.logger.w(`jvm-bridge warmup 失败 ${url}: ${(e as Error).message}`);
    }).finally(() => this.warmupLocks.delete(url));
    this.warmupLocks.set(url, task);
    return task;
  }

  /** 停止进程池并终止桥接器启动的一次性 JVM/Python/DEX 子进程。 */
  dispose(): void {
    if (this.poolReclaimTimer) clearInterval(this.poolReclaimTimer);
    this.pool?.dispose();
    this.subprocessRunner.dispose();
  }
}

/**
 * 把 **raw jar 里的非 dex 资源**（assets/**、lib/**、META-INF/** 等）搬进 dex2jar 的转换产物。
 *
 * ★★ 为什么必须有这一步（第十二轮定位到的真实根因）★★
 *
 * 加固/壳型 jar 的形态是：
 * ```
 * classes.dex                  ← 只是壳
 * assets/wexguard_v7.so        ← ARM 原生库（密钥在里面）
 * assets/wexshinidie.guard     ← 加密的真正代码（930KB）
 * ```
 * 壳的 `DexNative.<clinit>` 是这样取原生库的：
 * ```java
 * File so = new File(Init.context().getCacheDir(), ".wexfnw" + random());
 * InputStream in = Init.classLoader().getResourceAsStream("assets/" + name); // name = wexguard_v7.so
 * // 把 in 拷进 so，然后 System.load(so.getAbsolutePath())
 * ```
 * `Init.classLoader()` 是**加载 `Init` 的那个 ClassLoader**，也就是我们为这只 jar 建的
 * URLClassLoader —— 所以 `assets/wexguard_v7.so` 必须在**这只 jar 里**才读得到。
 *
 * **而 dex2jar 只输出 `.class`，会把 `assets/`、`classes.dex` 统统丢掉。**
 * 于是 `getResourceAsStream()` 返回 null → 紧接着 `in.read(buf)` 抛
 * ```
 * NullPointerException: Cannot invoke "java.io.InputStream.read(byte[])" because "<local4>" is null
 *     at com.github.catvod.spider.DexNative.<clinit>
 *     at com.github.catvod.spider.Init.init
 * ```
 * `DexNative` 的类初始化一旦失败就被 JVM 标记为 erroneous → **该 jar 全部源同时报废**
 * （实测一套配置 95 个源同一报错）。
 *
 * 第十一轮曾把这类报错定性为「安卓加固/壳，架构限制，无解」—— **那个定性是错的**：
 * 连"读 assets"这一步都没走到，报的 NPE 与 ARM/x86 架构毫无关系。
 * 真正的原因是移植侧把资源丢了。补齐资源后同一条链的报错变成
 * `UnsatisfiedLinkError: Can't load this .dll (machine code=0x34) on a AMD 64-bit platform`
 * —— 到这一步才是真正的架构问题，且它是**下一步要解决的对象**，不是"无解"。
 *
 * 实现要点：
 * - 直接读 **raw jar**（不用转换产物做源），避免"把已合并的产物再三重复合并"；
 * - 只搬运 dex2jar **不会产出**的条目（`*.dex` 与 dex2jar 的输出根目录下的 `.class` 跳过），
 *   其余一律原样字节搬运 —— `getResourceAsStream` 只认字节，不做任何解释；
 * - 目录条目按需补建，避免 zip 里出现"有文件无目录"的写法（部分解析器不认）；
 * - 失败只记警告、绝不抛出：合并是**增强**，不该让一个能转换的 jar 变成"转换失败"。
 *
 * 兼容 `jar uf` 的等价做法（本函数就是它的进程内实现，省掉一次 JVM 启动 + 磁盘中转）。
 */
export function copyJarResources(rawJar: string, convertedJar: string, logger?: JarResourceMergeLogger): void {
  try {
    const fs = require('node:fs') as typeof import('node:fs');
    const raw = fs.readFileSync(rawJar);
    if (!looksLikeZip(raw)) return;
    const converted = fs.readFileSync(convertedJar);
    const result = mergeJarResourceEntries(readZipEntries(converted), readZipEntries(raw));
    if (result.addedResourceCount === 0) return;

    fs.writeFileSync(convertedJar, buildZip(result.entries));
    logger?.i(`jvm-bridge 已补齐转换产物中的非 dex 资源 ${result.addedResourceCount} 项（加固壳必需）`);
  } catch (e) {
    // 资源合并属于增强步骤：失败不能让一个"已成功转换"的 jar 变成"转换失败"
    logger?.w(`jvm-bridge 资源合并失败（不影响普通 jar）: ${(e as Error).message}`);
  }
}


/** 转义正则特殊字符（文件名用于 RegExp 构造时防误解析） */


/**
 * 「下载到的内容是不是 jar / 裸 dex」—— jar 下载 UA 兜底的判定（见 doConvertStage）。
 *   zip：`PK\x03\x04`（jar/apk/zip 的本地文件头魔数）
 *   裸 dex：`dex\n`（魔数 `dex\n035\0`）
 * 只认魔数、不猜内容：真 jar 不会多打一次请求，HTML/错误页则触发 okhttp UA 重试。
 */
export function isJarOrDex(buf: Buffer): boolean {
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) return true; // PK\x03\x04
  return buf.length >= 8 && buf.subarray(0, 4).toString('latin1') === 'dex\n';
}

export { extractBridgeNotes, extractSpiderReason, extractSpiderReasonRaw, isGuardInnerSpiderNull, isSpiderClassMissing, stripJvmNoise, translateSpiderLog } from './spiderDiagnostics';
