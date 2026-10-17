// @vitest-environment happy-dom
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { client } from '../src/renderer/api/client';
import { SubscriptionImportSection } from '../src/renderer/features/subscriptions/SubscriptionImportSection';
import { useSubscriptionImport } from '../src/renderer/features/subscriptions/useSubscriptionImport';

vi.mock('../src/renderer/components/AppDialog', () => ({
  AppModal: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <div role='dialog'>{children}</div> : null,
}));

function Harness({ active = true, onRefresh }: { active?: boolean; onRefresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const flow = useSubscriptionImport({ busy, setBusy, setError, setNotice, onRefresh });
  return <SubscriptionImportSection active={active} flow={flow} error={error} notice={notice} onErrorClear={() => setError('')} />;
}

function mockImportJobLookup() {
  vi.spyOn(client, 'cfgListSubscriptionImports').mockResolvedValue([]);
  vi.spyOn(client, 'onSubscriptionImportProgress').mockReturnValue(() => {});
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe('SubscriptionImportSection', () => {
  it('imports a local JSON subscription, shows its report, and refreshes sources', async () => {
    mockImportJobLookup();
    const report = { total: 1, ok: 1, skipped: 0, degraded: 0, items: [{ index: 0, key: 'source-a', name: 'Source A', type: 0, api: 'https://example.test/api', status: 'OK', message: '' }] };
    const importJson = vi.spyOn(client, 'cfgImportJsonLocal').mockResolvedValue({
      ok: true,
      name: 'Local config',
      result: { config: {} as never, report, warnings: [] },
    } as never);
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    render(<Harness onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole('button', { name: '导入本地 .json 文件' }));

    await waitFor(() => expect(importJson).toHaveBeenCalledOnce());
    expect(await screen.findByText(/最近一次导入：共 1 条/)).toBeTruthy();
    expect(screen.getByText('source-a')).toBeTruthy();
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('prompts for a name before registering a Python-only package', async () => {
    mockImportJobLookup();
    const importPackage = vi.spyOn(client, 'cfgImportPackage')
      .mockResolvedValueOnce({ ok: false, needsName: true, root: 'C:\\packages\\my-source' } as never)
      .mockResolvedValueOnce({ ok: true, name: 'My Package', rel: '影视.json', sites: 1, warnings: [] } as never);
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    render(<Harness onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole('button', { name: '导入本地包' }));
    const nameInput = await screen.findByLabelText('生成的 JSON 文件名');
    expect((nameInput as HTMLInputElement).value).toBe('my-source');
    fireEvent.change(nameInput, { target: { value: 'My Package' } });
    fireEvent.click(screen.getByRole('button', { name: '确认导入' }));

    await waitFor(() => expect(importPackage).toHaveBeenLastCalledWith('My Package', 'C:\\packages\\my-source'));
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(await screen.findByText(/已导入本地包：My Package/)).toBeTruthy();
  });
});
