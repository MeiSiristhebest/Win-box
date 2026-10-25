import { describe, expect, it, vi } from 'vitest';
import { runPlayerKernelCommandWithFeedback } from '../src/renderer/features/playback/application/runPlayerKernelCommandWithFeedback';
import type { MpvCommand } from '../src/shared/player';

describe('runPlayerKernelCommandWithFeedback', () => {
  it('reports a rejected kernel command with the original command identity', async () => {
    const command: MpvCommand = { type: 'sid', value: 3 };
    const failure = new Error('track unavailable');
    const send = vi.fn().mockRejectedValue(failure);
    const reportError = vi.fn();

    await runPlayerKernelCommandWithFeedback(command, send, reportError);

    expect(send).toHaveBeenCalledWith(command);
    expect(reportError).toHaveBeenCalledWith(command, failure);
  });

  it('does not show an error when the command succeeds', async () => {
    const command: MpvCommand = { type: 'audio-spdif', value: 'auto' };
    const send = vi.fn().mockResolvedValue(undefined);
    const reportError = vi.fn();

    await runPlayerKernelCommandWithFeedback(command, send, reportError);

    expect(send).toHaveBeenCalledWith(command);
    expect(reportError).not.toHaveBeenCalled();
  });
});
