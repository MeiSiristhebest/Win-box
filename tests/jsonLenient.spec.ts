// 订阅 JSON「宽容解析」回归测试（对齐安卓 org.json 的容忍度）。
//
// 背景（2026-09-28 用户点名三订阅验证时发现）：真实线上订阅会写注释、尾随逗号，
// 安卓 org.json 的 JSONTokener 都能容忍，而 JS 的 JSON.parse 一律拒绝
// —— 同一份订阅安卓能导入、桌面报「配置不是合法 JSON 对象」。
// 实测：https://700sjro44343.vicp.fun/eggp/0211/tv.json 剥注释后仍挂在 `"",\n ],` 上。
import { describe, it, expect } from 'vitest';
import { parseJsonLenient, stripTrailingCommas, stripJsonComments, quoteUnquotedKeys, quoteSingleQuotedStrings } from '../src/engine/util/json';

describe('stripTrailingCommas', () => {
  it('数组/对象尾随逗号被去掉（含空白与换行）', () => {
    expect(stripTrailingCommas('[1,2,]')).toBe('[1,2]');
    expect(stripTrailingCommas('{"a":1,}')).toBe('{"a":1}');
    expect(stripTrailingCommas('{"a":["x",\n  ],\n  "b":1\n}')).toBe('{"a":["x"\n  ],\n  "b":1\n}');
  });

  it('正常分隔逗号不受影响', () => {
    expect(stripTrailingCommas('[1,2,3]')).toBe('[1,2,3]');
    expect(stripTrailingCommas('{"a":1,"b":[2,3]}')).toBe('{"a":1,"b":[2,3]}');
  });

  it('字符串内的逗号与括号不误伤（字符串感知）', () => {
    const s = '{"url":"http://a.com/x,]y","n":"逗号,也在串里"}';
    expect(stripTrailingCommas(s)).toBe(s);
  });
});

describe('parseJsonLenient', () => {
  it('严格合法 JSON 原样解析（绝大多数配置走这条）', () => {
    expect(parseJsonLenient('{"sites":[]}')).toEqual({ sites: [] });
  });

  it('注释 + 尾随逗号同时存在 → 解析成功（实测订阅形态）', () => {
    const text = '{\n  "sites": [ {"key":"a","api":"csp_A"} ],\n  //moyu\n  "spider": "http://x/j.jar",\n}';
    expect(parseJsonLenient(text)).toEqual({ sites: [{ key: 'a', api: 'csp_A' }], spider: 'http://x/j.jar' });
  });

  it('注释在字符串内的 //（https://）不被剥离', () => {
    expect(stripJsonComments('{"u":"https://a.b/c"}')).toBe('{"u":"https://a.b/c"}');
    expect(parseJsonLenient('{"u":"https://a.b/c"}')).toEqual({ u: 'https://a.b/c' });
  });

  it('真正损坏的 JSON 仍抛错（不掩盖语法错误）', () => {
    expect(() => parseJsonLenient('{"a": }')).toThrow();
    expect(() => parseJsonLenient('not json at all')).toThrow();
  });
});

