export function formatBossKeyAccelerator(accelerator: string): string {
  return accelerator.replace('CommandOrControl', 'Ctrl').replace(/\+/g, ' + ');
}
