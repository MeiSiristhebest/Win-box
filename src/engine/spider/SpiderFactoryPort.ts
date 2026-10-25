import type { SourceBean } from '../../shared/types';
import type { Spider } from './Spider';

/** Runtime lookup only; the consumer treats construction context as opaque. */
export interface SpiderFactoryPort<THost> {
  createForSource(source: SourceBean, host: THost): Spider;
}
