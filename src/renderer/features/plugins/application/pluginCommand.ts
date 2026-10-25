import { UI_NAV_PATHS, type UiCommandAction, type UiNavTarget } from '../../../../shared/plugin';

export interface PluginActionSpec {
  label: string;
  title?: string;
  action: UiCommandAction;
  url?: string;
  to?: UiNavTarget;
  section?: string;
  template?: string;
  theme?: string;
  confirm?: boolean;
}

export interface CommandOutcome {
  ok: boolean;
  message: string;
}

export interface PluginCommandPort {
  openExternal(url: string): void;
  navigate(hash: string): void;
  setTheme(id: string): string | undefined;
  exportLive(templateId?: string): Promise<{ saved: boolean; path?: string }>;
}

export type PluginCommandRunner = (
  command: PluginActionSpec,
  confirm?: (message: string) => Promise<boolean>,
) => Promise<CommandOutcome>;

/** Decide whether a host-controlled plugin action is valid, then delegate its effect. */
export function createPluginCommandRunner(port: PluginCommandPort): PluginCommandRunner {
  return async (command, confirm) => {
    if (command.confirm) {
      if (!confirm) return { ok: false, message: '该命令需要界面确认' };
      if (!(await confirm((command.title || command.label) + '？'))) return { ok: true, message: '已取消' };
    }

    switch (command.action) {
      case 'open-url': {
        const url = String(command.url || '').trim();
        if (!/^https?:\/\//i.test(url)) return { ok: false, message: '命令地址非法（仅 http/https）' };
        port.openExternal(url);
        return { ok: true, message: `已打开：${url}` };
      }
      case 'navigate': {
        const path = UI_NAV_PATHS[command.to as keyof typeof UI_NAV_PATHS];
        if (!path) return { ok: false, message: '命令目标页非法' };
        const query = command.to === 'config' && command.section
          ? '?' + new URLSearchParams({ section: command.section }).toString()
          : '';
        port.navigate(`#${path}${query}`);
        return { ok: true, message: '已跳转' };
      }
      case 'set-theme': {
        const id = String(command.theme || '');
        const label = port.setTheme(id);
        if (!label) return { ok: false, message: `皮肤不存在（可能插件已停用/卸载）：${id}` };
        return { ok: true, message: `已切换皮肤：${label}` };
      }
      case 'export-live': {
        try {
          const result = await port.exportLive(command.template);
          return {
            ok: true,
            message: result.saved ? `已导出到：${result.path || ''}` : '已取消导出',
          };
        } catch (error) {
          return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
      }
      default:
        return { ok: false, message: `未知动作：${String((command as { action?: unknown }).action)}` };
    }
  };
}
