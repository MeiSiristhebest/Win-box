import { extractBaiduSharedFile } from '../net/baiduTransfer';

/** Identifies a serialized Baidu share descriptor returned by a spider. */
export function isBaiduPanDescriptor(url: string): boolean {
  const value = String(url || '').trim();
  return value.startsWith('{') && (/"surl"\s*:\s*"/.test(value) || extractBaiduSharedFile(value) !== null);
}
