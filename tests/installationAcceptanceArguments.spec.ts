import { describe, expect, it } from 'vitest';
import { parseInstallationAcceptanceArgs } from '../scripts/verify-installation.mjs';

describe('installation acceptance arguments', () => {
  it('keeps the default package path and skips the running-process fixture unless requested', () => {
    expect(parseInstallationAcceptanceArgs([], 'D:/default/win-unpacked')).toEqual({
      appDir: 'D:/default/win-unpacked',
      stopRunningProcess: false,
    });
  });

  it('accepts the running-process scenario before or after the package path', () => {
    expect(parseInstallationAcceptanceArgs(['D:/scratch/win-unpacked', '--stop-running'], 'D:/default'))
      .toEqual({ appDir: 'D:/scratch/win-unpacked', stopRunningProcess: true });
    expect(parseInstallationAcceptanceArgs(['--stop-running', 'D:/scratch/win-unpacked'], 'D:/default'))
      .toEqual({ appDir: 'D:/scratch/win-unpacked', stopRunningProcess: true });
  });

  it('rejects multiple package paths instead of silently testing the wrong build', () => {
    expect(() => parseInstallationAcceptanceArgs(['D:/one', 'D:/two'], 'D:/default'))
      .toThrow('Usage: verify-installation.mjs');
  });
});
