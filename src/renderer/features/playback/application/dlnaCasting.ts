import { parseCastTarget, type DlnaCastResult, type DlnaCastTarget, type DlnaDevice } from '../../../../shared/dlna';

/** DLNA capabilities consumed by playback; the renderer IPC client stays in an adapter. */
export interface DlnaCastingPort {
  discoverDevices(): Promise<readonly DlnaDevice[]>;
  castToDevice(device: DlnaDevice, target: DlnaCastTarget): Promise<DlnaCastResult>;
}

export interface CastCurrentMediaRequest {
  device: DlnaDevice;
  url: string;
  title?: string;
  positionSeconds: number;
}

export interface CastCurrentMediaResult {
  target: DlnaCastTarget;
  result: DlnaCastResult;
}

export function discoverDlnaDevices(port: DlnaCastingPort): Promise<readonly DlnaDevice[]> {
  return port.discoverDevices();
}

export async function castCurrentMedia(
  port: DlnaCastingPort,
  request: CastCurrentMediaRequest,
): Promise<CastCurrentMediaResult> {
  const target = parseCastTarget(
    request.url,
    request.title || 'Win-Box 投屏',
    Number.isFinite(request.positionSeconds) ? Math.max(0, Math.round(request.positionSeconds * 1000)) : 0,
  );
  const result = await port.castToDevice(request.device, target);
  return { target, result };
}
