import { describe, expect, it, vi } from 'vitest';
import { DriveAccountService } from '../src/main/drive/DriveAccountService';
import type { UcTvPollResult } from '../src/main/net/ucTvToken';

function makeService(overrides: Record<string, unknown> = {}) {
  const tokens: Record<string, string> = {};
  const driveStore = {
    list: vi.fn(() => ({ ...tokens })),
    set: vi.fn((provider: string, token: string) => { tokens[provider] = token; }),
    remove: vi.fn((provider: string) => { delete tokens[provider]; }),
  };
  const ucRecord: { deviceId: string; token: string } | null = null;
  const ucTvStore = {
    get: vi.fn(() => ucRecord),
    set: vi.fn(),
    remove: vi.fn(),
  };
  const dependencies = {
    drives: driveStore,
    ucTvStore,
    logger: { i: vi.fn(), w: vi.fn() },
    syncCredentialFiles: vi.fn(),
    resetSpiderRuntime: vi.fn(),
    createQr: vi.fn(async () => ({ provider: 'ali' as const, content: 'qr', sid: 'sid' })),
    pollQr: vi.fn(async () => ({ state: 0 })),
    runWebLogin: vi.fn(async () => ({ done: false, cookie: 'visitor=1' })),
    refreshQuarkSession: vi.fn(async (cookie: string) => ({ cookie, changed: false, status: 200, setCookieKeys: [] })),
    ucTv: {
      newDeviceId: vi.fn(() => 'device-1'),
      authorize: vi.fn(async () => ({ reqId: 'req-1', queryToken: 'query-1', imageDataUrl: 'data:image/png;base64,qr' })),
      poll: vi.fn(async (): Promise<UcTvPollResult> => ({ state: 'wait' })),
      exchange: vi.fn(async () => ({ ok: true, token: 'uc-tv-token' })),
    },
    ...overrides,
  };
  return { service: new DriveAccountService(dependencies as never), dependencies, tokens };
}

describe('DriveAccountService', () => {
  it('does not persist an incomplete web login or reset spiders', async () => {
    const { service, dependencies } = makeService();

    await expect(service.webLogin(' QUARK ')).rejects.toThrow('未检测到登录完成');

    expect(dependencies.runWebLogin).toHaveBeenCalledWith('quark');
    expect(dependencies.drives.set).not.toHaveBeenCalled();
    expect(dependencies.syncCredentialFiles).not.toHaveBeenCalled();
    expect(dependencies.resetSpiderRuntime).not.toHaveBeenCalled();
  });

  it('persists a completed web login, synchronizes files, then resets spider runtime', async () => {
    const { service, dependencies, tokens } = makeService({
      runWebLogin: vi.fn(async () => ({ done: true, cookie: 'session=valid' })),
    });

    await service.webLogin(' QUARK ');

    expect(tokens.quark).toBe('session=valid');
    expect(dependencies.syncCredentialFiles).toHaveBeenCalledOnce();
    expect(dependencies.resetSpiderRuntime).toHaveBeenCalledOnce();
  });

  it('keeps UC QR state until authorization completes and persists only a successful exchange', async () => {
    const { service, dependencies } = makeService();

    expect(await service.createUcTvQr()).toEqual({ imageDataUrl: 'data:image/png;base64,qr' });
    expect(dependencies.ucTv.newDeviceId).toHaveBeenCalledOnce();
    expect(await service.pollUcTvQr()).toEqual({ state: 'wait', hint: undefined });
    expect(dependencies.ucTvStore.set).not.toHaveBeenCalled();

    dependencies.ucTv.poll.mockResolvedValueOnce({ state: 'ok', code: 'grant-code' });
    expect(await service.pollUcTvQr()).toEqual({ state: 'ok' });
    expect(dependencies.ucTv.exchange).toHaveBeenCalledWith('req-1', 'grant-code', 'device-1');
    expect(dependencies.ucTvStore.set).toHaveBeenCalledWith('device-1', 'uc-tv-token');
    expect(dependencies.syncCredentialFiles).toHaveBeenCalledOnce();
    expect(dependencies.resetSpiderRuntime).toHaveBeenCalledOnce();
  });

  it('clears an expired UC QR session', async () => {
    const { service, dependencies } = makeService();
    await service.createUcTvQr();
    dependencies.ucTv.poll.mockResolvedValueOnce({ state: 'expired', hint: 'expired' });

    expect(await service.pollUcTvQr()).toEqual({ state: 'expired', hint: 'expired' });
    expect(await service.pollUcTvQr()).toEqual({ state: 'expired', hint: '请先获取二维码' });
    expect(dependencies.ucTvStore.set).not.toHaveBeenCalled();
  });
});
