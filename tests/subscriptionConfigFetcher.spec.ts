import { describe, expect, it, vi } from 'vitest';
import { fetchSubscriptionConfig } from '../src/main/subscriptions/SubscriptionConfigFetcher';
import type { HttpRequest } from '../src/shared/types';

describe('batch import diagnostics', () => {
  it('recovers a child that refuses UA-only requests but accepts its Referer', async () => {
    const config = '{"sites":[{"key":"cms","type":4,"api":"https://example.invalid/api"}]}';
    const request = vi.fn(async (arg: HttpRequest) => ({ status: arg.headers?.Referer ? 200 : 444, content: arg.headers?.Referer ? config : '', headers: {}, finalUrl: arg.url }));
    const logger = { i: vi.fn(), w: vi.fn(), e: vi.fn() };
    const result = await fetchSubscriptionConfig({ http: { request }, logger }, 'https://example.invalid/config.json', true);
    expect(result.text).toBe(config);
    expect(result.hint).toBe('');
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[2][0].headers?.Referer).toBe('https://example.invalid/');
  });

  it('bounds quick imports and exposes the final login/landing redirect in diagnostics', async () => {
    const request = vi.fn(async (_arg: HttpRequest) => ({
      status: 200,
      content: '<!-- verify --><!DOCTYPE html><html><title>Sign in</title></html>',
      headers: {},
      finalUrl: 'https://gitlab.example/users/sign_in?token=private',
    }));
    const logger = { i: vi.fn(), w: vi.fn(), e: vi.fn() };
    const result = await fetchSubscriptionConfig({ http: { request }, logger }, 'https://example.invalid/config.json', true);
    expect(request.mock.calls[0][0].totalTimeoutMs).toBe(22_000);
    expect(result.hint).toContain('https://gitlab.example/users/sign_in');
    expect(result.hint).not.toContain('token=private');
    expect(result.hint).toContain('HTML');
  });
});
