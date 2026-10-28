import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMetrics = vi.hoisted(() => ({ windows: [] as any[], metrics: [] as any[] }));

vi.mock('electron', () => ({
  app: { getAppMetrics: () => electronMetrics.metrics },
  BrowserWindow: { getAllWindows: () => electronMetrics.windows },
}));
vi.mock('../src/main/util/logger', () => ({ fileLogger: { i: vi.fn() } }));

import { electronRows } from '../src/main/util/memProbe';

describe('memory probe window labels', () => {
  beforeEach(() => {
    electronMetrics.windows = [];
    electronMetrics.metrics = [];
  });

  it('labels renderer processes by window ID without reading or logging the media title', () => {
    const getTitle = vi.fn(() => 'Private Episode Title');
    electronMetrics.windows = [{ id: 7, getTitle, webContents: { getOSProcessId: () => 42 } }];
    electronMetrics.metrics = [{ pid: 42, type: 'Tab', memory: { workingSetSize: 1024 } }];

    const rows = electronRows();

    expect(rows).toEqual([{ pid: 42, name: 'Tab(window#7)', mb: 1 }]);
    expect(getTitle).not.toHaveBeenCalled();
    expect(JSON.stringify(rows)).not.toContain('Private Episode Title');
  });
});
