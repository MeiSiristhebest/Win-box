/** Translate an upstream Range failure into the response type that broke playback. */
export function mediaRangeFailureMessage(status: number, contentType: string, redirected = false): string {
  const mime = contentType.split(';', 1)[0].trim().toLowerCase();
  const http = `HTTP ${status}`;
  if (status === 401) return `媒体源需要登录或授权已过期（${http}）`;
  if (status === 403) return `媒体源拒绝访问（${http}，可能需要登录、Referer 或线路权限）`;
  if (status === 404) return `媒体地址不存在（${http}），线路可能已失效`;
  if (status === 416) return `媒体源拒绝了 Range 请求（${http}），地址可能已失效或内容已变化`;
  if (mime === 'text/html' || mime === 'application/xhtml+xml') {
    return `媒体源返回了 HTML 网页而非视频（${http}${redirected ? '，请求经重定向' : ''}；可能是登录页或访问拦截）`;
  }
  if (mime === 'application/json' || mime.endsWith('+json')) {
    return `媒体源返回了 JSON 错误而非视频（${http}；请检查地址、授权或登录状态）`;
  }
  if (status === 200) return '媒体源返回 HTTP 200，未提供兼容播放所需的 Range 分段数据';
  if (status === 206) return '媒体源返回了无效的 HTTP 206 Range 数据（Content-Range 不完整或不匹配）';
  return `媒体源未返回有效的 HTTP 206 Range 数据（${http}）`;
}
