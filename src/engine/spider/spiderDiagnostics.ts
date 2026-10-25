/** Pure spider/JVM diagnostics, kept independent from process orchestration. */

/**
 * 「蜘蛛类缺失」判定 —— 类缺失兜底重试的触发条件。
 * 原始英文（`ClassNotFoundException: com.github.catvod.spider.Xxx`）与 translateSpiderLog
 * 翻译后的中文（「蜘蛛类未找到…」）两种形态都认。
 */
export function isSpiderClassMissing(reason: string): boolean {
  const s = reason || '';
  if (!s) return false;
  return /ClassNotFoundException:\s*com\.github\.catvod\.spider\./.test(s) || s.includes('蜘蛛类未找到');
}

/** Machine-readable failure categories used by retry policy; never infer control flow from translated UI copy. */
export type SpiderFailureKind = 'guard-inner-spider-null' | 'spider-class-missing';

export function classifySpiderFailure(reason: string): SpiderFailureKind | null {
  if (isGuardInnerSpiderNull(reason)) return 'guard-inner-spider-null';
  if (isSpiderClassMissing(reason)) return 'spider-class-missing';
  return null;
}

/**
 * 把蜘蛛自己抛出的行话翻译成用户能懂的中文。
 *
 * 蜘蛛日志是给写蜘蛛的人看的（`Connect timed out` / `A JSONObject text must begin with '{'`），
 * 直接展示给普通用户等于没提示。这里做一层"人话映射"，命中不了则原样返回（不臆造）。
 */
