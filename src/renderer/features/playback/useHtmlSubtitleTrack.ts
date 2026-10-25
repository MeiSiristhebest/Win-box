import { useEffect, useRef, type RefObject } from 'react';
import { shiftCues, type SubtitleCue } from '../../../engine/subtitle/parseSubtitle';

interface HtmlSubtitleTrackOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  enabled: boolean;
  cues: SubtitleCue[];
  offset: number;
}

export function useHtmlSubtitleTrack({ videoRef, enabled, cues, offset }: HtmlSubtitleTrackOptions): void {
  const trackRef = useRef<TextTrack | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const apply = (track: TextTrack): number => {
      while (track.cues && track.cues.length) track.removeCue(track.cues[0] as VTTCue);
      track.mode = enabled && cues.length ? 'showing' : 'disabled';
      let added = 0;
      if (enabled && cues.length) {
        for (const cue of shiftCues(cues, offset)) {
          try {
            track.addCue(new VTTCue(cue.start, cue.end, cue.text));
            added++;
          } catch {
            // Ignore an invalid cue and keep applying the rest.
          }
        }
      }
      return added;
    };

    let track = trackRef.current;
    const belongsToCurrentVideo = !!track && Array.from(video.textTracks || []).includes(track);
    if (!track || !belongsToCurrentVideo) {
      track = video.addTextTrack('subtitles', '外挂字幕', 'zh');
      trackRef.current = track;
    }

    const added = apply(track);
    if (enabled && cues.length && added === 0) {
      trackRef.current = null;
      track = video.addTextTrack('subtitles', '外挂字幕', 'zh');
      trackRef.current = track;
      apply(track);
    }
  }, [videoRef, enabled, cues, offset]);
}
