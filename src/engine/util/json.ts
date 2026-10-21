// src/engine/util/json.ts
// 对齐上游 com.github.tvbox.osc.util.DefaultConfig 的 safe 取值语义。
// 关键：缺失/异常一律返回默认值，绝不抛；safeJsonString 对 对象/数组 返回 toString().trim()。

/** 剥离 JSON 文本中的 // 行注释与 / * * / 块注释（字符串感知）。
 * 必要扩展：真实线上配置（如 19.json、X.json）在 sites 数组内部夹 // 注释，
 * 严格 JSON.parse 必挂；安卓端用 lenient Gson 等价处理。https:// 协议串内的 // 在字符串内，保留。 */
export function stripJsonComments(input: string): string {
  let out = '';
  let i = 0;
  const n = input.length;
  let inString = false;
  let escape = false;
  while (i < n) {
    const c = input[i];
    const next = input[i + 1];
    if (inString) {
      out += c;
      if (escape) {
        escape = false;
      } else if (c === '\\') {
        escape = true;
      } else if (c === '"') {
        inString = false;
      }
      i++;
      continue;
    }
    // 不在字符串内
    if (c === '"') {
      inString = true;
      out += c;
      i++;
      continue;
    }
    if (c === '/' && next === '/') {
      // 行注释：跳到行尾
      while (i < n && input[i] !== '\n' && input[i] !== '\r') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      // 块注释：跳到 */
      i += 2;
      while (i < n && !(input[i] === '*' && input[i + 1] === '/')) i++;
      i += 2; // 跳过结束符（越界则到末尾）
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * 去掉对象/数组里的**尾随逗号**（`[1,2,]` / `{"a":1,}`）——字符串感知。
 *
 * ★ 2026-09-28（通解）：安卓 org.json 的 JSONTokener **宽容尾随逗号**（读到 `]`/`}`
 *   前若只有逗号即当作结束），而 JS 的 JSON.parse 一律拒绝 ⇒ 同一份订阅安卓能导入、
 *   桌面报「配置不是合法 JSON 对象」。实测订阅 `https://700sjro44343.vicp.fun/eggp/0211/tv.json`：
 *   剥注释后仍挂在 `\"\",\n      ],` 两处尾随逗号上，去掉即解析成功。
 */
export function stripTrailingCommas(input: string): string {
  let out = '';
  let inString = false;
  let escape = false;
  let pendingComma = -1; // 已写入 out 的「可能是尾随逗号」的下标（其后只有空白才算）
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (inString) {
      out += c;
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      pendingComma = -1;
      out += c;
      continue;
    }
    if (c === ',') {
      pendingComma = out.length;
      out += c;
      continue;
    }
    if (c === ']' || c === '}') {
      if (pendingComma >= 0) out = out.slice(0, pendingComma) + out.slice(pendingComma + 1);
      pendingComma = -1;
      out += c;
      continue;
    }
    // 逗号与结束符之间只允许空白；其它字符一出现即说明该逗号是正常分隔符
    if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') pendingComma = -1;
    out += c;
  }
  return out;
}

/**
 * 给**未加引号 / 引号错位**的对象键名补正引号（字符串感知）。
 *
 * ★ 2026-10-14（用户报「肥猫订阅导入失败」）：实测 `http://肥猫.net/tv` 的站源写成
 *   JS 对象字面量风格，两种键名缺陷并存：
 *     ① 裸键名：`"api": "csp_AppDrama",\n ext: { … }`；
 *     ② **引号错位**：`"api": "csp_AppDrama",\n ext": { … }`（只有**后引号**、没有前引号，
 *        position 2795 / line 124 就是它）。
 *   两者 JSON.parse 都必拒（`Expected double-quoted property name`），安卓 org.json 能容忍。
 *
 * 只在「上一个非空白字符是 `{` 或 `,`」（= 正在期望一个键）时处理，且标识符后**必须**紧跟
 * `:`（或先有一个多余后引号再跟 `:`）：`true/false/null/数字` 这类**值**后面永远不是冒号
 * ⇒ 值不会被误改；字符串内部整体跳过。仅在严格解析 + 去尾随逗号都失败后作为**最后兜底**。
 */
export function quoteUnquotedKeys(input: string): string {
  const ID_START = /[A-Za-z_$\u4e00-\u9fa5]/;
  const ID_PART = /[A-Za-z0-9_$\u4e00-\u9fa5-]/;
  const WS = /[ \t\n\r]/;
  let out = '';
  let i = 0;
  const n = input.length;
  let inString = false;
  let escape = false;
  let expectKey = false; // 上一个有效字符是 `{` 或 `,`
  while (i < n) {
    const c = input[i];
    if (inString) {
      out += c;
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') inString = false;
      i++;
      continue;
    }
    if (c === '"') { inString = true; expectKey = false; out += c; i++; continue; }
    if (c === '{' || c === ',') { expectKey = true; out += c; i++; continue; }
    if (WS.test(c)) { out += c; i++; continue; } // 空白不影响 expectKey
    if (expectKey && ID_START.test(c)) {
      let j = i;
      while (j < n && ID_PART.test(input[j])) j++;
      let k = j;
      while (k < n && WS.test(input[k])) k++;
      let end = k; // 消费到的位置（下一轮从此继续）
      let hit = false;
      if (input[k] === ':') {
        hit = true; // ① 裸键名
      } else if (input[k] === '"') {
        // ② 引号错位：标识符 + 多余后引号 + 冒号（实测肥猫 `ext": {`）→ 归一为 "ident"
        let m = k + 1;
        while (m < n && WS.test(input[m])) m++;
        if (input[m] === ':') { hit = true; end = m; }
      }
      if (hit) {
        out += '"' + input.slice(i, j) + '"';
        i = end;
        expectKey = false;
        continue;
      }
    }
    expectKey = false;
    out += c;
    i++;
  }
  return out;
}

/**
 * Convert JSON5-style single-quoted strings to JSON strings.
 * This only runs as a last parser fallback. Comments and existing double-quoted
 * strings are copied unchanged, so URLs and apostrophes in valid JSON are safe.
 */
export function quoteSingleQuotedStrings(input: string): string {
  let out = '';
  let inDoubleString = false;
  let doubleStringEscape = false;
  let changed = false;

  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    const next = input[i + 1];

    if (inDoubleString) {
      out += c;
      if (doubleStringEscape) doubleStringEscape = false;
      else if (c === '\\') doubleStringEscape = true;
      else if (c === '"') inDoubleString = false;
      continue;
    }

    if (c === '"') {
      inDoubleString = true;
      out += c;
      continue;
    }

    if (c === '/' && next === '/') {
      let end = i + 2;
      while (end < input.length && input[end] !== '\n' && input[end] !== '\r') end++;
      if (end === input.length) {
        out += input.slice(i);
        break;
      }
      out += input.slice(i, end);
      i = end - 1;
      continue;
    }

    if (c === '/' && next === '*') {
      const end = input.indexOf('*/', i + 2);
      if (end < 0) {
        out += input.slice(i);
        break;
      }
      out += input.slice(i, end + 2);
      i = end + 1;
      continue;
    }

    if (c !== "'") {
      out += c;
      continue;
    }

    changed = true;
    out += '"';
    let closed = false;
    for (i++; i < input.length; i++) {
      const value = input[i];
      if (value === "'") {
        out += '"';
        closed = true;
        break;
      }
      if (value === '\n' || value === '\r') return input;
      if (value === '"') {
        out += '\\"';
        continue;
      }
      if (value !== '\\') {
        out += value;
        continue;
      }

      const escaped = input[i + 1];
      if (escaped == null) return input;
      if (escaped === "'") {
        out += "'";
        i++;
        continue;
      }
      if (escaped === '"') {
        out += '\\"';
        i++;
        continue;
      }
      if (escaped === '\\') {
        out += '\\\\';
        i++;
        continue;
      }
      if (escaped === 'u') {
        const hex = input.slice(i + 2, i + 6);
        if (!/^[\da-f]{4}$/i.test(hex)) return input;
        out += `\\u${hex}`;
        i += 5;
        continue;
      }
      if (escaped === 'x') {
        const hex = input.slice(i + 2, i + 4);
        if (!/^[\da-f]{2}$/i.test(hex)) return input;
        out += JSON.stringify(String.fromCharCode(Number.parseInt(hex, 16))).slice(1, -1);
        i += 3;
        continue;
      }
      if (escaped === 'v') {
        out += '\\u000b';
        i++;
        continue;
      }
      if (escaped === '0') {
        if (/\d/.test(input[i + 2] || '')) return input;
        out += '\\u0000';
        i++;
        continue;
      }
      if ('bfnrt/'.includes(escaped)) {
        out += `\\${escaped}`;
        i++;
        continue;
      }
      if (escaped === '\n') {
        i++;
        continue;
      }
      if (escaped === '\r') {
        i++;
        if (input[i + 1] === '\n') i++;
        continue;
      }

      // JSON5 identity escapes discard the backslash before other characters.
      out += escaped;
      i++;
    }
    if (!closed) return input;
  }

  return changed ? out : input;
}

/** Escape literal control characters inside strings without changing their value. */
function escapeJsonStringControls(input: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        // JSON5 permits a backslash followed by a physical line break.
        if (c === '\n' || c === '\r') {
          out = out.slice(0, -1);
          if (c === '\r' && input[i + 1] === '\n') i++;
          continue;
        }
      }
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      else if (c.charCodeAt(0) < 0x20) {
        out += JSON.stringify(c).slice(1, -1);
        continue;
      }
    } else if (c === '"') {
      inString = true;
    }
    out += c;
  }
  return out;
}

