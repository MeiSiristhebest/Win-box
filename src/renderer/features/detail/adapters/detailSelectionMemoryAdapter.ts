import { uiMem } from '../../../lib/uiMemory';
import type { DetailSelectionMemoryPort } from '../application/detailDataPorts';

export const detailSelectionMemoryAdapter: DetailSelectionMemoryPort = {
  readSelection: key => uiMem.detail.get(key),
  rememberSelection: (key, selection) => uiMem.detail.set(key, selection),
};
