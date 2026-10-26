// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_META_SETTINGS } from '../src/shared/meta';
import { DEFAULT_SUBTITLE_SETTINGS, type SubtitleProviderView } from '../src/shared/subtitle';
import type { MetaSettingsPort } from '../src/renderer/features/settings/application/metaSettingsPort';
import type { SubtitleSettingsPort } from '../src/renderer/features/settings/application/subtitleSettingsPort';
import { MetaSettingsSection } from '../src/renderer/features/settings/MetaSettingsSection';
import { SubtitleSettingsSection } from '../src/renderer/features/settings/SubtitleSettingsSection';

const providers: SubtitleProviderView[] = [
  { id: 'assrt', name: 'Assrt', needsToken: true, enabled: true, available: true },
  { id: 'subtitlecat', name: 'SubtitleCat', needsToken: false, enabled: true, available: true },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('account settings presenters', () => {
  it('saves subtitle provider changes and reports failed token saves', async () => {
    const port: SubtitleSettingsPort = {
      getSettings: vi.fn().mockResolvedValue({ ...DEFAULT_SUBTITLE_SETTINGS, assrtToken: '' }),
      saveSettings: vi.fn().mockRejectedValue(new Error('token rejected')),
      listProviders: vi.fn().mockResolvedValue(providers),
    };

    render(<SubtitleSettingsSection port={port} />);
    await screen.findByRole('button', { name: 'SubtitleCat' });
    fireEvent.click(screen.getByRole('button', { name: 'SubtitleCat' }));
    await waitFor(() => expect(port.saveSettings).toHaveBeenCalledWith({ providers: { assrt: true, subtitlecat: false } }));

    fireEvent.change(screen.getByLabelText('字幕服务 Token'), { target: { value: 'secret-token' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect((await screen.findByRole('alert')).textContent).toContain('token rejected');
  });

  it('loads and saves metadata settings before notifying the application', async () => {
    const initial = {
      ...DEFAULT_META_SETTINGS,
      hasBuiltin: false,
      hasUserKey: false,
    };
    const port: MetaSettingsPort = {
      getSettings: vi.fn().mockResolvedValue(initial),
      saveSettings: vi.fn().mockImplementation(async (patch) => ({ ...initial, ...patch })),
    };
    const events = { notifyChanged: vi.fn() };

    render(<MetaSettingsSection port={port} events={events} />);
    const keyInput = await screen.findByLabelText('TMDB API Key');
    fireEvent.change(keyInput, { target: { value: 'user-key' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await screen.findByText('已保存，立即生效。');
    expect(port.saveSettings).toHaveBeenCalledWith({ ...DEFAULT_META_SETTINGS, tmdbApiKey: 'user-key' });
    expect(events.notifyChanged).toHaveBeenCalledOnce();
  });
});
