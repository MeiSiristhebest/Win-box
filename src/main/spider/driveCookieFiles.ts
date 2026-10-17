// src/main/spider/driveCookieFiles.ts — 把用户绑定的网盘凭据同步为「jar 系期望的 cookie 文件」。
//
// ★ 2026-09-29 通解（对 Pizazz / 太太太硬了 系 jar 的实证，反编译自用户实际 jar）：
//   该族（sun.json；含 玩偶 csp_Wogg、木偶/快映 csp_PanWebShare、豆瓣 csp_Douban、配置 csp_Config…）
//   在 `detailContent` 组装播放列表前调用 `merge.a.a.filterCloudDiskLinks(url)`：
//     · 链接命中 pan.quark.cn  → 要求 /quark_cookie.txt 存在且内容非空，否则降级返回类型名「quark」；
//     · drive.uc.cn            → /uc_cookie.txt；
//     · pan.baidu.com          → /baidu.txt；
//     · 其余（cloud123/cloud189/aliyun/xunlei/guangya 同理）。
//   被降级 = 该条网盘链接被**丢弃**（列表里只剩类型名或整条移除）→ 用户侧现象
//   「源能进、能搜，但详情里拿不到可播资源 / 播放列表为空」。
//   文件路径 = `<externalStorage>/TVBox/<file>.txt`（jar 用 `merge.m.k.b()` 拼：外部存储 + "TVBox"）。
//   桌面桩 `android.os.Environment.getExternalStorageDirectory()` = `<java.io.tmpdir>/tvbox-ext`
//   （见 resources/jvm/stubs-src 同源构建的 stubs.jar），故实际落点 =
//     `<os.tmpdir()>/tvbox-ext/TVBox/<file>.txt`
//   内容协议（反编译实证）：`merge.b.w.r(key)` = `new JSONObject(k.a(file)).optString(key)`，
//   即 **JSON 对象、键 `cookie`**：`{"cookie":"..."}`（与安卓 TVBox 用户手放/源设置页写出的格式一致）。
//
//   与之并列的 fty 系（Cloud_*Guard）读的是 ext["Cloud-drive"] 指向的配置文件（quarkCookie/ucCookie…），
//   由 SpiderHost.syncCloudDriveConfig 负责——两者互补，缺一都会「详情/取流为空」。
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

/** provider（DriveStore 键，小写）→ Pizazz 系 cookie 文件名（名单取自 jar 内字符串引用） */
export const PIZAZZ_COOKIE_FILES: Record<string, string> = {
  quark: 'quark_cookie.txt',
  uc: 'uc_cookie.txt',
  baidu: 'baidu.txt',
  ali: 'aliyun.txt',
  alipan: 'aliyun.txt', // 历史双键，归一化前也可能出现
};

/** Pizazz 系 cookie 目录 = 外部存储桩/TVBox（与 jar 内 `merge.m.k.b()` 拼接一致） */
export function pizazzCookieDir(tmp = tmpdir()): string {
  return join(tmp, 'tvbox-ext', 'TVBox');
}

/** 单个 provider 的 cookie 文件绝对路径；无映射返回 '' */
export function pizazzCookiePath(provider: string, tmp = tmpdir()): string {
  const file = PIZAZZ_COOKIE_FILES[String(provider || '').trim().toLowerCase()];
  return file ? join(pizazzCookieDir(tmp), file) : '';
}

/**
 * 写单个 provider 的 cookie 文件。
 * ★★ 2026-10-09（用户日志 + 反编译实证，根因修复）：
 *   xiaosa 族（玩偶 csp_Wogg / 木偶 csp_PanWebShare 等）对 **quark / uc** 的登录判定 =
 *   Gson 反序列化 `merge.i.d` 后 **三字段均非空**（`d()` = a()>0 && b()>0 && c()>0；
 *   映射：`cookie` / `member_type` / `nickname`，见 `merge.b.w.o().d()` 与 `merge.b.B.l().d()`）。
 *   桌面端此前只写 `{"cookie":…}` → member_type/nickname 为空 → **已绑定仍报
 *   「还未登录夸克账号,请前往【配置中心】登录」**（quark）与对应 UC 文案。
 *   · 三字段的值**不参与业务**（jar 内仅 d() 校验非空）→ 后两者缺省填占位；
 *   · **旧文件里已有真实值（jar 自己回写过）则保留**——不覆盖真数据。
 *   · 百度（`merge.b.j`）只读 `cookie` 键（实证）→ **不补三键**。
 */
