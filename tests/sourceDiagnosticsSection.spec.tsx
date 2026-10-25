// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { SourceDebugReport } from '../src/shared/types';
import { SourceDiagnosticsSection } from '../src/renderer/features/settings/SourceDiagnosticsSection';

const report: SourceDebugReport = {
  key: 'source-a',
  type: 0,
  api: 'https://example.test/api',
  kind: 'cms-json',
  ext: { present: false, jsonOk: false, preview: '' },
  jarUrl: '',
  probe: {
    url: 'https://example.test/api',
    status: 200,
    bytes: 42,
    contentType: 'application/json',
    preview: '{"ok":true}',
    parsedOk: true,
    classes: 1,
    items: 3,
  },
  run: { ok: true, ms: 12, classes: 1, items: 3, head: 'first result' },
  verdict: '探测正常，调用成功',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SourceDiagnosticsSection', () => {
  it('loads and displays a source report, then closes through its callback', async () => {
    const port = { debugSource: vi.fn().mockResolvedValue(report) };
    const onClose = vi.fn();

    render(<SourceDiagnosticsSection request={{ sourceKey: 'source-a', revision: 1 }} port={port} onClose={onClose} />);

    expect(await screen.findByText('探测正常，调用成功')).toBeTruthy();
    expect(screen.getByText('结果：HTTP 200 · 42 字节 · 类型 application/json')).toBeTruthy();
    expect(port.debugSource).toHaveBeenCalledWith('source-a');

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows an API error without discarding the selected source', async () => {
    const port = { debugSource: vi.fn().mockRejectedValue(new Error('diagnostic unavailable')) };

    render(<SourceDiagnosticsSection request={{ sourceKey: 'source-a', revision: 1 }} port={port} onClose={vi.fn()} />);

    expect((await screen.findByRole('alert')).textContent).toContain('diagnostic unavailable');
    expect(screen.getByRole('heading', { name: '诊断：source-a' })).toBeTruthy();
  });
});
