export interface AuxiliaryWindowNavigationPort {
  subscribeToNavigation(listener: (route: string) => void): () => void;
  announceReady(): Promise<void>;
  schedule(callback: () => void): () => void;
}