export function writePizazzCookieFile(provider: string, value: string, tmp = tmpdir()): string {
  const path = pizazzCookiePath(provider, tmp);
  const v = String(value || '').trim();
  if (!path || !v) return '';
  const p = String(provider || '').trim().toLowerCase();
  const body: Record<string, string> = { cookie: v };
  if (p === 'quark' || p === 'uc') {
    let keepNick = '';
    let keepType = '';
    try {
      const old = JSON.parse(readFileSync(path, 'utf-8')) as { nickname?: unknown; member_type?: unknown } | null;
      if (old && typeof old.nickname === 'string') keepNick = old.nickname.trim();
      if (old && typeof old.member_type === 'string') keepType = old.member_type.trim();
    } catch {
      /* 无旧文件 / 损坏 → 用占位 */
    }
    body.nickname = keepNick || 'Win-Box';
    body.member_type = keepType || '1';
  }
  mkdirSync(pizazzCookieDir(tmp), { recursive: true });
  writeFileSync(path, JSON.stringify(body), 'utf-8');
  return path;
}

/**
 * 读回单个 provider 的 cookie 文件内容（用于「已有内容不重复写」判定与自检）：
 * 不存在/损坏返回 ''。
 */
export function readPizazzCookie(provider: string, tmp = tmpdir()): string {
  const path = pizazzCookiePath(provider, tmp);
  if (!path || !existsSync(path)) return '';
  try {
    const obj = JSON.parse(readFileSync(path, 'utf-8')) as { cookie?: unknown };
    return typeof obj?.cookie === 'string' ? obj.cookie : '';
  } catch {
    return '';
  }
}

/** 删除单个 provider 的 cookie 文件（解绑用；等价上游「清空该文件」语义，对 jar 侧一律视为未配置） */
export function removePizazzCookieFile(provider: string, tmp = tmpdir()): void {
  const path = pizazzCookiePath(provider, tmp);
  if (!path) return;
  rmSync(path, { force: true });
}

// ---------------------------------------------------------------------------
// ★ 2026-10-09 wex 系（玩偶 / 花卷 / 木偶等，壳通解家族）——第三通道
//
// 反编译实证（解密 dex 的 `Quark.checkquarkcookie()` / `Ucpan.checkuccookie()`，dex2jar + javap）：
//   · 读文件 = `getCache("quarkcookie")` → `new File(<Context.getFilesDir()>/TV, ".quarkcookie")`
//     （文件名规则：不以 "." 开头的资源名会被加 "." 前缀）；UC = `.ucpancookie`（资源名 ucpancookie）。
//   · 内容为**裸 cookie 串**（UTF-8 读入后直接 trim 当 Cookie 用，**不是** JSON）——
//     缺失/为空即报「还没有配置夸克 Cookie，请先去配置中心登录夸克」。
//   · `Context.getFilesDir()` 落点 = SpiderRunner 的 `-Dtvbox.spiderCacheDir`（桌面桩），
//     即 `<spider 缓存根>/sandbox/files/TV/`（SpiderRunner.java 里 `Context.setBaseDir(<sandbox>)`）。
//
// ★ 缺口回顾：此前桌面只同步了 fty 云盘配置与 Pizazz 的 TVBox/*.txt 两条通道，wex 系
//   读取的 `.quarkcookie` 从未写过 → 已绑定也报「还没有配置夸克 Cookie」。
// ---------------------------------------------------------------------------

/** wex 系 cookie 文件名（provider 小写键 → 文件名）；资源名来自 jar 内字符串表（SaZ.d 解密） */
export const WEX_COOKIE_FILES: Record<string, string> = {
  quark: '.quarkcookie',
  uc: '.ucpancookie',
};

/**
 * 蜘蛛 JVM 数据沙箱根：`<spider 缓存根>/sandbox`。
 * 口径与 JarSpiderBridge 的 `join(cacheDir, '..', 'sandbox')`（cacheDir = `<缓存根>/converted`）等价，
 * 也是 JVM 侧 `-Dtvbox.spiderCacheDir` 的值 —— 两处必须一致，勿分别手拼。
 */
export function spiderSandboxDir(spiderCacheRoot: string): string {
  return join(spiderCacheRoot, 'sandbox');
}

/** wex 系 cookie 目录 = 沙箱内 `files/TV`（Context.getFilesDir() + "/TV"） */
export function wexCookieDir(sandboxDir: string): string {
  return join(sandboxDir, 'files', 'TV');
}