// ★ 2026-10-14（用户报「肥猫订阅导入失败」）：实测 `http://肥猫.net/tv` 里站源写成 JS 对象字面量风格
//   （键名 `ext` 裸写：`"api":"csp_AppDrama",\n ext: {…}`）→ JSON.parse 报
//   `Expected double-quoted property name in JSON at position 2795`。安卓 org.json 能容忍。
describe('quoteUnquotedKeys（裸键名兜底）', () => {
  it('裸键名补引号；真实形态（裸 ext + 注释 + 尾随逗号）可解析', () => {
    const text = '{\n  "sites": [{"key":"a","api":"csp_AppDrama",\n    ext: {"host":"","publicKey":"x"}}],\n  //肥猫\n}';
    expect(parseJsonLenient(text)).toEqual({
      sites: [{ key: 'a', api: 'csp_AppDrama', ext: { host: '', publicKey: 'x' } }],
    });
  });

  it('值不被误改（true/false/null/数字/已引号键）', () => {
    expect(quoteUnquotedKeys('{"a":true,"b":false,"c":null,"d":123}')).toBe('{"a":true,"b":false,"c":null,"d":123}');
    expect(quoteUnquotedKeys('{"a":"ext: {b:1}"}')).toBe('{"a":"ext: {b:1}"}'); // 字符串内不动
  });

  it('引号错位键名（`ext": {`）补正；且不吞掉字符串里的 `//` URL（肥猫实证 line 124/143）', () => {
    const text = '{"sites":[{"key":"a","api":"csp_AppDrama",\n ext": {"pkg":"com.x","site":" https://1851089669.cdn.123clouddisk.com/az5.txt "}}]}';
    const o = parseJsonLenient(text) as { sites: Array<{ api: string; ext: { pkg: string; site: string } }> };
    expect(o.sites[0].api).toBe('csp_AppDrama');
    // 关键：引号错位会让「先剥注释」的字符串状态错位而吃掉 URL —— 必须原样保留
    expect(o.sites[0].ext.site).toBe(' https://1851089669.cdn.123clouddisk.com/az5.txt ');
  });

  it('合法 JSON 走严格分支、不做任何改写', () => {
    expect(parseJsonLenient('{"a":{"b":1}}')).toEqual({ a: { b: 1 } });
  });

  it('补引号后仍非法的文本仍抛错', () => {
    expect(() => parseJsonLenient('{ext: {a:1}, "b": }')).toThrow();
  });
});

describe('quoteSingleQuotedStrings（单引号字符串兜底）', () => {
  it('只转换单引号字符串，保留双引号字符串中的撇号', () => {
    const text = String.raw`{"leave":"don't alter","urls":[{'name':'It\'s ready','api':'https://example.invalid/api'}]}`;
    expect(JSON.parse(quoteSingleQuotedStrings(text))).toEqual({
      leave: "don't alter",
      urls: [{ name: "It's ready", api: 'https://example.invalid/api' }],
    });
  });

  it('解析单引号、裸键、注释和尾随逗号同时出现的配置', () => {
    const text = String.raw`{
      urls: [
        {name:'line\nnext', quote:'say "yes"',},
      ], // comment outside the strings
    }`;
    expect(parseJsonLenient(text)).toEqual({ urls: [{ name: 'line\nnext', quote: 'say "yes"' }] });
  });

  it('保留未闭合单引号字符串的解析错误', () => {
    expect(() => parseJsonLenient("{'a':'unterminated}")).toThrow();
  });
});


describe('订阅格式回归', () => {
  it('保留双引号字符串中的原始换行与制表符', () => {
    const text = '{"sites":[{"key":"a","name":"line\nnext\titem","api":"csp_A"}]}'.replaceAll('\\n', '\n').replaceAll('\\t', '\t');
    expect(parseJsonLenient(text)).toEqual({ sites: [{ key: 'a', name: 'line\nnext\titem', api: 'csp_A' }] });
  });

  it('单引号配置中的 CR 行注释不会吞掉下一行', () => {
    expect(parseJsonLenient("{ // note\r name:'one', api:'https://example.invalid/a'\r}")).toEqual({
      name: 'one', api: 'https://example.invalid/a',
    });
  });

  it.each([
    [String.raw`{'value':'\\path\\file'}`, { value: '\\path\\file' }],
    [String.raw`{'value':'\u4e2d\x41'}`, { value: '中A' }],
    [String.raw`{'value':'it\'s "ok"'}`, { value: 'it\'s "ok"' }],
  ])('保留单引号转义的字符串值 %s', (text, expected) => {
    expect(parseJsonLenient(text)).toEqual(expected);
  });

  it('数字后多余的引号仍报错', () => {
    expect(() => parseJsonLenient('{"sites":[{"searchable":0"}]}')).toThrow();
  });

  it('拒绝对象中的可执行表达式', () => {
    expect(() => parseJsonLenient("{name: (() => 'value')()} ")).toThrow();
  });
});


it('有转义引号时仍只转义字符串内部的控制字符', () => {
  const text = '{name:"say \\"yes\\"\nnext"}'.replaceAll('\\n', '\n');
  expect(parseJsonLenient(text)).toEqual({ name: 'say "yes"\nnext' });
});
