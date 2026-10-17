// src/engine/spider/prefsShim.ts
// ★★ 2026-10-14（路线 B，最小可用版）：让 wex 族的网盘 cookie 能被 jar 读到 ★★
//
// 问题（反编译实证，见 MEMORY 一〇八）：
//   wex 族（玩偶/虎斑/爱看…）的 `Wex_ucpan_cookie / Wex_baidu_cookie / Wex_quark_cookie …` 全部存在
//   **Android SharedPreferences `NewWexFnw_preferences`** 里：
//     `merge/x0/e.H()`     = `InitOrigin.context().getSharedPreferences("NewWexFnw_preferences", 0)`
//     `merge/x0/e.I(k, d)` = `H().getString(k, d)`
//   而桌面桩 `android/content/SharedPreferences$Mem` 是**纯内存**实现（`static Map INST` + 每实例
//   `Map data`，全类无任何文件字面量）⇒ JVM 每次启动都是空的 ⇒ jar 永远报「还没有配置 UC/百度 Cookie」。
//   ⇒ **Node 侧写任何磁盘文件都到不了它**。
//
// 解法：Node 端**确定性生成**一个同名替换类 `android/content/SharedPreferences$Mem`（v49，免
//   StackMapTable；手法与 `appProxyStub.buildSpiderProxyClass` 一致），它：
//     · 保持与原类**同一套公开 API**（`implement SharedPreferences, SharedPreferences$Editor`，
//       静态 `get(String)`、`getString/getInt/getBoolean/getLong/getAll/contains/edit`、Editor 的
//       `putString/putInt/putBoolean/putLong/remove/clear/commit/apply`）；
//     · `<clinit>` 从 `<Context.getBaseDir()>/shared_prefs/seed.txt` 读**种子**（每行
//       `表名 \t 键 \t 值`），pref 名与键值均来自 Node 侧写入的文件。
//   该替换类打成小 jar，排在 `-cp` **最前**（先于 stubs.jar，同 okhttp4-compat 手法）⇒ 影子掉原桩。
//
// 为什么不用「改桩源码 + 重建 stubs.jar」：本机**已无任何 JDK/javac**（见 MEMORY 一〇八-5），
//   且打包后 `resources/` 只读 —— 只有"Node 现场生成类字节"这条路走得通。
import { buildZip, type ZipEntryData } from '../util/syncZip';

/** 影子类在 jar 内的条目名（FQN 斜杠写法 + `.class`） */
export const PREFS_MEM_CLASS = 'android/content/SharedPreferences$Mem';
/** 影子 jar 文件名（放 `resources/jvm/prefs-shim/` 下） */
export const PREFS_SHIM_JAR = 'winbox-prefs-shim.jar';
/** SharedPreferences 名（反编译实证：`merge/x0/e.H()` 里写死） */
export const WEX_PREFS_NAME = 'NewWexFnw_preferences';
/** 种子文件名（相对 `Context.getBaseDir()`）—— Node 写、`Mem.<clinit>` 读 */
export const PREFS_SEED_REL = 'shared_prefs/seed.txt';

const SEP_NAME = '\t';
const SEP_LINE = '\n';

