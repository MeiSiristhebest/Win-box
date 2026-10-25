import { schedulePersist, uiMem } from '../../../lib/uiMemory';
import type { HomePageMemoryPort } from '../application/homePageMemoryPort';

export const homePageMemoryAdapter: HomePageMemoryPort = {
  read: () => ({
    ...uiMem.home,
    filters: { ...uiMem.home.filters },
    search: uiMem.home.search ?? null,
  }),
  update: (patch) => {
    Object.assign(uiMem.home, patch);
    if (patch.filters) uiMem.home.filters = { ...patch.filters };
  },
  persist: () => schedulePersist(),
};
