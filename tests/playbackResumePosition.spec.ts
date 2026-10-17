import { describe, expect, it } from 'vitest';
import {
  canRestoreHtml5Position,
  resolveResumePosition,
  toMpvStartPosition,
} from '../src/renderer/features/playback/resumePosition';

describe('playback resume position', () => {
  it('uses the kernel handoff position before explicit and stored positions', () => {
    expect(resolveResumePosition({ kernelPosition: 48, startTime: 30, storedPosition: 12 })).toBe(48);
  });

  it('uses an explicit history position before the stored same-URL position', () => {
    expect(resolveResumePosition({ kernelPosition: 0, startTime: 30, storedPosition: 12 })).toBe(30);
  });

  it('falls back to the stored position when higher-priority values are below the resume threshold', () => {
    expect(resolveResumePosition({ kernelPosition: 3, startTime: 3, storedPosition: 12 })).toBe(12);
  });

  it('ignores non-finite handoff, explicit, and stored positions', () => {
    expect(resolveResumePosition({ kernelPosition: Number.POSITIVE_INFINITY, startTime: 24, storedPosition: 12 })).toBe(24);
    expect(resolveResumePosition({ kernelPosition: 0, startTime: Number.POSITIVE_INFINITY, storedPosition: 12 })).toBe(12);
    expect(resolveResumePosition({ kernelPosition: 0, startTime: undefined, storedPosition: Number.NaN })).toBe(0);
  });

  it('restores HTML5 positions only when more than five seconds remain', () => {
    expect(canRestoreHtml5Position(30, 36)).toBe(true);
    expect(canRestoreHtml5Position(31, 36)).toBe(false);
    expect(canRestoreHtml5Position(3, 100)).toBe(false);
    expect(canRestoreHtml5Position(30, Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('rounds an eligible mpv start position to whole seconds', () => {
    expect(toMpvStartPosition(12.7)).toBe(13);
    expect(toMpvStartPosition(3)).toBe(0);
    expect(toMpvStartPosition(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
