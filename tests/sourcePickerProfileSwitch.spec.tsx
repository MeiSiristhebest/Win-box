// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { client } from '../src/renderer/api/client';
import SourcePicker from '../src/renderer/components/SourcePicker';
import { profileConfig } from './fixtures/profileSwitchData';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('SourcePicker child repository switching', () => {
  it('opens other children when the current repository has only live streams', async () => {
    vi.spyOn(client, 'cfgGet').mockResolvedValue(profileConfig('live-only', false));
    vi.spyOn(client, 'cfgProfileSites').mockResolvedValue({ activeId: 'live-only', profiles: [{ id: 'live-only', name: '直播子仓', sites: [] }, { id: 'vod', name: '点播子仓', sites: [{ key: 'vod', name: '点播站点' }] }] });
    render(<SourcePicker />);
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByRole('region', { name: '订阅和来源' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: '点播子仓' })).toBeTruthy();
  });
});
