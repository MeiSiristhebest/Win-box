import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SubscriptionImportJobStore } from '../src/main/subscriptions/SubscriptionImportJobStore';
import type { PersistedSubscriptionImportJob } from '../src/main/subscriptions/SubscriptionImportService';
import { JsonStore } from '../src/main/store/JsonStore';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('SubscriptionImportJobStore', () => {
  it('writes snapshots durably and loads them from a new store instance', () => {
    const directory = mkdtempSync(join(tmpdir(), 'winbox-import-jobs-'));
    temporaryDirectories.push(directory);
    const file = join(directory, 'jobs.json');
    const snapshot: PersistedSubscriptionImportJob = {
      selection: 'pending',
      runnerCheckpoint: {
        multiRepoItems: [
          { url: 'https://example.test/one.json', name: 'one' },
          { url: 'https://example.test/two.json' },
        ],
      },
      progress: {
        jobId: 'job-1',
        revision: 7,
        url: 'https://example.test/list.json',
        name: 'example',
        state: 'interrupted',
        total: 3,
        completed: 1,
        succeeded: 1,
        failed: 0,
        pending: 2,
        message: '应用重启后任务中断',
        updatedAt: '2026-10-15T18:00:00.000Z',
      },
    };

    new SubscriptionImportJobStore(new JsonStore(file)).save([snapshot]);

    expect(new SubscriptionImportJobStore(new JsonStore(file)).load()).toEqual([snapshot]);
  });
});
