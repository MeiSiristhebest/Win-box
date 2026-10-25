import type { SourceBean } from '../../shared/types';
import { SourceProblemError } from './errors';
import { isSpiderOperationImplemented } from './Spider';
import type { SpiderFactoryPort } from './SpiderFactoryPort';

/** Explicit live capability boundary for the upstream-compatible Spider base class. */
export class SpiderLiveContentAdapter<THost> {
  constructor(
    private readonly factory: SpiderFactoryPort<THost>,
    private readonly host: THost,
  ) {}

  async load(source: SourceBean, url: string): Promise<string> {
    const spider = this.factory.createForSource(source, this.host);
    if (!isSpiderOperationImplemented(spider, 'liveContent')) {
      throw new SourceProblemError(
        'OPERATION_UNSUPPORTED',
        '该源未提供直播功能',
        { sourceKey: source.key, operation: 'liveContent' },
      );
    }
    return await Promise.resolve(spider.liveContent(url));
  }
}
