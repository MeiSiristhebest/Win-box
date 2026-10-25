import type { SourceBean } from '../../shared/types';
import type { SpiderSourceCapabilities, SpiderSourceProviderPort } from '../vod/SpiderSourcePorts';
import { isSpiderOperationImplemented, Spider } from './Spider';
import type { SpiderFactoryPort } from './SpiderFactoryPort';

/**
 * Adapts the upstream-compatible Spider base class to optional source capabilities.
 * Runtime wrappers (JAR/JS/Python) retain their own method and error semantics;
 * inherited empty base implementations never advertise a supported operation.
 */
export class SpiderSourceRuntimeAdapter<THost> implements SpiderSourceProviderPort {
  constructor(
    private readonly factory: SpiderFactoryPort<THost>,
    private readonly host: THost,
  ) {}

  forSource(source: SourceBean): SpiderSourceCapabilities {
    const spider = this.factory.createForSource(source, this.host);
    return {
      homeContent: implementedMethod(spider, 'homeContent'),
      homeVideoContent: implementedMethod(spider, 'homeVideoContent'),
      categoryContent: implementedMethod(spider, 'categoryContent'),
      detailContent: implementedMethod(spider, 'detailContent'),
      searchContent: implementedMethod(spider, 'searchContent'),
      playerContent: implementedMethod(spider, 'playerContent'),
      proxyPort: implementedMethod(spider, 'proxyPort'),
      get lastReason() { return spider.lastReason; },
    };
  }
}

type SourceMethod = Exclude<keyof SpiderSourceCapabilities, 'lastReason'>;

function implementedMethod<K extends SourceMethod>(spider: Spider, key: K): SpiderSourceCapabilities[K] {
  const method = spider[key];
  if (!isSpiderOperationImplemented(spider, key)) return undefined;
  return method.bind(spider) as SpiderSourceCapabilities[K];
}
