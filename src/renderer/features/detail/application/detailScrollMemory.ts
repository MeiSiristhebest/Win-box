import type { DetailSelectionMemoryPort } from './detailDataPorts';

export interface DetailScrollMemoryPort extends DetailSelectionMemoryPort {
  persistSelection(): void;
}
