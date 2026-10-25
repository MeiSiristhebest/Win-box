import type { MpvCommand } from '../../../../shared/player';

export interface PlayerKernelCommandPort {
  sendMpvCommand(command: MpvCommand): Promise<unknown>;
  sendEngineCommand(command: MpvCommand): Promise<unknown>;
}
