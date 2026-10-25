export function hlsErrorText(type: string | undefined, details: string | undefined, status?: number): string {
  const detail = details || '';
  const responseStatus = Number.isInteger(status) && (status ?? 0) > 0 ? `（HTTP ${status}）` : '';
  if (/manifestParsingError|manifestIncompatibleCodecsError/i.test(detail)) return '清单不是有效的 m3u8（源可能已失效或被拦截）';
  if (/manifestLoadError/i.test(detail)) return `清单加载失败${responseStatus}（网络不通 / 防盗链 / 需要登录）`;
  if (/levelLoadError/i.test(detail)) return `清晰度清单加载失败${responseStatus}（网络抖动）`;
  if (/fragLoadError|fragLoadTimeOut/i.test(detail)) return `分片加载失败${responseStatus}（网络不畅或源限速）`;
  if (/bufferAppendError|bufferAddCodecError/i.test(detail)) return '解码器不支持该视频编码（建议换线路/换源）';
  if (/bufferStalledError/i.test(detail)) return '缓冲停滞（网络太慢）';
  return `${type || 'HLS'} / ${detail || '未知错误'}`;
}