const D = (s: string): Buffer => Buffer.from(s, 'utf8');
function u2(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n & 0xffff, 0);
  return b;
}
function u4(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

/** 极简常量池管理器（按 key 去重，只在缺失时构造，保证下标稳定） */
class Cp {
  private list: Buffer[] = [];
  private memo = new Map<string, number>();
  private add(key: string, make: () => Buffer): number {
    const hit = this.memo.get(key);
    if (hit) return hit;
    // ★ 必须先 make()（它可能 push 出内层 utf8 项），再定自己的下标 —— 否则下标会比实际位置小。
    const buf = make();
    const idx = this.list.length + 1;
    this.list.push(buf);
    this.memo.set(key, idx);
    return idx;
  }
  utf8(s: string): number {
    return this.add('u:' + s, () => {
      const b = D(s);
      return Buffer.concat([Buffer.from([1]), u2(b.length), b]);
    });
  }
  klass(name: string): number {
    return this.add('c:' + name, () => Buffer.concat([Buffer.from([7]), u2(this.utf8(name))]));
  }
  str(s: string): number {
    return this.add('s:' + s, () => Buffer.concat([Buffer.from([8]), u2(this.utf8(s))]));
  }
  nat(n: string, d: string): number {
    return this.add('n:' + n + '|' + d, () => Buffer.concat([Buffer.from([12]), u2(this.utf8(n)), u2(this.utf8(d))]));
  }
  field(c: string, n: string, d: string): number {
    return this.add('f:' + c + '.' + n + d, () => Buffer.concat([Buffer.from([9]), u2(this.klass(c)), u2(this.nat(n, d))]));
  }
  method(c: string, n: string, d: string): number {
    return this.add('m:' + c + '.' + n + d, () => Buffer.concat([Buffer.from([10]), u2(this.klass(c)), u2(this.nat(n, d))]));
  }
  imethod(c: string, n: string, d: string): number {
    return this.add('i:' + c + '.' + n + d, () => Buffer.concat([Buffer.from([11]), u2(this.klass(c)), u2(this.nat(n, d))]));
  }
  get count(): number {
    return this.list.length + 1;
  }
  serialize(): Buffer {
    return Buffer.concat(this.list);
  }
}

type Item = { kind: 'op'; op: number; ops: number[]; fix?: Array<{ at: number; label: string }> } | { kind: 'label'; name: string };

/**
 * 单遍可回填的极简汇编器：分支只支持 3 字节形态（if* / goto），偏移相对**指令自身地址**（JVM 规范）。
 */
class Asm {
  private items: Item[] = [];
  emit(op: number, ...ops: number[]): this {
    this.items.push({ kind: 'op', op, ops });
    return this;
  }
  label(name: string): this {
    this.items.push({ kind: 'label', name });
    return this;
  }
  branch(op: number, label: string): this {
    this.items.push({ kind: 'op', op, ops: [0, 0], fix: [{ at: 0, label }] });
    return this;
  }
  assemble(): { code: Buffer; labels: Map<string, number> } {
    const offs: number[] = [];
    let pos = 0;
    for (const it of this.items) {
      offs.push(pos);
      if (it.kind === 'op') pos += 1 + it.ops.length;
    }
    const labels = new Map<string, number>();
    this.items.forEach((it, i) => {
      if (it.kind === 'label') labels.set(it.name, offs[i]);
    });
    const buf = Buffer.alloc(pos);
    this.items.forEach((it, i) => {
      if (it.kind !== 'op') return;
      let p = offs[i];
      buf[p++] = it.op;
      for (const b of it.ops) buf[p++] = b & 0xff;
      if (it.fix) {
        for (const f of it.fix) {
          const target = labels.get(f.label);
          if (target === undefined) throw new Error('prefs-shim: 未定义的标号 ' + f.label);
          buf.writeInt16BE(target - offs[i], offs[i] + 1 + f.at);
        }
      }
    });
    return { code: buf, labels };
  }
}

/** 生成 Code 属性；`ex` 里用标号名描述异常表 [start, end, handler, catchType] */
function codeAttr(
  cp: Cp,
  asm: Asm,
  maxStack: number,
  maxLocals: number,
  ex: Array<[string, string, string, string]> = [],
): Buffer {
  const { code, labels } = asm.assemble();
  const need = (n: string): number => {
    const v = labels.get(n);
    if (v === undefined) throw new Error('prefs-shim: 异常表标号缺失 ' + n);
    return v;
  };
  const exBytes = ex.map(([s, e, h, t]) =>
    Buffer.concat([u2(need(s)), u2(need(e)), u2(need(h)), t ? u2(cp.klass(t)) : u2(0)]),
  );
  const body = Buffer.concat([u2(maxStack), u2(maxLocals), u4(code.length), code, u2(ex.length), ...exBytes, u2(0)]);
  return Buffer.concat([u2(cp.utf8('Code')), u4(body.length), body]);
}

function method(cp: Cp, access: number, name: string, desc: string, code: Buffer | null): Buffer {
  const n = cp.utf8(name);
  const d = cp.utf8(desc);
  if (!code) return Buffer.concat([u2(access), u2(n), u2(d), u2(0)]);
  return Buffer.concat([u2(access), u2(n), u2(d), u2(1), code]);
}

function fieldEntry(cp: Cp, access: number, name: string, desc: string): Buffer {
  const n = cp.utf8(name);
  const d = cp.utf8(desc);
  return Buffer.concat([u2(access), u2(n), u2(d), u2(0)]);
}

const ACC_PUBLIC = 0x0001;
const ACC_PRIVATE = 0x0002;
const ACC_STATIC = 0x0008;

const J_OBJ = 'java/lang/Object';
const J_MAP = 'java/util/Map';
const J_HASHMAP = 'java/util/HashMap';
const J_STRING = 'java/lang/String';
const J_FILE = 'java/io/File';
const J_FILES = 'java/nio/file/Files';
const J_CHARSETS = 'java/nio/charset/StandardCharsets';
const A_CTX = 'android/content/Context';
const A_SP = 'android/content/SharedPreferences';
const A_EDITOR = 'android/content/SharedPreferences$Editor';

const DESC_GET = '(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;';
const DESC_OBJ_OBJ = '(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;';
const DESC_PUT_STR = '(Ljava/lang/String;Ljava/lang/String;)Landroid/content/SharedPreferences$Editor;';

/** 生成 `android.content.SharedPreferences$Mem` 替换类字节 */
export function buildPrefsMemClass(): Buffer {
  const cp = new Cp();

  // ---------------- 字段 ----------------
  const fInst = cp.field(A_SP + '$Mem', 'INST', 'Ljava/util/Map;');
  const fSeed = cp.field(A_SP + '$Mem', 'SEED', 'Ljava/util/Map;');
  const fData = cp.field(A_SP + '$Mem', 'data', 'Ljava/util/Map;');

  // ---------------- 引用速记 ----------------
  const mObjInit = cp.method(J_OBJ, '<init>', '()V');
  const mMapGet = cp.imethod(J_MAP, 'get', '(Ljava/lang/Object;)Ljava/lang/Object;');
  const mMapPut = cp.imethod(J_MAP, 'put', DESC_OBJ_OBJ);
  const mMapRemove = cp.imethod(J_MAP, 'remove', '(Ljava/lang/Object;)Ljava/lang/Object;');
  const mMapClear = cp.imethod(J_MAP, 'clear', '()V');
  const mMapPutAll = cp.imethod(J_MAP, 'putAll', '(Ljava/util/Map;)V');
  const mMapContainsKey = cp.imethod(J_MAP, 'containsKey', '(Ljava/lang/Object;)Z');
  const cHashMap = cp.klass(J_HASHMAP);
  const mHashMapInit = cp.method(J_HASHMAP, '<init>', '()V');
  const cString = cp.klass(J_STRING);
  const cMap = cp.klass(J_MAP);
  const cFile = cp.klass(J_FILE);
  const mCtxGetBaseDir = cp.method(A_CTX, 'getBaseDir', '()Ljava/io/File;');
  const mFileInit = cp.method(J_FILE, '<init>', '(Ljava/io/File;Ljava/lang/String;)V');
  const mFileExists = cp.method(J_FILE, 'exists', '()Z');
  const mFileToPath = cp.method(J_FILE, 'toPath', '()Ljava/nio/file/Path;');
  const mFilesRead = cp.method(J_FILES, 'readAllBytes', '(Ljava/nio/file/Path;)[B');
  const mStrInit = cp.method(J_STRING, '<init>', '([BLjava/nio/charset/Charset;)V');
  const fUtf8 = cp.field(J_CHARSETS, 'UTF_8', 'Ljava/nio/charset/Charset;');
  const mStrSplit = cp.method(J_STRING, 'split', '(Ljava/lang/String;)[Ljava/lang/String;');
  const mStrLen = cp.method(J_STRING, 'length', '()I');
  const mIntValueOf = cp.method('java/lang/Integer', 'valueOf', '(I)Ljava/lang/Integer;');
  const mIntIntValue = cp.method('java/lang/Integer', 'intValue', '()I');
  const mBoolValueOf = cp.method('java/lang/Boolean', 'valueOf', '(Z)Ljava/lang/Boolean;');
  const mBoolBoolValue = cp.method('java/lang/Boolean', 'booleanValue', '()Z');
  const mLongValueOf = cp.method('java/lang/Long', 'valueOf', '(J)Ljava/lang/Long;');
  const mLongLongValue = cp.method('java/lang/Long', 'longValue', '()J');
  const sSeedPath = cp.str(PREFS_SEED_REL);
  const sNL = cp.str(SEP_LINE);
  const sTAB = cp.str(SEP_NAME);

  // ---------------- 方法 ----------------

  // <init>()V：data = new HashMap()
  const aInit = new Asm();
  aInit.emit(0x2a).emit(0xb7, ...u2(mObjInit)).emit(0x2a).emit(0xbb, ...u2(cHashMap)).emit(0x59).emit(0xb7, ...u2(mHashMapInit)).emit(0xb5, ...u2(fData)).emit(0xb1);
  const initAttr = codeAttr(cp, aInit, 3, 1);

  // <clinit>()V：INST = new HashMap(); SEED = new HashMap(); loadSeed()
  const aClinit = new Asm();
  aClinit.emit(0xbb, ...u2(cHashMap)).emit(0x59).emit(0xb7, ...u2(mHashMapInit)).emit(0xb3, ...u2(fInst));
  aClinit.emit(0xbb, ...u2(cHashMap)).emit(0x59).emit(0xb7, ...u2(mHashMapInit)).emit(0xb3, ...u2(fSeed));
  aClinit.emit(0xb8, ...u2(cp.method(A_SP + '$Mem', 'loadSeed', '()V'))).emit(0xb1);
  const clinitAttr = codeAttr(cp, aClinit, 2, 0);

  // loadSeed()V
  const aSeed = new Asm();
  aSeed.label('try');
  aSeed.emit(0xbb, ...u2(cFile)).emit(0x59);
  aSeed.emit(0xb8, ...u2(mCtxGetBaseDir));
  aSeed.emit(0x13, ...u2(sSeedPath));
  aSeed.emit(0xb7, ...u2(mFileInit));
  aSeed.emit(0x4b); // astore_0 = f
  aSeed.emit(0x2a).emit(0xb6, ...u2(mFileExists)).branch(0x99, 'ret'); // ifeq ret（不存在 → 退出）
  aSeed.emit(0xbb, ...u2(cString)).emit(0x59); // new String; dup（<init> 需要「未初始化的对象引用」在栈上）
  aSeed.emit(0x2a).emit(0xb6, ...u2(mFileToPath)).emit(0xb8, ...u2(mFilesRead));
  aSeed.emit(0xb2, ...u2(fUtf8));
  aSeed.emit(0xb7, ...u2(mStrInit));
  aSeed.emit(0x4c); // astore_1 = txt
  aSeed.emit(0x2b).emit(0x13, ...u2(sNL)).emit(0xb6, ...u2(mStrSplit));
  aSeed.emit(0x4d); // astore_2 = lines
  aSeed.emit(0x03).emit(0x36, 0x03); // i = 0
  aSeed.label('loop');
  aSeed.emit(0x15, 0x03).emit(0x2c).emit(0xbe).branch(0xa2, 'end'); // if (i >= lines.length) break
  aSeed.emit(0x2c).emit(0x15, 0x03).emit(0x32).emit(0x3a, 0x04); // ln = lines[i]（aaload: 先数组后下标）
  aSeed.emit(0x19, 0x04).emit(0xb6, ...u2(mStrLen)).branch(0x99, 'next'); // 空行跳过
  aSeed.emit(0x19, 0x04).emit(0x13, ...u2(sTAB)).emit(0xb6, ...u2(mStrSplit)).emit(0x3a, 0x05); // parts
  aSeed.emit(0x19, 0x05).emit(0xbe).emit(0x06).branch(0xa1, 'next'); // parts.length < 3 → 跳过
  aSeed.emit(0xb2, ...u2(fSeed)).emit(0x19, 0x05).emit(0x03).emit(0x32).emit(0xb9, ...u2(mMapGet), 0x02, 0x00).emit(0x3a, 0x06);
  aSeed.emit(0x19, 0x06).branch(0xc7, 'has'); // 已有 → 直接用
  aSeed.emit(0xbb, ...u2(cHashMap)).emit(0x59).emit(0xb7, ...u2(mHashMapInit)).emit(0x3a, 0x06);
  aSeed.emit(0xb2, ...u2(fSeed)).emit(0x19, 0x05).emit(0x03).emit(0x32).emit(0x19, 0x06).emit(0xb9, ...u2(mMapPut), 0x03, 0x00).emit(0x57);
  aSeed.label('has');
  aSeed.emit(0x19, 0x06).emit(0xc0, ...u2(cMap));
  aSeed.emit(0x19, 0x05).emit(0x04).emit(0x32);
  aSeed.emit(0x19, 0x05).emit(0x05).emit(0x32);
  aSeed.emit(0xb9, ...u2(mMapPut), 0x03, 0x00).emit(0x57);
  aSeed.label('next');
  aSeed.emit(0x84, 0x03, 0x01).branch(0xa7, 'loop');
  aSeed.label('end');
  aSeed.label('ret');
  aSeed.emit(0xb1);
  aSeed.label('tryEnd');
  aSeed.label('handler');
  aSeed.emit(0x3a, 0x07).emit(0xb1);
  const seedAttr = codeAttr(cp, aSeed, 4, 8, [['try', 'tryEnd', 'handler', 'java/lang/Throwable']]);

  // get(String)Mem
  cp.method(A_SP + '$Mem', 'get', '(Ljava/lang/String;)Landroid/content/SharedPreferences$Mem;');
  const cSelf = cp.klass(A_SP + '$Mem');
  const aGet = new Asm();
  aGet.emit(0xb2, ...u2(fInst)).emit(0x2a).emit(0xb9, ...u2(mMapGet), 0x02, 0x00).emit(0x4c); // o = INST.get(name)
  aGet.emit(0x2b).branch(0xc6, 'miss');
  aGet.emit(0x2b).emit(0xc0, ...u2(cSelf)).emit(0x4d).branch(0xa7, 'done');
  aGet.label('miss');
  aGet.emit(0xbb, ...u2(cSelf)).emit(0x59).emit(0xb7, ...u2(cp.method(A_SP + '$Mem', '<init>', '()V'))).emit(0x4d); // m = new Mem()
  aGet.emit(0xb2, ...u2(fSeed)).emit(0x2a).emit(0xb9, ...u2(mMapGet), 0x02, 0x00).emit(0x4e); // s = SEED.get(name)
  aGet.emit(0x2d).branch(0xc6, 'noSeed');
  aGet.emit(0x2c).emit(0xb4, ...u2(fData)).emit(0x2d).emit(0xc0, ...u2(cMap)).emit(0xb9, ...u2(mMapPutAll), 0x02, 0x00);
  aGet.label('noSeed');
  aGet.emit(0xb2, ...u2(fInst)).emit(0x2a).emit(0x2c).emit(0xb9, ...u2(mMapPut), 0x03, 0x00).emit(0x57);
  aGet.label('done');
  aGet.emit(0x2c).emit(0xb0);
  const getAttr = codeAttr(cp, aGet, 3, 4);

  // 简单读取器：v = data.get(k)；命中且类型匹配 → 转换返回，否则返回默认
  const simpleGetter = (typeCls: string, convRef: number, retOp: number, defOp: number, longish = false): Buffer => {
    const vIdx = longish ? 4 : 3;
    const a = new Asm();
    a.emit(0x2a).emit(0xb4, ...u2(fData)).emit(0x2b).emit(0xb9, ...u2(mMapGet), 0x02, 0x00).emit(0x3a, vIdx);
    a.emit(0x19, vIdx).emit(0xc1, ...u2(cp.klass(typeCls))).branch(0x99, 'def');
    a.emit(0x19, vIdx).emit(0xc0, ...u2(cp.klass(typeCls))).emit(0xb6, ...u2(convRef));
    a.emit(retOp);
    a.label('def');
    a.emit(defOp);
    a.emit(retOp);
    return codeAttr(cp, a, 2, longish ? 5 : 4);
  };

  // getString
  const aGStr = new Asm();
  aGStr.emit(0x2a).emit(0xb4, ...u2(fData)).emit(0x2b).emit(0xb9, ...u2(mMapGet), 0x02, 0x00).emit(0x4e);
  aGStr.emit(0x2d).branch(0xc6, 'def');
  aGStr.emit(0x2d).emit(0xc1, ...u2(cString)).branch(0x99, 'def');
  aGStr.emit(0x2d).emit(0xc0, ...u2(cString)).emit(0xb0);
  aGStr.label('def');
  aGStr.emit(0x2c).emit(0xb0);
  const gstrAttr = codeAttr(cp, aGStr, 2, 4);

  // getInt / getBoolean / getLong（默认值：int/bool 在 local 2，long 在 local 2-3）
  const gIntAttr = simpleGetter('java/lang/Integer', mIntIntValue, 0xac, 0x1c);
  const gBoolAttr = simpleGetter('java/lang/Boolean', mBoolBoolValue, 0xac, 0x1c);
  const gLongAttr = simpleGetter('java/lang/Long', mLongLongValue, 0xad, 0x20, true);

  // getAll()Map
  const aGetAll = new Asm();
  aGetAll.emit(0x2a).emit(0xb4, ...u2(fData)).emit(0xb0);
  const getAllAttr = codeAttr(cp, aGetAll, 1, 1);

  // contains(String)Z
  const aHas = new Asm();
  aHas.emit(0x2a).emit(0xb4, ...u2(fData)).emit(0x2b).emit(0xb9, ...u2(mMapContainsKey), 0x02, 0x00).emit(0xac);
  const hasAttr = codeAttr(cp, aHas, 2, 2);

  // edit()Editor → this
  const aEdit = new Asm();
  aEdit.emit(0x2a).emit(0xb0);
  const editAttr = codeAttr(cp, aEdit, 1, 1);

  // Editor 写操作：data.put(...)；返回 this
  const putAttr = (box: { valueOp: number; valueIdx: number; boxRef: number } | null, maxStack = 3, maxLocals = 3): Buffer => {
    const a = new Asm();
    a.emit(0x2a).emit(0xb4, ...u2(fData)).emit(0x2b);
    if (box) {
      a.emit(box.valueOp, box.valueIdx);
      a.emit(0xb8, ...u2(box.boxRef));
    } else {
      a.emit(0x2c);
    }
    a.emit(0xb9, ...u2(mMapPut), 0x03, 0x00).emit(0x57);
    a.emit(0x2a).emit(0xb0);
    return codeAttr(cp, a, maxStack, maxLocals);
  };
  const putStrAttr = putAttr(null);
  const putIntAttr = putAttr({ valueOp: 0x15, valueIdx: 2, boxRef: mIntValueOf });
  const putBoolAttr = putAttr({ valueOp: 0x15, valueIdx: 2, boxRef: mBoolValueOf });
  const putLongAttr = putAttr({ valueOp: 0x16, valueIdx: 2, boxRef: mLongValueOf }, 4, 4);

  // remove(String)Editor
  const aRem = new Asm();
  aRem.emit(0x2a).emit(0xb4, ...u2(fData)).emit(0x2b).emit(0xb9, ...u2(mMapRemove), 0x02, 0x00).emit(0x57).emit(0x2a).emit(0xb0);
  const remAttr = codeAttr(cp, aRem, 2, 2);

  // clear()Editor
  const aClr = new Asm();
  aClr.emit(0x2a).emit(0xb4, ...u2(fData)).emit(0xb9, ...u2(mMapClear), 0x01, 0x00).emit(0x2a).emit(0xb0);
  const clrAttr = codeAttr(cp, aClr, 1, 1);

  // commit()Z → true；apply()V → no-op
  const aCommit = new Asm();
  aCommit.emit(0x04).emit(0xac);
  const commitAttr = codeAttr(cp, aCommit, 1, 1);
  const aApply = new Asm();
  aApply.emit(0xb1);
  const applyAttr = codeAttr(cp, aApply, 0, 1);

  const methods: Buffer[] = [
    method(cp, ACC_PUBLIC, '<init>', '()V', initAttr),
    method(cp, ACC_STATIC, '<clinit>', '()V', clinitAttr),
    method(cp, ACC_PRIVATE | ACC_STATIC, 'loadSeed', '()V', seedAttr),
    method(cp, ACC_PUBLIC | ACC_STATIC, 'get', '(Ljava/lang/String;)Landroid/content/SharedPreferences$Mem;', getAttr),
    method(cp, ACC_PUBLIC, 'getString', DESC_GET, gstrAttr),
    method(cp, ACC_PUBLIC, 'getInt', '(Ljava/lang/String;I)I', gIntAttr),
    method(cp, ACC_PUBLIC, 'getBoolean', '(Ljava/lang/String;Z)Z', gBoolAttr),
    method(cp, ACC_PUBLIC, 'getLong', '(Ljava/lang/String;J)J', gLongAttr),
    method(cp, ACC_PUBLIC, 'getAll', '()Ljava/util/Map;', getAllAttr),
    method(cp, ACC_PUBLIC, 'contains', '(Ljava/lang/String;)Z', hasAttr),
    method(cp, ACC_PUBLIC, 'edit', '()Landroid/content/SharedPreferences$Editor;', editAttr),
    method(cp, ACC_PUBLIC, 'putString', DESC_PUT_STR, putStrAttr),
    method(cp, ACC_PUBLIC, 'putInt', '(Ljava/lang/String;I)Landroid/content/SharedPreferences$Editor;', putIntAttr),
    method(cp, ACC_PUBLIC, 'putBoolean', '(Ljava/lang/String;Z)Landroid/content/SharedPreferences$Editor;', putBoolAttr),
    method(cp, ACC_PUBLIC, 'putLong', '(Ljava/lang/String;J)Landroid/content/SharedPreferences$Editor;', putLongAttr),
    method(cp, ACC_PUBLIC, 'remove', '(Ljava/lang/String;)Landroid/content/SharedPreferences$Editor;', remAttr),
    method(cp, ACC_PUBLIC, 'clear', '()Landroid/content/SharedPreferences$Editor;', clrAttr),
    method(cp, ACC_PUBLIC, 'commit', '()Z', commitAttr),
    method(cp, ACC_PUBLIC, 'apply', '()V', applyAttr),
  ];

  const iThis = cp.klass(A_SP + '$Mem');
  const iObj = cp.klass(J_OBJ);
  const iSp = cp.klass(A_SP);
  const iEditor = cp.klass(A_EDITOR);

  return Buffer.concat([
    Buffer.from([0xca, 0xfe, 0xba, 0xbe]),
    u2(0),
    u2(49),
    u2(cp.count),
    cp.serialize(),
    u2(0x0021),
    u2(iThis),
    u2(iObj),
    u2(2),
    u2(iSp),
    u2(iEditor),
    u2(3),
    fieldEntry(cp, ACC_PRIVATE | ACC_STATIC, 'INST', 'Ljava/util/Map;'),
    fieldEntry(cp, ACC_PRIVATE | ACC_STATIC, 'SEED', 'Ljava/util/Map;'),
    fieldEntry(cp, ACC_PRIVATE, 'data', 'Ljava/util/Map;'),
    u2(methods.length),
    ...methods,
    u2(0),
  ]);
}

/** 打包成影子 jar（单条目） */
export function buildPrefsShimJar(): Buffer {
  const entries: ZipEntryData[] = [{ name: PREFS_MEM_CLASS + '.class', bytes: buildPrefsMemClass() }];
  return buildZip(entries, { deflate: true });
}

// ---------------------------------------------------------------------------
// 自检探针类（仅测试/取证用；同样免 javac）：跑真 JVM 验证「种子 → SharedPreferences」生效。
// main(String[]) 步骤：
//   Context.setBaseDir(new File(System.getProperty("tvbox.spiderCacheDir")))
//   sp = SharedPreferences.Mem.get("NewWexFnw_preferences")
//   System.out.println("PROBE=".concat(sp.getString("Wex_baidu_cookie", "(none)")))
// ---------------------------------------------------------------------------
export function buildPrefsProbeClass(prefsName = WEX_PREFS_NAME, key = 'Wex_baidu_cookie'): Buffer {
  const cp = new Cp();
  const C_PROBE = 'com/winbox/PrefsProbe';
  const cFile = cp.klass(J_FILE);
  const mFileInit = cp.method(J_FILE, '<init>', '(Ljava/lang/String;)V');
  const mSysGetProp = cp.method('java/lang/System', 'getProperty', '(Ljava/lang/String;)Ljava/lang/String;');
  const fSysOut = cp.field('java/lang/System', 'out', 'Ljava/io/PrintStream;');
  const mCtxSetBase = cp.method(A_CTX, 'setBaseDir', '(Ljava/io/File;)V');
  const mGet = cp.method(A_SP + '$Mem', 'get', '(Ljava/lang/String;)Landroid/content/SharedPreferences$Mem;');
  const mGetStr = cp.imethod(A_SP, 'getString', DESC_GET);
  const mConcat = cp.method(J_STRING, 'concat', '(Ljava/lang/String;)Ljava/lang/String;');
  const mPrintln = cp.method('java/io/PrintStream', 'println', '(Ljava/lang/String;)V');

  const a = new Asm();
  a.emit(0xbb, ...u2(cFile)).emit(0x59).emit(0x13, ...u2(cp.str('tvbox.spiderCacheDir'))).emit(0xb8, ...u2(mSysGetProp)).emit(0xb7, ...u2(mFileInit));
  a.emit(0xb8, ...u2(mCtxSetBase));
  a.emit(0x13, ...u2(cp.str(prefsName))).emit(0xb8, ...u2(mGet)).emit(0x4c);
  a.emit(0xb2, ...u2(fSysOut));
  a.emit(0x13, ...u2(cp.str('PROBE=')));
  a.emit(0x2b);
  a.emit(0x13, ...u2(cp.str(key)));
  a.emit(0x13, ...u2(cp.str('(none)')));
  a.emit(0xb9, ...u2(mGetStr), 0x03, 0x00);
  a.emit(0xb6, ...u2(mConcat));
  a.emit(0xb6, ...u2(mPrintln));
  a.emit(0xb1);
  const mainAttr = codeAttr(cp, a, 6, 2);
  const iThis = cp.klass(C_PROBE);
  const iObj = cp.klass(J_OBJ);
  // ★ 必须先建好方法（它会往常量池里加 name/desc 项），再取 count / 序列化常量池。
  const methods: Buffer[] = [method(cp, ACC_PUBLIC | ACC_STATIC, 'main', '([Ljava/lang/String;)V', mainAttr)];

  return Buffer.concat([
    Buffer.from([0xca, 0xfe, 0xba, 0xbe]),
    u2(0),
    u2(49),
    u2(cp.count),
    cp.serialize(),
    u2(0x0021),
    u2(iThis),
    u2(iObj),
    u2(0),
    u2(0),
    u2(methods.length),
    ...methods,
    u2(0),
  ]);
}

/** 探针类在 jar 内的条目名 */
export const PREFS_PROBE_CLASS = 'com/winbox/PrefsProbe';