/** 单个 provider 的 wex cookie 文件绝对路径；无映射返回 '' */
export function wexCookiePath(provider: string, sandboxDir: string): string {
  const file = WEX_COOKIE_FILES[String(provider || '').trim().toLowerCase()];
  return file ? join(wexCookieDir(sandboxDir), file) : '';
}

/**
 * 写单个 provider 的 wex cookie 文件（内容 = 裸 cookie 串，jar 侧直接 trim 使用）。
 * provider 无映射或凭据为空 → 不写，返回 ''；成功返回写入路径。
 */
export function writeWexCookieFile(provider: string, value: string, sandboxDir: string): string {
  const path = wexCookiePath(provider, sandboxDir);
  const v = String(value || '').trim();
  if (!path || !v) return '';
  mkdirSync(wexCookieDir(sandboxDir), { recursive: true });
  writeFileSync(path, v, 'utf-8');
  return path;
}

/** 删除单个 provider 的 wex cookie 文件（解绑用；jar 侧读到空 = 未配置） */
export function removeWexCookieFile(provider: string, sandboxDir: string): void {
  const path = wexCookiePath(provider, sandboxDir);
  if (!path) return;
  rmSync(path, { force: true });
}

/**
 * 全量同步：把 tokens 里所有有映射的 provider 落盘（wex 系）。
 * 返回实际写入的文件绝对路径列表（无变化/无映射的跳过）。
 */
export function syncWexCookieFiles(tokens: Record<string, string>, sandboxDir: string): string[] {
  const written: string[] = [];
  for (const provider of Object.keys(WEX_COOKIE_FILES)) {
    const value = tokens?.[provider];
    if (typeof value === 'string' && value.trim()) {
      const path = writeWexCookieFile(provider, value, sandboxDir);
      if (path) written.push(path);
    } else {
      // Full sync semantics: a removed/empty credential must not leave a stale
      // cookie that makes a later JVM appear authenticated with old data.
      removeWexCookieFile(provider, sandboxDir);
    }
  }
  return written;
}

// ---------------------------------------------------------------------------
// ★ 2026-10-14 wex 系「SharedPreferences 通道」——第四通道（根因修复，见 MEMORY 一〇八）
//
// 反编译实证：wex 族（玩偶/虎斑/爱看…）的 `Wex_*` 键存在 **Android SharedPreferences
//   `NewWexFnw_preferences`** 里（`merge/x0/e.H()` = `InitOrigin.context().getSharedPreferences(...)`，
//   `x0/e.I(k, d)` = `H().getString(k, d)`）。
// 而桌面桩的 SharedPreferences 是**纯内存**实现（从不落盘）⇒ Node 写任何文件都到不了它。
// 修法 = `prefs-shim` 影子类（见 src/engine/spider/prefsShim.ts）：它排在 -cp 最前盖住原桩，
//   并从 `<Context.getBaseDir()>/shared_prefs/seed.txt` 读种子，每行 `表名 \t 键 \t 值`。
// 因此本文件是第四通道：既写文件通道（前三通道），也写这份 SharedPreferences 种子。
// ---------------------------------------------------------------------------

/** wex 系 SharedPreferences 表名（反编译实证；与 prefsShim.WEX_PREFS_NAME 同值，勿各自手拼） */
export const WEX_PREFS_NAME = 'NewWexFnw_preferences';

/** provider（DriveStore 小写键）→ `Wex_*` 配置键（名单取自 jar 常量池） */
export const WEX_PREF_KEYS: Record<string, string> = {
  quark: 'Wex_quark_cookie',
  uc: 'Wex_ucpan_cookie',
  baidu: 'Wex_baidu_cookie',
};

/**
 * 与凭据无关的**桌面环境键**（恒写入）：该族的默认多线程方式是 Go（`GoProxy.startServer`），
 * 而桌面端**没有 Go 代理**（初始化阶段被跳过）⇒ 走 Go 的原画线路必报
 * `[baidu](threadProxy) Go多线程启动失败`。这里强制切到 Java 多线程（配置中心里的
 * 「多线程代理 = Java多线程」等价物），是桌面端唯一能走通的模式。
 */
export const WEX_PREF_ENV: Record<string, string> = {
  'pan.thread_proxy_mode': 'java',
};

