// src/engine/live/catchup.ts
// ★ 2026-10-25 冲刺 4（用户要求）：IPTV 时移回看（Catch-up / Timeshift）URL 生成器。
// 支持 M3U 标准与主流 IPTV 回看模板：
//   - ${(b)yyyyMMddHHmmss} / ${(e)yyyyMMddHHmmss}
//   - ${(b)timestamp} / ${(e)timestamp} (以秒为单位)
//   - ${(b)epoch} / ${(e)epoch} (以毫秒为单位)
//   - ${(d)duration} (时长，秒)
//   - ${(b)yyyy-MM-dd-HH-mm} 等自定义日期格式
// 支持 catchup="append", catchup="shift", catchup-source 模板，以及 catchup-replace 替换正则。

export interface CatchupMeta {
  type?: string;
  source?: string;
  replace?: string;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function formatDateTime(date: Date, pattern: string): string {
  const yyyy = String(date.getFullYear());
  const MM = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  const HH = pad2(date.getHours());
  const mm = pad2(date.getMinutes());
  const ss = pad2(date.getSeconds());

  return pattern
    .replace(/yyyy/g, yyyy)
    .replace(/MM/g, MM)
    .replace(/dd/g, dd)
    .replace(/HH/g, HH)
    .replace(/mm/g, mm)
    .replace(/ss/g, ss);
}

export function resolveCatchupTemplate(
  template: string,
  startTimeMs: number,
  endTimeMs: number,
): string {
  const startDate = new Date(startTimeMs);
  const endDate = new Date(endTimeMs);
  const durationSec = Math.max(0, Math.round((endTimeMs - startTimeMs) / 1000));
  const startSec = Math.floor(startTimeMs / 1000);
  const endSec = Math.floor(endTimeMs / 1000);

  let result = template;

  result = result.replace(/\$\{\(b\)([^}]+)\}/g, (_match, fmt) => {
    if (fmt === 'timestamp' || fmt === 'ts') return String(startSec);
    if (fmt === 'epoch') return String(startTimeMs);
    return formatDateTime(startDate, fmt);
  });

  result = result.replace(/\$\{\(e\)([^}]+)\}/g, (_match, fmt) => {
    if (fmt === 'timestamp' || fmt === 'ts') return String(endSec);
    if (fmt === 'epoch') return String(endTimeMs);
    return formatDateTime(endDate, fmt);
  });

  result = result.replace(/\$\{\(d\)([^}]*)\}/g, () => String(durationSec));

  return result;
}

export function buildCatchupUrl(
  streamUrl: string,
  catchup: CatchupMeta | undefined,
  startTimeMs: number,
  endTimeMs: number,
): string | null {
  if (!streamUrl) return null;

  const defaultSource = '?playseek=${(b)yyyyMMddHHmmss}-${(e)yyyyMMddHHmmss}';
  const sourceTemplate = (catchup?.source || '').trim() || defaultSource;

  const resolvedQuery = resolveCatchupTemplate(sourceTemplate, startTimeMs, endTimeMs);

  let finalUrl = streamUrl;

  if (catchup?.replace) {
    const parts = catchup.replace.split('->');
    if (parts.length === 2) {
      finalUrl = finalUrl.replace(new RegExp(parts[0], 'g'), parts[1]);
    }
  }

  if (/^https?:\/\//i.test(resolvedQuery)) {
    return resolvedQuery;
  }

  if (resolvedQuery.startsWith('?') || resolvedQuery.startsWith('&')) {
    const cleanQuery = resolvedQuery.replace(/^[?&]+/, '');
    const separator = finalUrl.includes('?') ? '&' : '?';
    return `${finalUrl}${separator}${cleanQuery}`;
  }

  if (catchup?.type === 'append' || !catchup?.type) {
    const separator = finalUrl.includes('?') ? '&' : '?';
    return `${finalUrl}${separator}${resolvedQuery}`;
  }

  return `${finalUrl}/${resolvedQuery}`;
}
