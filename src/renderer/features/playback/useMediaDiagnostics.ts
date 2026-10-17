import { useEffect, type RefObject } from 'react';
import { client } from '../../api/client';

export function reportHtmlMediaEvent(video: HTMLVideoElement, url: string, title: string | undefined, event: string): void {
  void Promise.resolve().then(() => client.mediaReport({ event, kernel: 'html5', url, title, readyState: video.readyState, currentTime: video.currentTime, paused: video.paused })).catch(() => undefined);
}

export function useMediaDiagnostics(videoRef: RefObject<HTMLVideoElement | null>, active: boolean, url: string, title?: string): void {
  useEffect(() => {
    const video = videoRef.current;
    if (!active || !video || !url) return;
    const report = (event: Event) => reportHtmlMediaEvent(video, url, title, event.type);
    const events = ['play', 'pause', 'playing', 'waiting', 'stalled', 'emptied', 'error'];
    for (const name of events) video.addEventListener(name, report);
    const visibility = () => reportHtmlMediaEvent(video, url, title, 'visibility:' + document.visibilityState);
    document.addEventListener('visibilitychange', visibility);
    let alive = true, lastFrame = performance.now(), stalled = false, frameId = 0;
    const onFrame = () => {
      if (!alive) return;
      lastFrame = performance.now(); stalled = false; frameId = video.requestVideoFrameCallback(onFrame);
    };
    const hasFrames = typeof video.requestVideoFrameCallback === 'function';
    if (hasFrames) frameId = video.requestVideoFrameCallback(onFrame);
    const timer = hasFrames ? setInterval(() => {
      if (!stalled && !video.paused && !video.ended && video.readyState >= 2 && performance.now() - lastFrame > 5000) {
        stalled = true; reportHtmlMediaEvent(video, url, title, 'frame-stall');
      }
    }, 5000) : null;
    return () => {
      alive = false;
      for (const name of events) video.removeEventListener(name, report);
      document.removeEventListener('visibilitychange', visibility);
      if (timer) clearInterval(timer);
      if (frameId && typeof video.cancelVideoFrameCallback === 'function') video.cancelVideoFrameCallback(frameId);
    };
  }, [videoRef, active, url, title]);
}
