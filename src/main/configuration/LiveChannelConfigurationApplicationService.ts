import type { LiveBean } from '../../shared/types';

export interface LiveChannelConfigurationPort {
  addLive(live: LiveBean): { index: number; replaced: boolean };
  deleteLive(index: number): void;
  deleteLives(indices: readonly number[]): void;
  updateLiveName(index: number, name: string): void;
  setActiveLiveIndex(index: number): void;
}

/** Live-channel configuration operations, independent from VOD source and profile management. */
export class LiveChannelConfigurationApplicationService {
  constructor(private readonly configuration: LiveChannelConfigurationPort) {}

  add(live: LiveBean): { index: number; replaced: boolean } {
    return this.configuration.addLive(live);
  }

  delete(index: number): void {
    this.configuration.deleteLive(index);
  }

  deleteMany(indices: readonly number[]): void {
    this.configuration.deleteLives(indices);
  }

  rename(index: number, name: string): void {
    this.configuration.updateLiveName(index, name);
  }

  select(index: number): void {
    this.configuration.setActiveLiveIndex(index);
  }
}
