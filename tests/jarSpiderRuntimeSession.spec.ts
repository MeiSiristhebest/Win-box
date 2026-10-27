import { describe, expect, it } from 'vitest';
import { JarSpiderRuntimeSession } from '../src/engine/spider/JarSpiderRuntimeSession';

describe('JarSpiderRuntimeSession', () => {
  it('rebinds the expected port to the actual JVM and keeps playback on detail identity', () => {
    const session = new JarSpiderRuntimeSession();
    session.rememberExpectedProxyPort(19970, 'expected-pool');
    session.rememberProxyResult({ tag: 'site-a', method: 'homeContent', proxyPort: 19970, poolKey: 'home-pool' });

    const detail = session.rememberProxyResult({
      tag: 'site-a', method: 'detailContent', proxyPort: 30451, poolKey: 'detail-pool',
    });
    expect(detail.pinForDetailSelection).toBe(true);
    expect(session.proxyPortForSource('site-a')).toBe(30451);

    // A later discovery/search on the same tag must not replace the detail JVM.
    session.rememberProxyResult({ tag: 'site-a', method: 'searchContent', proxyPort: 19970, poolKey: 'search-pool' });
    expect(session.preferredPlaybackPort('site-a', 'playerContent')).toBe(30451);
    expect(session.preferredPlaybackPort('site-a', 'detailContent')).toBeUndefined();
    expect(session.poolKeyForProxyPort(19970)).toBe('search-pool');
    expect(session.poolKeyForProxyPort(30451)).toBe('detail-pool');
  });

  it('pins only a successful detail response and preserves the existing routing rules', () => {
    const session = new JarSpiderRuntimeSession();
    expect(session.rememberProxyResult({
      tag: 'site-a', method: 'detailContent', proxyPort: 21000, poolKey: 'detail-pool', error: 'failed',
    })).toEqual({ pinForDetailSelection: false });
    expect(session.preferredPlaybackPort('site-a', 'playerContent')).toBeUndefined();
    expect(session.proxyPortForSource('site-a')).toBe(21000);

    session.rememberProxyResult({ tag: 'site-b', method: 'homeContent', proxyPort: 22000, poolKey: 'home-pool' });
    session.rememberProxyResult({ tag: 'site-b', method: 'searchContent', proxyPort: 22001, poolKey: 'search-pool' });
    expect(session.proxyPortForSource('site-b')).toBe(22000);
    session.rememberProxyResult({ tag: 'site-b', method: 'playerContent', proxyPort: 22002, poolKey: 'player-pool' });
    expect(session.proxyPortForSource('site-b')).toBe(22002);
  });

  it('clears proxy routing when the pool resets but retains a learned shell-shim preference', () => {
    const session = new JarSpiderRuntimeSession();
    session.rememberProxyResult({ tag: 'site-a', method: 'detailContent', proxyPort: 23000, poolKey: 'pool' });
    session.rememberShellShimPreference('site-a.jar');

    session.resetProxyRouting();

    expect(session.proxyPortForSource('site-a')).toBeNull();
    expect(session.preferredPlaybackPort('site-a', 'playerContent')).toBeUndefined();
    expect(session.poolKeyForProxyPort(23000)).toBeUndefined();
    expect(session.prefersShellShim('site-a.jar')).toBe(true);
  });
});
