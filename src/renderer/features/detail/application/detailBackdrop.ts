export interface DetailBackdropPort {
  load(name: string, mediaType: 'movie' | 'tv', year?: string): Promise<string[]>;
}