/** Recover orphan quotes in literal values, without evaluating expressions. */
function repairScalarQuotes(input: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    out += c;
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === ':' || c === '[' || c === ',') {
      const scalar = /^(\s*(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null))"(?=\s*[,}\]])/.exec(input.slice(i + 1));
      if (scalar) { out += scalar[1]; i += scalar[0].length; }
      else {
        // Some published category arrays contain 日韩剧" instead of "日韩剧".
        // Only accept a plain word followed by a closing quote and delimiter.
        const word = /^(\s*)([\p{L}_][\p{L}\p{N}_-]*)"(?=\s*[,}\]])/u.exec(input.slice(i + 1));
        if (word) { out += word[1] + JSON.stringify(word[2]); i += word[0].length; }
      }
    }
  }
  return out;
}

/**
 * 解析订阅/配置 JSON 的**统一宽容入口**（对齐安卓 org.json 的容忍度）：
 * ① 剥 `//` 与块注释（字符串感知，见 stripJsonComments）→ 严格 `JSON.parse`（绝大多数走这条）；
 * ② 失败 → 去尾随逗号再 parse（见 stripTrailingCommas）；
 * ③ 仍失败 → 补正键名（裸键名 / 引号错位，见 quoteUnquotedKeys）再 parse；
 * ④ 仍失败 → **先补键名再剥注释**（顺序很关键：实测肥猫的引号错位 `ext"` 会让
 *    `stripJsonComments` 的字符串状态错位 —— 它会把字符串里的 `https://…` 误当行注释吃掉，
 *    补键名后字符串状态恢复正确，注释剥离才不会误伤 URL）→ 去尾随逗号 → parse；
 * ⑤ 单引号转换和字符串内控制字符转义后再尝试；不执行输入中的代码。
 * ⑥ 仍失败则抛**第一次**的错误（保持既有报错文案与位置，不掩盖真实语法错误）。
 */