/**
 * ★ 2026-10-14 UC TV Token（非会员 UC 原画）：wex 族的 UC 取流在 `MyPan$UcMineProvider.player()`
 *   按 `member_type` 分流——NORMAL（非高会）时读的是 **`Wex_ucpan_token`**（OAuth token 对 JSON），
 *   不是 cookie；缺它即报「非高会需要配置 UC TV Token，请到配置中心扫码获取」。
 *   `Wex_ucpan_device_id` 是配套的设备指纹（jar 缺省会自造 `md5(当前毫秒)`，我们写入保持一致）。
 *   键名取自 jar 常量池（见 `ucTvToken.ts` 头注释与 MEMORY 一〇九）。
 */
export const UCTV_PREF_KEYS = {
  token: 'Wex_ucpan_token',
  deviceId: 'Wex_ucpan_device_id',
} as const;

/** UC TV Token 种子输入（来自 UcTvStore 的明文记录） */
export interface UcTvSeedInput {
  deviceId: string;
  token: string;
}

/** 种子文件路径 = `<沙箱>/shared_prefs/seed.txt`（与 prefsShim.PREFS_SEED_REL 同源） */
export function wexPrefsSeedPath(sandboxDir: string): string {
  return join(sandboxDir, 'shared_prefs', 'seed.txt');
}

/**
 * 全量同步 wex 系 SharedPreferences 种子（第四通道）。
 * 无任何有效凭据时删除该文件（jar 侧读到空 = 未配置）。返回写入路径或 ''。
 * `ucTv` 非空时额外写入 UC TV Token 两键（非会员原画必需）。
 */
export function syncWexPrefsSeed(
  tokens: Record<string, string>,
  sandboxDir: string,
  ucTv?: UcTvSeedInput | null,
): string {
  const lines: string[] = [];
  // 种子是按行/按制表符切分的纯文本 ⇒ 值里不能出现 \r\n\t（cookie/JSON 实际不会，但仍防御一次）
  const clean = (v: unknown): string => (typeof v === 'string' ? v.replace(/[\r\n\t]/g, '').trim() : '');
  for (const [provider, key] of Object.entries(WEX_PREF_KEYS)) {
    const v = clean(tokens?.[provider]);
    if (v) lines.push(`${WEX_PREFS_NAME}\t${key}\t${v}`);
  }
  const tvToken = clean(ucTv?.token);
  const tvDevice = clean(ucTv?.deviceId);
  if (tvToken) {
    lines.push(`${WEX_PREFS_NAME}\t${UCTV_PREF_KEYS.token}\t${tvToken}`);
    if (tvDevice) lines.push(`${WEX_PREFS_NAME}\t${UCTV_PREF_KEYS.deviceId}\t${tvDevice}`);
  }
  for (const [key, v] of Object.entries(WEX_PREF_ENV)) lines.push(`${WEX_PREFS_NAME}\t${key}\t${v}`);
  const path = wexPrefsSeedPath(sandboxDir);
  if (!lines.length) {
    rmSync(path, { force: true });
    return '';
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.join('\n') + '\n', 'utf-8');
  return path;
}

/**
 * 全量同步：把 tokens（DriveStore 明文列表）里所有有映射的 provider 落盘。
 * 返回实际写入的文件名列表（无变化/无映射的跳过）。
 */
export function syncPizazzCookieFiles(tokens: Record<string, string>, tmp = tmpdir()): string[] {
  const written: string[] = [];
  const normalized: Record<string, string> = {};
  for (const [rawProvider, rawValue] of Object.entries(tokens || {})) {
    const provider = rawProvider.trim().toLowerCase() === 'alipan' ? 'ali' : rawProvider.trim().toLowerCase();
    if (provider === 'ali') {
      // A present canonical `ali` key wins even when it is empty. This lets
      // an explicit unbind remove a legacy `alipan` file deterministically.
      if (rawProvider.trim().toLowerCase() === 'ali' || normalized[provider] === undefined) {
        normalized[provider] = typeof rawValue === 'string' ? rawValue : '';
      }
    } else if (typeof rawValue === 'string') {
      normalized[provider] = rawValue;
    }
  }
  // Iterate the known file set rather than the input object so removed or empty
  // credentials cannot leave a stale cookie that a jar treats as authenticated.
  for (const provider of new Set(Object.keys(PIZAZZ_COOKIE_FILES).map((p) => p === 'alipan' ? 'ali' : p))) {
    const value = normalized[provider] || '';
    const path = value ? writePizazzCookieFile(provider, value, tmp) : '';
    if (path) written.push(path);
    if (!value) removePizazzCookieFile(provider, tmp);
  }
  return written;
}
