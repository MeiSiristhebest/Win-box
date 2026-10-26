export interface HomeWaterfallObserverPort {
  observe(root: HTMLDivElement, target: HTMLDivElement, onVisible: () => void): () => void;
}
