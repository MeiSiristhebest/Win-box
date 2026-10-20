import { useEffect, useState } from 'react';
import type { SourceDebugReport } from '../../../shared/types';
import { client } from '../../api/client';

interface SourceDiagnosticsRequest {
  sourceKey: string;
  revision: number;
}

interface SourceDiagnosticsSectionProps {
  request: SourceDiagnosticsRequest | null;
  onClose: () => void;
}

type SourceDiagnosticsState =
  | { revision: number; status: 'loading' }
  | { revision: number; status: 'ready'; report: SourceDebugReport }
  | { revision: number; status: 'error'; error: string };

export function SourceDiagnosticsSection({ request, onClose }: SourceDiagnosticsSectionProps) {
  const [state, setState] = useState<SourceDiagnosticsState | null>(null);

  useEffect(() => {
    if (!request) return;

    let current = true;

    void Promise.resolve()
      .then(() => client.vodDebug(request.sourceKey))
      .then((result) => {
        if (current) setState({ revision: request.revision, status: 'ready', report: result });
      })
      .catch((cause: unknown) => {
        if (current) setState({
          revision: request.revision,
          status: 'error',
          error: cause instanceof Error ? cause.message : String(cause),
        });
      });

    return () => {
      current = false;
    };
  }, [request]);

  if (!request) return null;
  const currentState = state?.revision === request.revision
    ? state
    : { revision: request.revision, status: 'loading' as const };
  const report = currentState.status === 'ready' ? currentState.report : null;
  const error = currentState.status === 'error' ? currentState.error : '';

  return (
    <div className="card" style={{ padding: 12, marginBottom: 16 }}>
      <h4 style={{ margin: '0 0 8px' }}>诊断：{request.sourceKey}</h4>
      {currentState.status === 'loading' && <output className="status">正在探测并实际调用（首次拉 jar 可能较慢）…</output>}
      {error && <div className="err" role="alert">{error}</div>}
      {report && (
        <div style={{ fontSize: 12, lineHeight: 1.9 }}>
          <div><span className="muted">类型/形态：</span>{report.type} / {report.kind}</div>
          <div><span className="muted">ext：</span>{report.ext.present ? (report.ext.jsonOk ? `有（JSON ✓ 键：${report.ext.preview.slice(0, 120)}）` : `有但非 JSON：${report.ext.preview}`) : '无（部分蜘蛛需要）'}</div>
          {report.jarUrl && <div><span className="muted">jar：</span>{report.jarUrl.slice(0, 160)}</div>}
          {report.probe && (
            <div style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 6 }}>
              <div className="muted">—— 接口探测 ——</div>
              <div>地址：{report.probe.url}</div>
              <div>结果：HTTP {report.probe.status} · {report.probe.bytes} 字节 · 类型 {report.probe.contentType || '未知'}</div>
              <div>解析：分类 {report.probe.classes} · 条目 {report.probe.items}{report.probe.error ? ` · ${report.probe.error}` : ''}</div>
              {report.probe.preview && <div className="muted" style={{ wordBreak: 'break-all' }}>正文预览：{report.probe.preview}</div>}
            </div>
          )}
          {report.run && (
            <div style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 6 }}>
              <div className="muted">—— 实际调用 ——</div>
              <div>{report.run.ok ? `成功：分类 ${report.run.classes} · 条目 ${report.run.items} · ${report.run.ms}ms` : `失败：${report.run.error}`}</div>
              {report.run.head && <div className="muted" style={{ wordBreak: 'break-all' }}>数据预览：{report.run.head}</div>}
            </div>
          )}
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 6, color: report.verdict.startsWith('探测正常') || report.verdict.includes('成功') ? 'var(--text-success)' : 'var(--text-warn)' }}>
            <b>结论：</b>{report.verdict}
          </div>
        </div>
      )}
      <button style={{ marginTop: 8 }} onClick={onClose}>关闭</button>
    </div>
  );
}