export function parseJsonLenient(text: string): unknown {
  const cleaned = stripJsonComments(text);
  try {
    return JSON.parse(cleaned);
  } catch (first) {
    const noTrail = stripTrailingCommas(cleaned);
    if (noTrail !== cleaned) {
      try {
        return JSON.parse(noTrail);
      } catch {
        /* 继续尝试键名修复 */
      }
    }
    const quoted = quoteUnquotedKeys(noTrail);
    if (quoted !== noTrail) {
      try {
        return JSON.parse(quoted);
      } catch {
        /* 继续尝试「先补键名再剥注释」 */
      }
    }
    const repaired = quoteUnquotedKeys(repairScalarQuotes(quoteSingleQuotedStrings(text)));
    const reordered = escapeJsonStringControls(stripTrailingCommas(quoteUnquotedKeys(stripJsonComments(repaired))));
    if (reordered !== cleaned) {
      try {
        return JSON.parse(reordered);
      } catch {
        /* 落回原始错误 */
      }
    }
    throw first;
  }
}

/** 等价 DefaultConfig.safeJsonString(obj, key, default) */
export function safeJsonString(
  obj: unknown,
  key: string,
  defaultVal: string,
): string {
  try {
    if (obj == null || typeof obj !== 'object') return defaultVal;
    const v = (obj as Record<string, unknown>)[key];
    if (v === undefined) return defaultVal;
    // 对象/数组 → JSON.stringify 再 trim；与 Gson getAsString 对 object 抛不同，
    // 这里采用 toString 语义以匹配 DefaultConfig 第 151 行 obj.get(key).toString().trim()
    if (v !== null && typeof v === 'object') {
      return JSON.stringify(v).trim();
    }
    const s = String(v);
    // getAsPrimitive().getAsString() 对数字/布尔也返回字面量
    return s.trim();
  } catch {
    return defaultVal;
  }
}

/** 等价 DefaultConfig.safeJsonInt(obj, key, default) */
export function safeJsonInt(
  obj: unknown,
  key: string,
  defaultVal: number,
): number {
  try {
    if (obj == null || typeof obj !== 'object') return defaultVal;
    const v = (obj as Record<string, unknown>)[key];
    if (v === undefined) return defaultVal;
    // getAsJsonPrimitive().getAsInt()
    if (typeof v === 'number') return Math.trunc(v) || 0;
    if (typeof v === 'string') {
      const n = parseInt(v, 10);
      return Number.isNaN(n) ? defaultVal : n;
    }
    if (typeof v === 'boolean') return v ? 1 : 0;
    return defaultVal;
  } catch {
    return defaultVal;
  }
}

/** 等价 DefaultConfig.safeJsonStringList(obj, key) —— 永不返回 null */
export function safeJsonStringList(obj: unknown, key: string): string[] {
  const result: string[] = [];
  try {
    if (obj == null || typeof obj !== 'object') return result;
    const v = (obj as Record<string, unknown>)[key];
    if (v === undefined) return result;
    // isJsonObject() → add getAsString（罕见分支）
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      // 对象：Gson 走 getAsString() 会抛 → 这里按 catch 返回空更安全
      return result;
    }
    if (Array.isArray(v)) {
      for (const e of v) {
        if (typeof e === 'string') result.push(e);
        else if (typeof e === 'number' || typeof e === 'boolean') result.push(String(e));
        // 其它忽略
      }
    }
  } catch {
    // swallow
  }
  return result;
}