export function translateSpiderLog(log: string): string {
  const s = (log || '').trim();
  if (!s) return '';
  const rules: Array<[RegExp, string | ((m: RegExpMatchArray) => string)]> = [
    [/Connect timed out/i, '连接源站超时，站点可能已停服或网络不通'],
    [/SocketTimeoutException|Read timed out|timeout/i, '请求源站超时，站点响应过慢或不可达'],
    [/UnknownHostException/i, '源站域名无法解析，站点可能已更换网址'],
    [/Connection refused/i, '源站拒绝连接，服务可能已下线'],
    [/JSONObject text must begin|JSONArray text must start/i,
      '源站返回的不是预期数据（多为站点已改版或停服，原接口已失效）'],
    [/bound must be positive/i, '蜘蛛内部参数异常，通常需要为该源补充 ext 配置'],
    [/Index \d+ out of bounds/i, '源站返回的数据结构与蜘蛛预期不符（站点可能已改版）'],
    [/SSLHandshake|PKIX|certificate/i, '与源站建立安全连接失败（证书问题或站点异常）'],
    // ---- ★ .py 蜘蛛（嵌入式 CPython3）专属 ----
    [/SyntaxError|invalid syntax|f-string|EOL while scanning|unexpected EOF|IndentationError/i,
      'python 蜘蛛脚本本身有语法/编码错误（Python3 解析失败），请检查源脚本'],
    // ★ 2026-09-30：报错必须**点出缺哪个库**（此前一律给同一句泛泛的说明，用户无法判断该不该反馈）。
    //   内置库清单见 EmbeddedPythonRuntime（首次用到会自动从 PyPI 镜像补齐）。
    [/No module named\s+'?"?([A-Za-z_][\w.]*)/i,
      (m) => `该 python 蜘蛛缺少第三方库「${m[1]}」—— 常用库（requests/urllib3/lxml/bs4/pyquery/Crypto/PIL…）会在首次使用时自动补齐，若持续报此错请反馈该库名`],
    [/ImportError/i, '该 python 蜘蛛导入依赖失败（库名未在报错里给出，请反馈该源）'],
    // ---- 桌面端架构性不兼容（对齐安卓原生能力缺失）----
    // 这一类必须排在通用的 ClassNotFound/NoSuchField 规则之前，否则会被后者吞掉，
    // 用户拿到的是一句"依赖缺失请反馈"，看不出「这个源在桌面端根本不成立」。
    //
    // ★ 第十二轮校正：加固壳的真实报错**不是**"找不到原生库"，而是
    //   `UnsatisfiedLinkError: <path>: Can't load this .dll (machine code=0x34) on a AMD 64-bit platform`
    //   —— 资源已经找对了（见 copyJarResources 补齐 assets 的说明），卡在 CPU 架构上。
    //   所以「原生库 ABI 不匹配」必须自成一条，且排在「找不到原生库」之前。
    [/Can't load this \.dll|machine code=0x[0-9a-f]+|wrong ELF class|not a valid Win32 application/i,
      'ARM 原生库（.so）未通过兼容桥加载，请检查原生运行时下载和该源的桥接日志；不能直接由 x64 JVM 加载'],
    [/UnsatisfiedLinkError|native method .* not found|no .* in java\.library\.path/i,
      '安卓原生库（.so）或 JNI 方法调用失败，当前兼容桥未能执行该源；请检查原生运行时和依赖日志'],
    [/dalvik[./]system[./]|DexClassLoader|NoClassDefFoundError: dalvik/i,
      '安卓动态 dex 加载失败，请检查转换产物、类路径与兼容桥；该错误不代表所有 dex 源均不支持'],
    // DEX 头部魔数：加载器把 dex 当类文件读时会给出这个字节序列
    [/dex\n?035|invalid dex|DexFile/i,
      '该源携带 dalvik 字节码（dex），桌面 JVM 无法执行（架构限制）'],
    // ---- ★ 蜘蛛"自身类"找不到 ≠ 桌面版缺接口 ----
    //   `com.github.catvod.spider.Xxx` 是蜘蛛 jar 里的类，找不到它只可能是
    //   "这只 jar 没加载成功"（缓存丢失/下载失败/配置里的 jar 与 api 不匹配），
    //   跟"桌面版缺 android.* 接口"完全是两回事。这条必须排在通用的
    //   ClassNotFound 规则之前，否则用户会被误导成"兼容性问题请反馈"，
    //   进而反复反馈一个根本不用修的问题（实测：缓存目录被外部清理后，
    //   95 个源全部报这一句）。
    [/ClassNotFoundException: ?com\.github\.catvod\.spider\./i,
      '蜘蛛类未找到：该源指向的 jar 没有加载成功（配置与 jar 不匹配，或 jar 资源已失效）'],
    // ★ 2026-10-08（用户报「配置中心」源）：这类报错**具体缺哪个类/方法/字段**才是可行动信息 ——
    //   旧文案一律「请反馈」，且调用处只落人话、原始异常被吞（用户日志里拿不到符号名，无法定位该补哪个桩）。
    //   这里把符号名抠出来上屏；调用处已同步补「原始: …」落日志（见 call() 两处）。
    //   注意保留「桌面版缺失」「请反馈」措辞 —— 既有测试与用户认知都按这句对齐。
    [/NoSuchMethodError: ?'?([\w.$<>[\]]+)/,
      (m) => `桌面版缺失方法「${m[1]}」（属兼容性问题，请反馈）`],
    [/NoSuchFieldError: ?'?([\w.$]+)/,
      (m) => `桌面版缺失字段「${m[1]}」（属兼容性问题，请反馈）`],
    [/ClassNotFoundException: ?([\w.$]+)/,
      (m) => `桌面版缺失类「${m[1]}」（属兼容性问题，请反馈）`],
    [/ClassNotFoundException|NoSuchMethodError|NoSuchFieldError/i,
      '蜘蛛依赖的接口在桌面版缺失（属兼容性问题，请反馈）'],
    [/ExceptionInInitializerError/i,
      '蜘蛛静态初始化失败（内部依赖在桌面版缺失，请反馈此源）'],
    // ★ 2026-09-29：加固壳「守卫内层蜘蛛为空」（`BaseSpiderGuard.<init>` → `Init.getSpider` 拿到 null）
    //   的原始报错是 `NullPointerException: Cannot invoke "…Spider.init(Context, String)"`，
    //   必须**排在通用规则之后**才不抢别人的匹配，但排在原样兜底之前 —— 否则用户只看到一句截断的英文 NPE。
    [/crawler\.Spider\.init\(android\.content\.Context|守卫内层蜘蛛为空|加固壳内部蜘蛛未就绪/,
      '守卫内层蜘蛛为空：加固 Java 蜘蛛未能生成可执行加载器；如源内有兼容实现会自动重试，否则请切换线路或反馈源名和诊断记录'],
  ];
  for (const [re, human] of rules) {
    const m = s.match(re);
    if (!m) continue;
    return typeof human === 'function' ? human(m) : human;
  }
  return s.slice(0, 120);
}

/**
 * ★★ 2026-09-29（设备实证）：判断失败原因是不是「守卫壳的内层蜘蛛为空」。
 *
 * 加固壳的 `BaseSpiderGuard.<init>` 会调 `Init.getSpider(this.getClass().getName())`，把返回的真实
 * 蜘蛛存进字段；任何一环没接上（原生桥 `DexNative.getLoader` 没返回加载器 / 运行时 dex 产物异常 /
 * shell-shim 真实实现缺失）字段就是 null，随后第一个 `init()` 抛
 * `NullPointerException: Cannot invoke "com.github.catvod.crawler.Spider.init(android.content.Context, String)"`。
 * 注意：上屏前的原因会按 120 字符截断（截到 `because "…"` 附近），所以判据只取方法签名部分。
 */
export function isGuardInnerSpiderNull(reason: string): boolean {
  const s = reason || '';
  return /crawler\.Spider\.init\(android\.content\.Context/.test(s)
    || /加固壳内部蜘蛛未就绪|守卫内层蜘蛛为空/.test(s);
}

/**
 * 从子进程 stderr 中提取"蜘蛛自身报告的原因"。
 *
 * 蜘蛛在 catch 分支里通常用 `SpiderLog.e(msg, throwable)` 打印，桌面端由
 * `android.util.Log` stub 落到 stderr（形如 `[android.Log.D] SpiderLog: <原因> :: <异常>`）。
 * 这里取**最后一条** SpiderLog（越靠后越接近真实出口），并压成一行短文本。
 * 找不到返回空串（不臆造原因）。
 */
export function extractSpiderReason(stderr: string): string {
  return lastFailureSpiderLog(stderr)?.msg.slice(0, 120) ?? '';
}

/**
 * ★ 2026-10-08：取同一条 SpiderLog 的**原文**（含 ` :: 异常` 尾巴，截断 300）。
 * 人话翻译会把尾巴里的关键信息吞掉（如 NoSuchMethodError 缺的具体符号），
 * 供「失败原因」日志旁并记原始串，便于定位该补哪个桩 / 该反馈什么。
 */
export function extractSpiderReasonRaw(stderr: string): string {
  return lastFailureSpiderLog(stderr)?.raw.slice(0, 300) ?? '';
}

/** 找最后一条「真实失败」SpiderLog（成功/加载类日志不算）；返回消息与含异常尾巴的原文 */
function lastFailureSpiderLog(stderr: string): { raw: string; msg: string } | null {
  if (!stderr) return null;
  const lines = stderr.split(/\r?\n/);
  // 从后往前找 SpiderLog 行（蜘蛛的失败原因通常最后打印）
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const idx = line.indexOf('SpiderLog:');
    if (idx < 0) continue;
    const raw = line.slice(idx + 'SpiderLog:'.length).trim();
    let msg = raw;
    // 去掉 " :: <异常类>: <详细>" 尾巴，只留人可读的前半句
    const sep = msg.indexOf(' :: ');
    if (sep > 0) msg = msg.slice(0, sep).trim();
    // ★ 只保留「真正的失败原因」。以下日志前缀属蜘蛛成功路径/启动路径的提示，不是失败：
    //   - `自定义爬虫代码加载成功`（简/繁两种写法都有，繁体曾漏过滤导致 28 条假失败）
    //   - `获取到源码--> ...`（蜘蛛已成功取到源站正文，随后解析，属成功日志）
    if (msg && !/^(自定义爬虫代码加载成功|自定義爬蟲代碼載入成功|获取到源码-->)/.test(msg)) return { raw, msg };
  }
  return null;
}

/**
 * 过滤 JVM 级噪声，只留下有诊断价值的 stderr 行。
 *
 * 已知噪声（不代表蜘蛛失败）：
 * - `-noverify` / `-Xverify:none` 在 JDK13+ 的 deprecation warning
 * - 混淆蜘蛛内部的反射探测噪声（`NoSuchMethodException` / `NoSuchFieldException`），
 *   它们被蜘蛛自己的 try/catch 吞掉，属于"探测能力存在与否"的正常流程
 * - `Picked up JAVA_TOOL_OPTIONS` 之类的环境提示
 *
 * 注意：**不要**过滤 `[SpiderRunner.ERROR]`，那是真实失败信号。
 */
export function stripJvmNoise(stderr: string): string {
  if (!stderr) return '';
  return stderr
    .split(/\r?\n/)
    .filter((l) => {
      const t = l.trim();
      if (!t) return false;
      if (/were deprecated in JDK 13 and will likely be removed/.test(t)) return false;
      if (t.startsWith('java.lang.NoSuchMethodException:')) return false;
      if (t.startsWith('java.lang.NoSuchFieldException:')) return false;
      if (/^Picked up .*OPTIONS/.test(t)) return false;
      if (/^at (java\.base\/)?java\.lang\.Class\.(getMethod|getDeclaredMethod|getField|getDeclaredField)\b/.test(t)) return false;
      if (/^at (java\.base\/)?jdk\.internal\.reflect\./.test(t)) return false;
      return true;
    })
    .join('\n');
}

/**
 * 抽取原生桥（ARM .so）在子进程里的说话行 —— 用于把「静默降级」可见化：
 * 桥的成败只打在子进程 stderr 上，而 stderr 平时只用于提取 SpiderLog 失败原因，
 * 于是「桥失败 → 按无原生桥降级」在界面与主日志里毫无线索（真机实测：只能靠手工探针才查出来）。
 * 识别两类：桥自己打的 `[native-bridge] …`，与运行器转发的 `[SpiderRunner] 原生桥…`。
 */
export function extractBridgeNotes(stderr: string): string[] {
  if (!stderr) return [];
  const out: string[] = [];
  for (const raw of stderr.split(/\r?\n/)) {
    const t = raw.trim();
    if (!t) continue;
    if (t.startsWith('[native-bridge]')) out.push(t);
    else if (t.startsWith('[SpiderRunner]') && /原生桥|改写|注册 native/.test(t)) out.push(t);
    // ★ 2026-09-27（载荷层排障）：这三类前缀此前被过滤掉，导致「载荷解密/运行时转换/壳 Init」
    //   的失败在应用日志里完全不可见（用户只看到「蜘蛛返回空结果」）——一律保留。
    //   注：`[SpiderRunner.ERROR]` 不在此列（一次性路径已单独提取上屏，池路径由 extractSpiderReason 兜），
    //   避免同一条错误重复上屏。
    else if (t.startsWith('[runtime-dex]') || t.startsWith('[dexjar-repair]') || t.startsWith('[Init]')) out.push(t);
    // ★ 2026-09-29：shell-shim 影子 DexNative 的说话行（真实实现加载失败/命中与否）——此前只在
    //   -Dtvbox.shellShim.debug=true 时才打印，设备上「守卫内层蜘蛛为空」时拿不到任何线索，一并上屏。
    else if (t.startsWith('[ShellShim]')) out.push(t);
    else if (t.startsWith('[SpiderRunner] 警告')) out.push(t);
    // ★ 2026-10-09（.8 探针「无输出」真因，勿删）：宿主代理与 baidu-state 探针的说话行不在
    //   白名单里，serve 进程 stderr 中被静默丢弃 —— 本地直跑 stubs.jar 能看到探针输出、
    //   真机上却「无 [baidu-state]」，第十轮日志因此误判为孤儿 JVM。池/一次性两条路径都经
    //   本函数，加白名单即全覆盖（noteBridgeLog 有整行去重，高频「请求处理失败」不会刷屏）。
    else if (t.startsWith('[host-proxy]')) out.push(t);
    else if (t.startsWith('[baidu-state]')) out.push(t);
  }
  return out;
}
