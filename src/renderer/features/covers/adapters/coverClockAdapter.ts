import type { CoverClockPort } from '../application/coverLookupPort';

export const coverClockAdapter: CoverClockPort = {
  now: () => Date.now(),
};
