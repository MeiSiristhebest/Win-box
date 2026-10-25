import { resolvePlayTarget } from '../../lib/playTarget';
import type { HtmlMediaSourcePort } from './application/htmlMediaSource';
import { needsHtmlMediaPreparation, prepareHtmlMediaSource, releaseHtmlMediaSession, type HtmlMediaPreparationPort } from './htmlMediaPreparation';

const http: HtmlMediaPreparationPort = {
  resolvePlayTarget,
  fetch: (input, init) => globalThis.fetch(input, init),
};

/** Maps media preparation and lease cleanup to the local HTTP compatibility endpoint. */
export const htmlMediaSourceAdapter: HtmlMediaSourcePort = {
  requiresPreparation: (url) => needsHtmlMediaPreparation(url, http),
  prepare: (url, signal) => prepareHtmlMediaSource(url, http, signal),
  release: (url) => releaseHtmlMediaSession(url, http),
};
