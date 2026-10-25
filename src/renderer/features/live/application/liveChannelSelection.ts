import type { LiveGroup } from '../../../../shared/types';
import { splitLine } from '../../../../engine/live/LiveUtils';

export interface LiveChannelSelection {
  groupName: string;
  channelName: string;
  lineIdx: number;
  playUrl: string;
}

/** Pure projection for restoring or changing the selected group/channel/line. */
export function selectLiveChannel(
  groups: LiveGroup[],
  groupName: string,
  channelName: string,
  requestedLineIndex: number,
): LiveChannelSelection {
  const group = groups.find(item => item.group === groupName);
  const channel = group?.channels.find(item => item.name === channelName);
  const lineIdx = channel && requestedLineIndex >= 0 && requestedLineIndex < channel.urls.length
    ? requestedLineIndex
    : 0;
  const rawUrl = channel?.urls[lineIdx];
  return {
    groupName,
    channelName,
    lineIdx,
    playUrl: rawUrl ? splitLine(rawUrl, lineIdx + 1).url : '',
  };
}
