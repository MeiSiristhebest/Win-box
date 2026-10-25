import type { MpvCommand } from '../../../../shared/player';

type SendPlayerKernelCommand = (command: MpvCommand) => Promise<unknown>;
type ReportPlayerKernelCommandError = (command: MpvCommand, error: unknown) => void;

/** Execute one managed-kernel command and route failures to the player's existing feedback channel. */
export async function runPlayerKernelCommandWithFeedback(
  command: MpvCommand,
  send: SendPlayerKernelCommand,
  reportError: ReportPlayerKernelCommandError,
): Promise<void> {
  try {
    await send(command);
  } catch (error) {
    reportError(command, error);
  }
}
