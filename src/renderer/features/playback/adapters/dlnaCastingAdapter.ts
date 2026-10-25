import { client } from '../../../api/client';
import type { DlnaCastingPort } from '../application/dlnaCasting';

/** Renderer IPC adapter for the DLNA application port. */
export const dlnaCastingAdapter: DlnaCastingPort = {
  discoverDevices: () => client.dlnaDiscover(),
  castToDevice: (device, target) => client.dlnaCast({ device, target }),
};
