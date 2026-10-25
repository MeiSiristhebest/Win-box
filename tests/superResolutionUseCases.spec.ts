import { describe, expect, it, vi } from 'vitest';
import type { SrMode } from '../src/shared/player';
import type { SuperResolutionPort } from '../src/renderer/features/playback/application/superResolutionPort';
import { changeSuperResolutionMode } from '../src/renderer/features/playback/application/superResolutionUseCases';
import { formatSuperResolutionFeedback } from '../src/renderer/features/playback/presentation/superResolutionFeedback';

function createPort(overrides: Partial<SuperResolutionPort> = {}): SuperResolutionPort {
  return {
    readCapability: vi.fn(async () => ({ available: true, modes: [], mode: 'off' })),
    saveMode: vi.fn(async () => undefined),
    applyMode: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

describe('changeSuperResolutionMode', () => {
  it('persists the preference before applying it to the live session', async () => {
    const order: string[] = [];
    const port = createPort({
      saveMode: vi.fn(async () => { order.push('save'); }),
      applyMode: vi.fn(async () => { order.push('apply'); return { ok: true }; }),
    });

    await expect(changeSuperResolutionMode(port, 'quality' as SrMode)).resolves.toEqual({
      type: 'saved-and-applied', mode: 'quality',
    });
    expect(order).toEqual(['save', 'apply']);
  });

  it('does not apply a mode when saving it fails', async () => {
    const port = createPort({ saveMode: vi.fn(async () => { throw new Error('disk full'); }) });

    await expect(changeSuperResolutionMode(port, 'quality' as SrMode)).resolves.toMatchObject({
      type: 'persistence-failed', error: new Error('disk full'),
    });
    expect(port.applyMode).not.toHaveBeenCalled();
  });

  it('reports a persisted mode when the player declines the live command', async () => {
    const port = createPort({ applyMode: vi.fn(async () => ({ ok: false })) });

    await expect(changeSuperResolutionMode(port, 'quality' as SrMode)).resolves.toEqual({
      type: 'saved-but-not-applied', mode: 'quality',
    });
    expect(port.saveMode).toHaveBeenCalledWith('quality');
  });

  it('keeps the saved mode when sending the live command throws', async () => {
    const port = createPort({ applyMode: vi.fn(async () => { throw new Error('session closed'); }) });

    await expect(changeSuperResolutionMode(port, 'off')).resolves.toMatchObject({
      type: 'saved-but-command-failed', mode: 'off', error: new Error('session closed'),
    });
  });
});

describe('formatSuperResolutionFeedback', () => {
  it('formats capability-independent application outcomes as explicit user feedback', () => {
    expect(formatSuperResolutionFeedback({ type: 'saved-and-applied', mode: 'off' })).toEqual({
      kind: 'ok', message: '已向 MPV 发送关闭着色器指令。',
    });
    expect(formatSuperResolutionFeedback({ type: 'saved-but-not-applied', mode: 'quality' })).toMatchObject({
      kind: 'error', message: '档位已保存，但当前 MPV 会话未接收切换指令；下次启动播放器时会按保存的档位尝试加载。',
    });
    expect(formatSuperResolutionFeedback({ type: 'saved-but-command-failed', mode: 'quality', error: 'pipe closed' }).message)
      .toContain('pipe closed');
    expect(formatSuperResolutionFeedback({ type: 'persistence-failed', error: new Error('disk full') }).message)
      .toContain('disk full');
  });
});
