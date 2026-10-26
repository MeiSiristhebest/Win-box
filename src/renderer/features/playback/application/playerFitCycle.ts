import type { PlayerFit } from './playerPreferences';

const FIT_CYCLE: readonly PlayerFit[] = ['contain', 'cover', 'r169', 'r43', 'fill', 'none'];
const FIT_LABELS: Readonly<Record<PlayerFit, string>> = {
  contain: '适应窗口（默认等比）',
  cover: '铺满裁剪（去除黑边）',
  r169: '强制 16:9 比例',
  r43: '强制 4:3 比例',
  fill: '拉伸全屏填充',
  none: '原始尺寸 1:1',
};

export function cyclePlayerFit(current: PlayerFit): { fit: PlayerFit; notice: string } {
  const currentIndex = FIT_CYCLE.indexOf(current);
  const fit = FIT_CYCLE[(currentIndex + 1) % FIT_CYCLE.length];
  return { fit, notice: `画面比例：${FIT_LABELS[fit]}` };
}
