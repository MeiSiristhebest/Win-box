import { useCallback, useEffect, useRef, useState } from 'react';
import type { MediaRuntimeId, MediaRuntimeProgress, MediaRuntimeStatus } from '../../../shared/player';
import type { MediaRuntimeManagementPort } from './application/playbackSettingsPorts';

interface MediaRuntimeManagementOptions {
  active: boolean;
  port: MediaRuntimeManagementPort;
  afterMpvInstall: () => Promise<void>;
}

export function useMediaRuntimeManagement({ active, port, afterMpvInstall }: MediaRuntimeManagementOptions) {
  const [status, setStatus] = useState<MediaRuntimeStatus | null>(null);
  const [busy, setBusy] = useState<MediaRuntimeId | null>(null);
  const [progress, setProgress] = useState<MediaRuntimeProgress | null>(null);
  const [message, setMessage] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const unsubscribe = port.onProgress((next) => {
      if (alive) setProgress(next);
    });
    void port.loadStatus()
      .then((next) => { if (alive) setStatus(next); })
      .catch((error: unknown) => {
        if (alive) setMessage({ text: `组件状态读取失败：${error instanceof Error ? error.message : String(error)}`, kind: 'err' });
      });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [active, port]);

  const install = useCallback(async (runtime: MediaRuntimeId) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(runtime);
    setProgress({ runtime, phase: 'resolve', received: 0, total: 0, message: '正在联系发行渠道' });
    setMessage(null);
    try {
      const nextStatus = await port.install(runtime);
      setStatus(nextStatus);
      if (runtime === 'mpv') {
        try {
          await afterMpvInstall();
        } catch (error) {
          setMessage({ text: `MPV 已安装，但播放器状态刷新失败：${error instanceof Error ? error.message : String(error)}`, kind: 'err' });
          return;
        }
      }
      setMessage({
        text: runtime === 'mpv'
          ? 'MPV 已安装并设为应用内兼容播放内核。'
          : 'FFmpeg 已安装；后续兼容性探测与转换会使用此版本。',
        kind: 'ok',
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setMessage(reason.includes('取消')
        ? { text: '已取消安装；临时文件已清理。', kind: 'ok' }
        : { text: `安装失败：${reason}`, kind: 'err' });
    } finally {
      busyRef.current = false;
      setBusy(null);
      void port.loadStatus().then(setStatus).catch(() => undefined);
    }
  }, [afterMpvInstall, port]);

  const cancel = useCallback(async () => {
    try {
      const canceled = await port.cancelInstall();
      if (!canceled) setMessage({ text: '当前步骤已进入本地解压，无法立即中断；完成后即可使用。', kind: 'ok' });
    } catch (error) {
      setMessage({ text: `取消失败：${error instanceof Error ? error.message : String(error)}`, kind: 'err' });
    }
  }, [port]);

  return { status, busy, progress, message, install, cancel };
}
