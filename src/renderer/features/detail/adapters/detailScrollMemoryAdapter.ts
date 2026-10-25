import { schedulePersist } from '../../../lib/uiMemory';
import type { DetailScrollMemoryPort } from '../application/detailScrollMemory';
import { detailSelectionMemoryAdapter } from './detailSelectionMemoryAdapter';

export const detailScrollMemoryAdapter: DetailScrollMemoryPort = {
  ...detailSelectionMemoryAdapter,
  persistSelection: schedulePersist,
};
