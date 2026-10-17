import assert from 'node:assert/strict';
import { test } from 'node:test';
import { executeSubscriptionImportBatch } from '../src/main/subscriptions/SubscriptionImportExecutor.ts';
import { assembleSubscriptionImportGroup, commitSubscriptionImportGroup, prepareSubscriptionImportGroup, runSubscriptionImportGroup } from '../src/main/subscriptions/SubscriptionImportGroupService.ts';

const policy = (overrides = {}) => ({
  maxConcurrentChildren: 2,
  maxItemsPerRun: 128,
  itemTimeoutMs: 100,
  totalDurationMs: 2_000,
  ...overrides,
});

test('limits concurrency and reports items beyond the per-run cap', async () => {
  let active = 0;
  let maxActive = 0;
  const result = await executeSubscriptionImportBatch({
    items: ['a', 'b', 'c'],
    selectedIndices: [0, 1, 2],
    policy: policy({ maxItemsPerRun: 2 }),
    labelFor: (item) => item,
    load: async (item) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return item;
    },
  });

  assert.equal(maxActive, 2);
  assert.deepEqual(result.candidateIndices, [0, 1]);
  assert.equal(result.truncated, 1);
  assert.equal(result.succeeded, 2);
});

test('an item timeout fails that item without erasing an earlier failure', async () => {
  const result = await executeSubscriptionImportBatch({
    items: ['failed', 'slow', 'capped'],
    selectedIndices: [0, 1, 2],
    policy: policy({ maxConcurrentChildren: 1, maxItemsPerRun: 2, itemTimeoutMs: 10 }),
    labelFor: (item) => item,
    load: async (item, signal) => {
      if (item === 'failed') throw new Error('network failure');
      return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason ?? new Error('aborted'));
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      });
    },
  });

  assert.equal(result.failed, 2);
  assert.equal(result.truncated, 1);
  assert.equal(result.pendingByIndex[1], false);
  assert.match(result.skippedByIndex[1], /单个子仓导入达到时间限制/);
});

test('the batch deadline aborts active work and leaves unfinished items pending', async () => {
  const result = await executeSubscriptionImportBatch({
    items: ['slow', 'later'],
    selectedIndices: [0, 1],
    policy: policy({ maxConcurrentChildren: 1, totalDurationMs: 15, itemTimeoutMs: 1_000 }),
    labelFor: (item) => item,
    load: async (_item, signal) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve('late'), 50);
      const abort = () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error('aborted'));
      };
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }),
  });

  assert.equal(result.budgetExceeded, true);
  assert.equal(result.failed, 0);
  assert.equal(result.completed[0], null);
  assert.equal(result.pendingByIndex[0], true);
  assert.equal(result.pendingByIndex[1], true);
});

test('cancels an active request and returns completed results without a commit decision', async () => {
  const controller = new AbortController();
  let blocked = false;
  const resultPromise = executeSubscriptionImportBatch({
    items: ['ready', 'blocked'],
    selectedIndices: [0, 1],
    signal: controller.signal,
    policy: policy(),
    labelFor: (item) => item,
    load: async (item, signal) => {
      if (item === 'ready') return 'result';
      blocked = true;
      return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason ?? new Error('aborted'));
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      });
    },
    onProgress: ({ succeeded, pending }) => {
      if (succeeded === 1 && pending === 1) controller.abort(new Error('user cancelled'));
    },
  });
  const result = await resultPromise;

  assert.equal(blocked, true);
  assert.equal(result.cancelled, true);
  assert.equal(result.completed[0]?.result, 'result');
  assert.equal(result.completed[1], null);
  assert.equal(result.pendingByIndex[1], true);
});

