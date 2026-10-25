/** Infrastructure contract for refreshing the plugin-owned theme registry. */
export interface PluginThemeRegistryPort<Skin> {
  fetch(): Promise<Skin[]>;
  synchronize(skins?: Skin[]): void;
}

/**
 * Coordinates registry refreshes without depending on Electron, the DOM, or React.
 * Older requests are ignored so a slow response cannot replace a newer registry.
 */
export function createPluginThemeRegistryLoader<Skin>(
  port: PluginThemeRegistryPort<Skin>,
): () => Promise<void> {
  let latestRequest = 0;

  return async () => {
    const request = ++latestRequest;
    let skins: Skin[] | undefined;
    try {
      skins = await port.fetch();
    } catch {
      // Keep the current plugin registry, but still resynchronize the active theme.
    }

    if (request !== latestRequest) return;
    port.synchronize(skins);
  };
}
