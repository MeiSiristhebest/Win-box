function hlsResponseBodyKind(value: unknown): 'html' | 'json' | null {
  if (typeof value !== 'string') return null;
  const body = value.trimStart();
  if (/^(?:<!--[\s\S]*?-->\s*)*(?:<!doctype\s+html\b|<html\b|<head\b|<body\b)/i.test(body)) return 'html';
  if (/^(?:\{|\[)/.test(body)) {
    try {
      const parsed: unknown = JSON.parse(body);
      if (parsed !== null && typeof parsed === 'object') return 'json';
    } catch { /* An HLS line can start with punctuation; only valid JSON is classified. */ }
  }
  return null;
}

export function hlsErrorText(type: string | undefined, details: string | undefined, status?: number, responseBody?: unknown): string {
  const detail = details || '';
  const responseStatus = Number.isInteger(status) && (status ?? 0) > 0 ? `（HTTP ${status}）` : '';
  const bodyKind = hlsResponseBodyKind(responseBody);
  if (/manifest|level|track/i.test(detail) && bodyKind === 'html') {
    return `源站返回了 HTML 网页而非 HLS 清单${responseStatus}（可能是登录跳转、访问拦截或防盗链）`;
  }
  if (/manifest|level|track/i.test(detail) && bodyKind === 'json') {
    return `源站返回了 JSON 错误而非 HLS 清单${responseStatus}（检查线路地址、授权或登录状态）`;
  }
  if (status === 401) return '源站要求登录或授权已过期（HTTP 401）';
  if (status === 403) return '源站拒绝访问（HTTP 403，可能需要登录、Referer 或线路权限）';
  if (status === 404) return `清单或分片不存在${responseStatus}（线路地址可能已失效）`;
  if (status === 429) return '源站请求过于频繁（HTTP 429），请稍后重试或更换线路';
  if (typeof status === 'number' && status >= 500) return `源站暂时不可用${responseStatus}`;
  if (/manifestParsingError|manifestIncompatibleCodecsError/i.test(detail)) return '清单不是有效的 m3u8（源可能已失效或被拦截）';
  if (/manifestLoadError/i.test(detail)) return `清单加载失败${responseStatus}（网络不通 / 防盗链 / 需要登录）`;
  if (/levelLoadError/i.test(detail)) return `清晰度清单加载失败${responseStatus}（网络抖动）`;
  if (/fragLoadError|fragLoadTimeOut/i.test(detail)) return `分片加载失败${responseStatus}（网络不畅或源限速）`;
  if (/bufferAppendError|bufferAddCodecError/i.test(detail)) return '解码器不支持该视频编码（建议换线路/换源）';
  if (/bufferStalledError/i.test(detail)) return '缓冲停滞（网络太慢）';
  return `${type || 'HLS'} / ${detail || '未知错误'}`;
}
