// tests/okhttp4Compat.spec.ts — 给 `okhttp3/RequestBody` 追加 okhttp 4.x 参数序的 `create` 重载。
// 实测来源：用户日志 `app-2026-10-14.log` 的
//   `NoSuchMethodError: 'okhttp3.RequestBody okhttp3.RequestBody.create(java.lang.String, okhttp3.MediaType)'`
//   调用者 = wex 订阅运行时解出的载荷（`com.github.catvod.spider.SoAiPanSoo`，落在 Java 侧 runtime-dex 产物里，
//   Node 端改写 jar 够不到）⇒ 采用「给宿主类补方法 + 兼容 jar 排 -cp 最前」的普适路线。
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseClassBytes } from '../src/engine/spider/classFix';
import {
  addOkHttp4OverloadsToRequestBody,
  buildOkHttp4CompatJar,
  OKHTTP4_CREATE_DELEGATES,
  OKHTTP_REQUEST_BODY,
  OKHTTP_UPSTREAM_JAR,
  OKHTTP4_COMPAT_JAR,
} from '../src/engine/spider/okhttp4Compat';
import { readZipEntries } from '../src/engine/util/syncZip';

const UPSTREAM = join('resources/jvm/libs', OKHTTP_UPSTREAM_JAR);
const COMPAT_JAR = join('resources/jvm/okhttp4-compat', OKHTTP4_COMPAT_JAR);
const hasUpstream = existsSync(UPSTREAM);
const hasCompatJar = existsSync(COMPAT_JAR);
const sigs = (cls: Buffer): string[] => parseClassBytes(cls).methods.map((m) => `${m.name}${m.desc}`);

/** 枚举常量池里所有 `Methodref` 的 (owner, name, desc) —— 用来核对委托目标 */
function methodRefs(cls: Buffer): Array<{ owner: string; name: string; desc: string }> {
  const info = parseClassBytes(cls);
  const out: Array<{ owner: string; name: string; desc: string }> = [];
  for (let i = 1; i < info.cp.length; i++) {
    const e = info.cp[i];
    if (!e || e.tag !== 10) continue;
    const c = info.cp[e.a as number];
    const nat = info.cp[e.b as number];
    if (!c || c.tag !== 7 || !nat || nat.tag !== 12) continue;
    out.push({
      owner: (info.cp[c.a as number] as { s?: string })?.s ?? '',
      name: (info.cp[nat.a as number] as { s?: string })?.s ?? '',
      desc: (info.cp[nat.b as number] as { s?: string })?.s ?? '',
    });
  }
  return out;
}

const realRequestBody = (): Buffer | null => {
  if (!existsSync(UPSTREAM)) return null; // 产物缺失则跳过（仓库里该 jar 随包存在）
  const e = readZipEntries(readFileSync(UPSTREAM)).find((x) => x.name === `${OKHTTP_REQUEST_BODY}.class`);
  return e ? e.bytes : null;
};

describe('okhttp4Compat — 给 RequestBody 追加 4.x 重载', () => {
  it.skipIf(!hasUpstream)('上游 okhttp3/RequestBody 追加 4 个 4.x 重载；原方法一个不少、可重新解析', () => {
    const cls = realRequestBody();
    if (!cls) throw new Error(`upstream resource unexpectedly absent: ${UPSTREAM}`);
    const before = sigs(cls);
    const out = addOkHttp4OverloadsToRequestBody(cls);
    expect(out).not.toBeNull();
    const after = sigs(out as Buffer);
    // 原方法全部保留
    for (const s of before) expect(after).toContain(s);
    // 4 个 4.x 重载都在
    for (const [callerDesc] of OKHTTP4_CREATE_DELEGATES) expect(after).toContain(`create${callerDesc}`);
    expect(after.length).toBe(before.length + 4);
    // 每个新增重载的 invokestatic 都指向同类里已存在的 3.x 参数序方法
    for (const [, targetDesc] of OKHTTP4_CREATE_DELEGATES) expect(before).toContain(`create${targetDesc}`);
    const refs = methodRefs(out as Buffer).filter((r) => r.owner === OKHTTP_REQUEST_BODY && r.name === 'create');
    for (const [, targetDesc] of OKHTTP4_CREATE_DELEGATES) expect(refs.some((r) => r.desc === targetDesc)).toBe(true);
    // 类文件头未被改坏（Java 5 ⇒ 新方法无分支、缺 StackMapTable 也合法）
    expect((out as Buffer).readUInt16BE(6)).toBe(cls.readUInt16BE(6));
    expect(parseClassBytes(out as Buffer).name).toBe(OKHTTP_REQUEST_BODY);
  });

  it.skipIf(!hasUpstream)('幂等：再补一次不再改动；非目标类不动', () => {
    const cls = realRequestBody();
    if (!cls) throw new Error(`upstream resource unexpectedly absent: ${UPSTREAM}`);
    const once = addOkHttp4OverloadsToRequestBody(cls) as Buffer;
    expect(addOkHttp4OverloadsToRequestBody(once)).toBeNull();
    expect(addOkHttp4OverloadsToRequestBody(cls.subarray(0, 8))).toBeNull(); // 非类文件
  });

  it.skipIf(!hasUpstream)('由上游 jar 生成兼容 jar：单条目、含 4 个新重载', () => {
    const r = buildOkHttp4CompatJar(readFileSync(UPSTREAM));
    expect(r.bytes).not.toBeNull();
    expect(r.added).toBe(4);
    const entries = readZipEntries(r.bytes as Buffer);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe(`${OKHTTP_REQUEST_BODY}.class`);
    const after = sigs(entries[0].bytes);
    for (const [callerDesc] of OKHTTP4_CREATE_DELEGATES) expect(after).toContain(`create${callerDesc}`);
  });

  it.skipIf(!hasCompatJar)('入库的兼容 jar 存在且内容正确（防止漏跑 scripts/gen-okhttp-compat.mjs）', () => {
    const entries = readZipEntries(readFileSync(COMPAT_JAR));
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe(`${OKHTTP_REQUEST_BODY}.class`);
    const after = sigs(entries[0].bytes);
    for (const [callerDesc] of OKHTTP4_CREATE_DELEGATES) expect(after).toContain(`create${callerDesc}`);
    for (const [, targetDesc] of OKHTTP4_CREATE_DELEGATES) expect(after).toContain(`create${targetDesc}`);
  });
});
