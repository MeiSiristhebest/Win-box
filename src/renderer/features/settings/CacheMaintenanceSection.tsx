import type { CacheMaintenancePort } from './application/settingsSectionPorts';
import { CacheMaintenanceView } from './CacheMaintenanceView';
import { useCacheMaintenancePresenter } from './useCacheMaintenancePresenter';

export function CacheMaintenanceSection({ active, port }: { active: boolean; port: CacheMaintenancePort }) {
  const model = useCacheMaintenancePresenter(active, port);
  return <CacheMaintenanceView {...model} onClearCache={() => { void model.clearCache(); }} />;
}
