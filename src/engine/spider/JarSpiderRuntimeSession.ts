/**
 * Mutable identity owned by one JVM spider runtime session.
 *
 * A source's detail call and playback call must stay on the JVM that owns its
 * in-memory proxy state. The deterministic port is only an expected identity;
 * a serve result may report a temporary port, which must replace it. This
 * object owns those source/port/pool relationships and the per-artifact
 * shell-shim preference for the lifetime of the bridge.
 */
export class JarSpiderRuntimeSession {
  private readonly proxyPoolKeys = new Map<number, string>();
  private readonly sourceProxyPorts = new Map<string, number>();
  private readonly detailProxyPorts = new Map<string, number>();
  private readonly shellShimPreferredArtifacts = new Set<string>();

  proxyPortForSource(tag: string): number | null {
    const port = this.sourceProxyPorts.get(tag);
    return Number.isInteger(port) ? (port as number) : null;
  }

  preferredPlaybackPort(tag: string | undefined, method: string): number | undefined {
    return tag && method === 'playerContent' ? this.detailProxyPorts.get(tag) : undefined;
  }

  rememberExpectedProxyPort(port: number, poolKey: string): void {
    this.proxyPoolKeys.set(port, poolKey);
  }

  /**
   * Record the actual serve identity and whether a successful detail response
   * needs the pool pinned while the user chooses an episode.
   */
  rememberProxyResult(input: {
    tag?: string;
    method: string;
    proxyPort?: number;
    poolKey: string;
    error?: unknown;
  }): { pinForDetailSelection: boolean } {
    const { tag, method, proxyPort, poolKey, error } = input;
    if (!tag || !proxyPort) return { pinForDetailSelection: false };

    const successfulDetail = method === 'detailContent' && !error;
    if (successfulDetail) this.detailProxyPorts.set(tag, proxyPort);

    if (method === 'playerContent' || method === 'detailContent' || !this.sourceProxyPorts.has(tag)) {
      this.sourceProxyPorts.set(tag, proxyPort);
    }
    this.proxyPoolKeys.set(proxyPort, poolKey);
    return { pinForDetailSelection: successfulDetail };
  }

  poolKeyForProxyPort(port: number): string | undefined {
    return this.proxyPoolKeys.get(port);
  }

  resetProxyRouting(): void {
    this.sourceProxyPorts.clear();
    this.detailProxyPorts.clear();
    this.proxyPoolKeys.clear();
  }

  prefersShellShim(artifactKey: string): boolean {
    return this.shellShimPreferredArtifacts.has(artifactKey);
  }

  rememberShellShimPreference(artifactKey: string): void {
    this.shellShimPreferredArtifacts.add(artifactKey);
  }
}
