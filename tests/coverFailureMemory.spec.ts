import { describe, expect, it } from 'vitest';
import {
  COVER_FAILURE_MEMORY_MAX_URLS,
  rememberFailedCover,
} from '../src/renderer/features/covers/application/coverFailureMemory';

describe('cover failure memory', () => {
  it('keeps at most 1000 failed item URL pairs and evicts the oldest', () => {
    let memory: Array<readonly [string, string]> = [];
    for (let index = 0; index <= COVER_FAILURE_MEMORY_MAX_URLS; index++) {
      memory = rememberFailedCover(memory, `item-${index}`, `url-${index}`);
    }

    expect(memory).toHaveLength(COVER_FAILURE_MEMORY_MAX_URLS);
    expect(memory[0]).toEqual(['item-1', 'url-1']);
    expect(memory.at(-1)).toEqual([`item-${COVER_FAILURE_MEMORY_MAX_URLS}`, `url-${COVER_FAILURE_MEMORY_MAX_URLS}`]);
  });

  it('does not add a duplicate failure or trigger a state update', () => {
    let memory: Array<readonly [string, string]> = [];
    for (let index = 0; index < 3; index++) {
      memory = rememberFailedCover(memory, 'item', `url-${index}`);
    }
    const beforeDuplicate = memory;
    memory = rememberFailedCover(memory, 'item', 'url-2');

    expect(memory).toBe(beforeDuplicate);
    expect(memory).toEqual([['item', 'url-0'], ['item', 'url-1'], ['item', 'url-2']]);
  });

  it('allows a failed image to be remembered again after its old record was evicted', () => {
    let memory: Array<readonly [string, string]> = [];
    for (let index = 0; index < COVER_FAILURE_MEMORY_MAX_URLS; index++) {
      memory = rememberFailedCover(memory, `item-${index}`, `url-${index}`);
    }
    memory = rememberFailedCover(memory, 'new-item', 'new-url');
    expect(memory.some(([key, url]) => key === 'item-0' && url === 'url-0')).toBe(false);
    memory = rememberFailedCover(memory, 'item-0', 'url-0');

    expect(memory).toHaveLength(COVER_FAILURE_MEMORY_MAX_URLS);
    expect(memory.at(-1)).toEqual(['item-0', 'url-0']);
  });
});
