import type { MetaExtra, MetaHit } from '../../../../shared/types';

export interface DiscoverDetailMetadataPort {
  search(title: string, year?: string): Promise<MetaHit | null>;
  extra(title: string, year?: string): Promise<MetaExtra | null>;
}

export interface DiscoverDetailMetadata {
  meta: MetaHit | null;
  extra: MetaExtra | null;
  error: string;
}

/** Load independent metadata sources without making either source block the detail page. */
export async function loadDiscoverDetailMetadata(
  title: string,
  year: string,
  port: DiscoverDetailMetadataPort,
): Promise<DiscoverDetailMetadata> {
  const [hit, details] = await Promise.allSettled([
    port.search(title, year || undefined),
    port.extra(title, year || undefined),
  ]);

  return {
    meta: hit.status === 'fulfilled' ? hit.value : null,
    extra: details.status === 'fulfilled' ? details.value : null,
    error: hit.status === 'rejected' ? '影片简介暂时无法获取，仍可从下方选择片源。' : '',
  };
}
