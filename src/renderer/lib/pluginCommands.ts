// src/renderer/lib/pluginCommands.ts
// 插件受限动作按钮的**执行器**（渲染层侧）：把 `UiCommandView` 映射为宿主**受控动作**。
//
// ★ 插件**不跑代码** —— 这里就是「宿主动作词表」的唯一实现处（主进程只做校验 + 装配）。
//   动作 = `open-url`（开外部链接）/ `navigate`（跳宿主页，可带配置页锚点）/
//          `export-live`（复用直播导出）/ `set-theme`（复用皮肤切换）。
// 事实源：docs/design/插件制作规范.md §5.9；机器契约见 src/shared/plugin.ts。
import { client } from '../api/client';
import { UI_NAV_PATHS, type UiCommandAction, type UiCommandView, type UiNavTarget } from '../../shared/plugin';
import { applyTheme } from './theme';
import { findSkin } from './themeTokens';

/** 某挂载点要显示的按钮（保持装配顺序；placement 缺失 / 不含该处 → 不显示） */
export function commandsFor(list: UiCommandView[] | undefined, placement: 'config' | 'player'): UiCommandView[] {
  return (list ?? []).filter((c) => Array.isArray(c.placement) && c.placement.includes(placement));
}

/**
 * ★ 动作执行参数（`ui.command` 按钮 与 `keymap` 快捷键 **共用**）——
 *   动作是宿主**预定义能力**，与触发方式（点按钮 / 按键盘）无关，故两处走**同一实现**。
 *   `UiCommandView` / `KeymapView` 都满足本形状。
 */
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

/** 执行结果（消息由调用方展示：配置页 → 顶部提示；播放器 → 短暂浮层） */
export interface CommandOutcome {
  ok: boolean;
  message: string;
}

/**
 * 执行一条插件命令。
 * ★ 全部走**宿主既有能力**（不新造网络 / 不注入组件）；目标不存在时**明确失败**，不静默"成功"。
 */
export async function runPluginCommand(cmd: PluginActionSpec): Promise<CommandOutcome> {
  if (cmd.confirm && !window.confirm(`${cmd.title || cmd.label}？`)) return { ok: true, message: '已取消' };
  switch (cmd.action) {
    case 'open-url': {
      const url = String(cmd.url || '').trim();
      if (!/^https?:\/\//i.test(url)) return { ok: false, message: '命令地址非法（仅 http/https）' };
      window.open(url, '_blank', 'noopener,noreferrer'); // 主进程 setWindowOpenHandler → shell.openExternal
      return { ok: true, message: `已打开：${url}` };
    }
    case 'navigate': {
      const path = UI_NAV_PATHS[cmd.to as keyof typeof UI_NAV_PATHS];
      if (!path) return { ok: false, message: '命令目标页非法' };
      location.hash = `#${path}`;
      if (cmd.section) {
        // 配置页是卡片锚点：等路由渲染出来再滚过去（跳页动画期间元素还没挂）
        window.setTimeout(() => {
          const el = document.getElementById(`cfg-${cmd.section}`);
          if (el) el.scrollIntoView({ block: 'center' });
        }, 350);
      }
      return { ok: true, message: '已跳转' };
    }
    case 'set-theme': {
      const id = String(cmd.theme || '');
      const skin = findSkin(id);
      if (!skin) return { ok: false, message: `皮肤不存在（可能插件已停用/卸载）：${id}` };
      applyTheme(id);
      return { ok: true, message: `已切换皮肤：${skin.label || id}` };
    }
    case 'export-live': {
      try {
        const cfg = await client.cfgGet();
        const index = Math.max(0, Number(cfg.ui?.activeLiveIndex) || 0);
        const { groups, liveName } = await client.loadLive(index);
        const tpls = await client.liveTemplates();
        const tpl = (cmd.template ? tpls.find((t) => t.id === cmd.template) : undefined) ?? tpls[0];
        if (!tpl) return { ok: false, message: '无可用导出模板' };
        const r = await client.liveExport({
          templateId: tpl.id,
          groups,
          defaultName: `${liveName || 'live'}.${tpl.ext}`,
        });
        return { ok: true, message: r.saved ? `已导出到：${r.path}` : '已取消导出' };
      } catch (e) {
        return { ok: false, message: (e as Error).message };
      }
    }
    default:
      return { ok: false, message: `未知动作：${String((cmd as { action?: unknown }).action)}` };
  }
}
