// src/main/plugin/pluginLiveTemplate.ts
// 插件直播输出模板适配层：把 `contributes.live.template`（L2 **声明式输出**）适配为宿主「导出模板」。
//
// ★ 形态说明（★ 与前四个 provider **根本不同**）：本类型**不发网络请求、不取数、不解析** ——
//   它把宿主**已解析**的直播频道（`LiveGroup[]`）按插件的「每行格式串」**格式化输出**成文本文件
//   （TXT / M3U），供外部播放器 / 其它设备使用。插件只给格式串，宿主负责取数与写盘。
//   ★ 红线③：绝不触碰 `TxtSubscribe` / `LiveConfigParser`（那是引擎的解析行为，1:1 复刻）。
// 事实源：docs/design/插件制作规范.md §5.8；机器契约见 src/shared/plugin.ts。

import { LIVE_TEMPLATE_EOL, liveTemplateExt, type LiveTemplateContribute } from '../../shared/plugin';
import type { LiveChannel, LiveGroup } from '../../shared/types';

/** 渲染上下文（当前导出的是哪条线路） */
export interface LiveTemplateMeta {
  liveName: string;
}

/** 适配后的模板（含渲染能力；**内置默认模板与插件模板同形**） */
export interface LiveTemplate {
  id: string;
  /** 来源插件 id；内置默认模板恒为 `'builtin'` */
  pluginId: string;
  label: string;
  format: 'txt' | 'm3u';
  ext: string;
  render(groups: LiveGroup[], meta: LiveTemplateMeta): string;
}

/** 模板规格（不含 `type`；内置模板与插件贡献项共用） */
type LiveTemplateSpec = Omit<LiveTemplateContribute, 'type'>;

/** 占位符 → **原值**替换（导出文本是给人 / 外部播放器读的，不做百分号编码） */
function expand(text: string, vars: Record<string, string>): string {
  return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (raw, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] ?? '' : raw,
  );
}

/** 某频道某条线路的占位符表（`{index}` 按**频道**计数，同频道多线路共用） */
function varsOf(group: string, ch: LiveChannel, index: number, url: string): Record<string, string> {
  return {
    group,
    name: ch.name ?? '',
    url,
    logo: ch.logo || '',
    tvgId: ch['tvg-id'] || '',
    tvgName: ch['tvg-name'] || '',
    tvgChno: ch['tvg-chno'] || '',
    index: String(index),
  };
}

/**
 * 渲染导出文本（纯函数）。
 * 行序：`header` 各项 → 逐分组 → 组内逐频道 → 该频道**每条 url** 各一行。
 * ★ 跳过**无频道的分组**、跳过**无 urls 的频道**（不产出坏行）。
 * 行连接符 `\r\n`，末尾补一个。
 */
function renderGroups(spec: LiveTemplateSpec, groups: LiveGroup[]): string {
  const lines: string[] = [];
  /** ★ 展开后的行内换行一律归一为 `\r\n`（模板里的 `\n` 如 m3u 的 EXTINF+URL 也统一为 CRLF） */
  const push = (s: string) => lines.push(s.replace(/\r/g, '').replace(/\n/g, LIVE_TEMPLATE_EOL));
  for (const h of spec.header ?? []) push(h);
  for (const g of groups ?? []) {
    const chans = (g.channels ?? []).filter((c) => (c.urls ?? []).length > 0);
    if (!chans.length) continue;
    if (spec.group) {
      // 分组行只认 `{group}`；其余白名单占位符给空串（不残留字面量）
      const empty: Record<string, string> = {
        group: g.group, name: '', url: '', logo: '', tvgId: '', tvgName: '', tvgChno: '', index: '',
      };
      push(expand(spec.group, empty));
    }
    let idx = 0;
    for (const ch of chans) {
      idx++;
      for (const url of ch.urls) push(expand(spec.line, varsOf(g.group, ch, idx, url)));
    }
  }
  return lines.length ? lines.join(LIVE_TEMPLATE_EOL) + LIVE_TEMPLATE_EOL : '';
}

function specToTemplate(pluginId: string, spec: LiveTemplateSpec): LiveTemplate {
  const format = spec.format;
  return {
    id: spec.id,
    pluginId,
    label: spec.label,
    format,
    ext: spec.ext ?? liveTemplateExt(format),
    render: (groups: LiveGroup[]) => renderGroups(spec, groups),
  };
}

/** 声明式贡献 → 适配对象（`pluginId` 由调用方按需覆盖：`PluginHost` 会写入真实插件 id） */
export function liveTemplateFromContribute(c: LiveTemplateContribute): LiveTemplate {
  return specToTemplate('plugin', c as unknown as LiveTemplateSpec);
}

/**
 * 内置默认模板（2 个；**无插件时保证导出可用**）。
 * ★ `builtin:txt` 的产物能被宿主既有 `TxtSubscribe` 解析回频道（`分组,#genre#` + `名称,url` 是它认的形态）。
 */
export function builtinLiveTemplates(): LiveTemplate[] {
  const txt: LiveTemplateSpec = {
    id: 'builtin:txt',
    label: 'TXT（分组,#genre#）',
    format: 'txt',
    group: '{group},#genre#',
    line: '{name},{url}',
    ext: 'txt',
  };
  const m3u: LiveTemplateSpec = {
    id: 'builtin:m3u',
    label: 'M3U 播放列表',
    format: 'm3u',
    header: ['#EXTM3U'],
    line: '#EXTINF:-1 tvg-id="{tvgId}" tvg-name="{tvgName}" tvg-logo="{logo}" group-title="{group}",{name}\n{url}',
    ext: 'm3u',
  };
  return [specToTemplate('builtin', txt), specToTemplate('builtin', m3u)];
}
