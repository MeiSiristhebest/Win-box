import { SR_MODE_LABEL } from '../../../../shared/player';
import type { SuperResolutionFeedback } from '../application/superResolutionPort';
import type { SuperResolutionModeChange } from '../application/superResolutionUseCases';

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function formatSuperResolutionFeedback(change: SuperResolutionModeChange): SuperResolutionFeedback {
  switch (change.type) {
    case 'persistence-failed':
      return { kind: 'error', message: `保存超分档位失败：${describeError(change.error)}` };
    case 'saved-and-applied':
      return {
        kind: 'ok',
        message: change.mode === 'off'
          ? '已向 MPV 发送关闭着色器指令。'
          : `已向 MPV 发送「${SR_MODE_LABEL[change.mode] ?? change.mode}」切换指令。`,
      };
    case 'saved-but-not-applied':
      return {
        kind: 'error',
        message: '档位已保存，但当前 MPV 会话未接收切换指令；下次启动播放器时会按保存的档位尝试加载。',
      };
    case 'saved-but-command-failed':
      return {
        kind: 'error',
        message: `档位已保存，但向 MPV 发送指令失败：${describeError(change.error)}`,
      };
  }
}
