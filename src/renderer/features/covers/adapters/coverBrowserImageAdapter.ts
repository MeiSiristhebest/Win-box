import { wrapImageUrlForRelay } from '../../../../shared/driveProvider';
import { preloadImage } from '../../../lib/coverPick';
import type { CoverImagePort } from '../application/coverLookupPort';

export const coverBrowserImageAdapter: CoverImagePort = {
  validate: (url) => preloadImage(url),
  relay: (url) => /\/(?:img|file)\?/.test(url) ? '' : wrapImageUrlForRelay(url, navigator.userAgent),
};