test('assembles successful, failed, capped, and removed members without replacing earlier profiles', () => {
  const items = [
    { url: 'https://one.example/config.json', name: 'One' },
    { url: 'https://two.example/config.json', name: 'Two' },
    { url: 'https://three.example/config.json', name: 'Three' },
    { url: 'https://four.example/config.json', name: 'Four' },
  ];
  const rootUrl = 'https://parent.example/repos.json';
  const emptySnapshot = { subscriptionGroups: [], profiles: [], activeProfileId: '' };
  const splitRepoLine = (url) => ({ url, line: -1 });
  const seed = prepareSubscriptionImportGroup({ items, subscriptionUrl: rootUrl, snapshot: emptySnapshot, splitRepoLine });
  const oldGroup = {
    id: 'group-1',
    name: 'Saved group',
    url: rootUrl,
    members: [
      { id: seed.memberIds[0], profileId: 'profile-one', name: 'Saved One', url: items[0].url, status: 'ready', lastSuccessAt: '2026-01-01T00:00:00.000Z' },
      { id: seed.memberIds[1], profileId: 'profile-two', name: 'Saved Two', url: items[1].url, status: 'ready', lastSuccessAt: '2026-01-02T00:00:00.000Z' },
      { id: seed.memberIds[3], profileId: 'profile-four', name: 'Saved Four', url: items[3].url, status: 'ready', lastSuccessAt: '2026-01-04T00:00:00.000Z' },
      { id: 'removed-member', profileId: 'profile-removed', name: 'Removed', url: 'https://removed.example/config.json', status: 'ready' },
    ],
    status: 'complete',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const emptyOverrides = JSON.stringify({ version: 1, order: [], deletedKeys: [], additions: [], patches: [] });
  const profile = (id, memberId, name) => ({
    id,
    memberId,
    groupId: oldGroup.id,
    name,
    apiUrl: items[seed.memberIds.indexOf(memberId)].url,
    json: JSON.stringify({ sites: [] }),
    upstreamJson: JSON.stringify({ sites: [] }),
    sourceOverridesJson: emptyOverrides,
    sourceCount: 0,
    importedAt: '2026-01-01T00:00:00.000Z',
  });
  const snapshot = {
    subscriptionGroups: [oldGroup],
    profiles: [
      profile('profile-one', seed.memberIds[0], 'Saved One'),
      profile('profile-two', seed.memberIds[1], 'Saved Two'),
      profile('profile-four', seed.memberIds[3], 'Saved Four'),
    ],
    activeProfileId: 'profile-one',
  };
  const prepared = prepareSubscriptionImportGroup({
    items,
    subscriptionUrl: rootUrl,
    onlyMemberIds: new Set(seed.memberIds.slice(0, 3)),
    snapshot,
    splitRepoLine,
  });
  const firstResult = {
    config: { sites: [{ key: 'source-one', name: 'Source One', api: 'https://one.example/api' }] },
    report: {},
    warnings: [],
  };
  const dependencies = {
    labelFor: (item) => item.name || item.url,
    splitRepoLine,
    serializeImport: (config) => JSON.stringify({ sites: config.sites }),
    reconcileProfileRefresh: (incoming, _previous, incomingSnapshotJson) => ({
      sources: [...incoming],
      sourceOverridesJson: emptyOverrides,
      upstreamJson: incomingSnapshotJson,
    }),
  };
  const batch = {
    candidateIndices: [0, 1],
    completed: [
      { item: items[0], label: 'One', result: firstResult },
      null,
      null,
      null,
    ],
    skippedByIndex: [null, 'network failure', null, null],
    pendingByIndex: [false, false, false, false],
    succeeded: 1,
    failed: 1,
    truncated: 1,
    cancelled: false,
    budgetExceeded: false,
  };

  const result = assembleSubscriptionImportGroup({
    items,
    name: 'New name',
    subscriptionUrl: rootUrl,
    snapshot,
    prepared,
    batch,
    dependencies,
    now: '2026-10-17T09:50:00.000Z',
  });

  assert.equal(result.group.name, 'Saved group');
  assert.deepEqual(result.group.members.map((member) => member.status), ['ready', 'failed', 'pending', 'ready', 'pending-removal']);
  assert.equal(result.group.members[0].profileId, 'profile-one');
  assert.equal(result.group.members[1].profileId, 'profile-two');
  assert.equal(result.group.members[1].lastSuccessAt, '2026-01-02T00:00:00.000Z');
  assert.equal(result.importedProfiles.length, 1);
  assert.equal(result.group.status, 'partial');
  assert.equal(result.group.members[3].profileId, 'profile-four');
  assert.deepEqual([result.successCount, result.failedCount, result.pendingCount], [2, 1, 2]);
  assert.equal(result.activateProfileId, 'profile-one');
  assert.equal(result.truncated, 1);
  assert.equal(result.unselected, 1);
});

test('prepares stable member IDs for duplicate URLs and distinct line selections', () => {
  const items = [
    { url: 'https://repo.example/config.json#line=0' },
    { url: 'https://repo.example/config.json#line=0' },
    { url: 'https://repo.example/config.json#line=1' },
  ];
  const snapshot = { subscriptionGroups: [], profiles: [], activeProfileId: '' };
  const splitRepoLine = (rawUrl) => {
    const match = rawUrl.match(/^(.*)#line=(\d+)$/i);
    return match ? { url: match[1], line: Number(match[2]) } : { url: rawUrl, line: -1 };
  };
  const first = prepareSubscriptionImportGroup({ items, subscriptionUrl: '', snapshot, splitRepoLine });
  const repeat = prepareSubscriptionImportGroup({ items, subscriptionUrl: '', snapshot, splitRepoLine });
  const retryOne = prepareSubscriptionImportGroup({
    items,
    subscriptionUrl: '',
    onlyMemberIds: new Set([first.memberIds[1]]),
    snapshot,
    splitRepoLine,
  });

  assert.deepEqual(repeat.memberIds, first.memberIds);
  assert.equal(new Set(first.memberIds).size, 3);
  assert.deepEqual(retryOne.selectedIndices, [1]);
});

test('does not commit a group when an active child request is cancelled', async () => {
  const controller = new AbortController();
  let commits = 0;
  const items = [
    { url: 'https://one.example/config.json', name: 'One' },
    { url: 'https://two.example/config.json', name: 'Two' },
  ];
  const emptyOverrides = JSON.stringify({ version: 1, order: [], deletedKeys: [], additions: [], patches: [] });
  const dependencies = {
    labelFor: (item) => item.name || item.url,
    splitRepoLine: (url) => ({ url, line: -1 }),
    serializeImport: (config) => JSON.stringify({ sites: config.sites }),
    reconcileProfileRefresh: (incoming, _previous, incomingSnapshotJson) => ({
      sources: [...incoming],
      sourceOverridesJson: emptyOverrides,
      upstreamJson: incomingSnapshotJson,
    }),
  };
  const manager = {
    revision: 3,
    snapshot: () => ({ subscriptionGroups: [], profiles: [], activeProfileId: '' }),
    commitSubscriptionGroup: () => { commits++; },
  };
  const result = runSubscriptionImportGroup({
    manager,
    executeBatch: executeSubscriptionImportBatch,
    items,
    name: 'Group',
    subscriptionUrl: 'https://parent.example/repos.json',
    expectedRevision: 3,
    signal: controller.signal,
    policy: policy({ maxConcurrentChildren: 2 }),
    dependencies,
    load: async (_item, signal) => {
      if (_item.name === 'One') return { config: { sites: [{ key: 'one', name: 'One' }] }, report: {}, warnings: [] };
      return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason ?? new Error('aborted'));
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      });
    },
    onProgress: ({ succeeded, pending }) => {
      if (succeeded === 1 && pending === 1) controller.abort(new Error('user cancelled'));
    },
  });

  await assert.rejects(result, /user cancelled/);
  assert.equal(commits, 0);
});

test('rejects a stale config revision before the group commit', () => {
  let commits = 0;
  const messages = [];
  assert.throws(() => commitSubscriptionImportGroup({
    manager: {
      revision: 9,
      commitSubscriptionGroup: () => { commits++; },
    },
    assembled: { group: {}, importedProfiles: [] },
    expectedRevision: 8,
    onRevisionConflict: (message) => messages.push(message),
  }), /多仓下载结果未保存/);

  assert.equal(commits, 0);
  assert.equal(messages.length, 1);
});

test('commits the assembled group with its activation choice and expected revision', () => {
  const received = [];
  const assembled = {
    group: { id: 'group-1' },
    importedProfiles: [{ id: 'profile-1' }],
    activateProfileId: 'profile-1',
  };
  commitSubscriptionImportGroup({
    manager: {
      revision: 12,
      commitSubscriptionGroup: (...args) => received.push(...args),
    },
    assembled,
    expectedRevision: 12,
  });

  assert.equal(received[0], assembled.group);
  assert.equal(received[1], assembled.importedProfiles);
  assert.equal(received[2], 'profile-1');
  assert.equal(received[3], 12);
});
