import { client } from '../../../api/client';

export function reportPageError(message: string): void {
  void client.winReportError(message).catch(() => undefined);
}
