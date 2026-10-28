import { describe, expect, it, vi } from 'vitest';
import { ConvertedJarArtifactInspector } from '../src/engine/spider/convertedJarArtifact';

describe('ConvertedJarArtifactInspector', () => {
  it('reuses validation only while the file fingerprint remains unchanged', () => {
    let fingerprint = '100:1';
    const isUsable = vi.fn(() => true);
    const inspector = new ConvertedJarArtifactInspector({
      fingerprint: () => fingerprint,
      isUsable,
    });

    expect(inspector.isUsable('/cache/source.jar')).toBe(true);
    expect(inspector.isUsable('/cache/source.jar')).toBe(true);
    expect(isUsable).toHaveBeenCalledOnce();

    fingerprint = '200:2';
    expect(inspector.isUsable('/cache/source.jar')).toBe(true);
    expect(isUsable).toHaveBeenCalledTimes(2);
  });

  it('does not cache unusable files and retries validation on the next call', () => {
    const isUsable = vi.fn().mockReturnValue(false);
    const inspector = new ConvertedJarArtifactInspector({
      fingerprint: () => '22:1',
      isUsable,
    });

    expect(inspector.isUsable('/cache/partial.jar')).toBe(false);
    expect(inspector.isUsable('/cache/partial.jar')).toBe(false);
    expect(isUsable).toHaveBeenCalledTimes(2);
  });

  it('clears a stale cache entry when the file fingerprint cannot be read', () => {
    let missing = false;
    const isUsable = vi.fn(() => true);
    const inspector = new ConvertedJarArtifactInspector({
      fingerprint: () => {
        if (missing) throw new Error('file missing');
        return '100:1';
      },
      isUsable,
    });

    expect(inspector.isUsable('/cache/source.jar')).toBe(true);
    missing = true;
    expect(inspector.isUsable('/cache/source.jar')).toBe(false);
    missing = false;
    expect(inspector.isUsable('/cache/source.jar')).toBe(true);
    expect(isUsable).toHaveBeenCalledTimes(2);
  });
});
