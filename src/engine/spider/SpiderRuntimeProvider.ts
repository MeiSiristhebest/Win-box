import type { SourceBean } from '../../shared/types';
import type { Spider, SpiderInit } from './Spider';
import type { SpiderRuntimeHostPort } from './SpiderPorts';

/**
 * Creates a spider adapter for a source protocol. Providers are ordered by the
 * composition root; the first matching provider owns that protocol.
 */
export interface SpiderRuntimeProvider<THost extends SpiderRuntimeHostPort = SpiderRuntimeHostPort> {
  supports(source: SourceBean): boolean;
  create(source: SourceBean, init: SpiderInit<THost>): Spider;
}
