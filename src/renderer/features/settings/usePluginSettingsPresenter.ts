import { useCallback, useEffect, useRef, useState } from 'react';
import { PERMISSION_LABELS, type PluginView, type SettingsPanelView, type UiCommandView } from '../../../shared/plugin';
import { selectPluginCommandsByPlacement } from './application/pluginCommandVisibility';
import type { PluginSettingsDependencies } from './application/settingsSectionPorts';

type OperationMessage = { text: string; kind: 'ok' | 'err' | 'warn' } | null;
type LoadStatus = 'idle' | 'loading' | 'ready' | 'failed';
type ConfirmationOptions = { title?: string; confirmLabel?: string; cancelLabel?: string; tone?: 'default' | 'danger' };
export type ConfirmPluginAction = (message: string, options?: ConfirmationOptions) => Promise<boolean>;
const permissionLabels: Readonly<Record<string, string>> = PERMISSION_LABELS;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Owns plugin settings loading and mutation workflows; the page only renders state and delegates events. */
export function usePluginSettingsPresenter(dependencies: PluginSettingsDependencies, confirm: ConfirmPluginAction, active: boolean) {
  const [pluginItems, setPluginItems] = useState<PluginView[]>([]);
  const [panels, setPanels] = useState<SettingsPanelView[]>([]);
  const [commands, setCommands] = useState<UiCommandView[]>([]);
  const [pluginMessage, setPluginMessage] = useState<OperationMessage>(null);
  const [pluginBusy, setPluginBusy] = useState(false);
  const [pluginsStatus, setPluginsStatus] = useState<LoadStatus>('idle');
  const [panelsStatus, setPanelsStatus] = useState<LoadStatus>('idle');
  const [commandsStatus, setCommandsStatus] = useState<LoadStatus>('idle');
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const loadRequest = useRef(0);
  const busyOperations = useRef(0);

  const loadPlugins = useCallback(async (): Promise<string[]> => {
    const request = ++loadRequest.current;
    setPluginsStatus('loading');
    setPanelsStatus('loading');
    setCommandsStatus('loading');
    setLoadErrors([]);
    const [items, settings, actions] = await Promise.allSettled([
      Promise.resolve().then(() => dependencies.catalog.listPlugins()),
      Promise.resolve().then(() => dependencies.catalog.listPanels()),
      Promise.resolve().then(() => dependencies.catalog.listCommands()),
    ] as const);
    if (request !== loadRequest.current) return [];

    const failures: string[] = [];
    if (items.status === 'fulfilled') {
      setPluginItems(items.value);
      setPluginsStatus('ready');
    } else {
      const message = `插件列表加载失败：${errorText(items.reason)}`;
      failures.push(message);
      setPluginsStatus('failed');
    }
    if (settings.status === 'fulfilled') {
      setPanels(settings.value);
      setPanelsStatus('ready');
    } else {
      failures.push(`插件设置面板加载失败：${errorText(settings.reason)}`);
      setPanelsStatus('failed');
    }
    if (actions.status === 'fulfilled') {
      setCommands(selectPluginCommandsByPlacement(actions.value, 'config'));
      setCommandsStatus('ready');
    } else {
      failures.push(`插件命令加载失败：${errorText(actions.reason)}`);
      setCommandsStatus('failed');
    }
    setLoadErrors(failures);
    return failures;
  }, [dependencies]);
  const invalidatePendingLoads = useCallback(() => { loadRequest.current++; }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void loadPlugins();
    });
    return () => {
      cancelled = true;
      invalidatePendingLoads();
    };
  }, [active, invalidatePendingLoads, loadPlugins]);

  const whileBusy = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    busyOperations.current++;
    setPluginBusy(true);
    try { return await operation(); }
    finally {
      busyOperations.current--;
      setPluginBusy(busyOperations.current > 0);
    }
  }, []);

  const finishLifecycleAction = useCallback(async (
    result: { ok: boolean; canceled?: boolean; reason?: string; items?: PluginView[] },
    successText: string,
  ): Promise<void> => {
    if (result.canceled) return;
    if (!result.ok) {
      setPluginMessage({ text: result.reason || `${successText}失败`, kind: 'err' });
      return;
    }
    if (result.items) setPluginItems(result.items);
    dependencies.events.notifyChanged();

    const refreshes = await Promise.allSettled([
      loadPlugins(),
      result.items ? dependencies.skins.reload() : Promise.resolve(),
    ]);
    const refreshErrors = [
      ...(refreshes[0].status === 'fulfilled' ? refreshes[0].value : [errorText(refreshes[0].reason)]),
      ...(refreshes[1].status === 'rejected' ? [`外观刷新失败：${errorText(refreshes[1].reason)}`] : []),
    ];
    setPluginMessage(refreshErrors.length
      ? { text: `${successText}，但${refreshErrors.join('；')}`, kind: 'err' }
      : { text: successText, kind: 'ok' });
  }, [dependencies, loadPlugins]);

  const installPlugin = useCallback(() => whileBusy(async () => {
    try {
      const inspection = await dependencies.catalog.inspectInstallSource();
      if (inspection.canceled) return;
      if (!inspection.ok || !inspection.path) throw new Error(inspection.reason || inspection.reasonCode || '插件包无效');
      if (inspection.kind === 'code') {
        const permissions = (inspection.permissions ?? []).map((permission) =>
          `${permission}：${inspection.permissionNotes?.[permission] || permissionLabels[permission] || ''}`,
        ).join('\n');
        const accepted = await confirm(
          `插件：${inspection.name}\n${permissions}\n代码将在独立沙箱中运行。是否安装？`,
          { title: '确认插件权限', confirmLabel: '确认安装' },
        );
        if (!accepted) return;
      }
      await finishLifecycleAction(await dependencies.lifecycle.install(inspection.path), '安装成功');
    } catch (error) {
      setPluginMessage({ text: errorText(error), kind: 'err' });
    }
  }), [confirm, dependencies, finishLifecycleAction, whileBusy]);

  const uninstallPlugin = useCallback((id: string, name: string) => whileBusy(async () => {
    let accepted: boolean;
    try {
      accepted = await confirm(
        `卸载插件「${name}」？插件目录会被删除；随包插件在下次启动时重新安装。`,
        { title: '卸载插件', confirmLabel: '卸载', tone: 'danger' },
      );
    } catch (error) {
      setPluginMessage({ text: errorText(error), kind: 'err' });
      return;
    }
    if (!accepted) return;
    try { await finishLifecycleAction(await dependencies.lifecycle.uninstall(id), '已卸载'); }
    catch (error) { setPluginMessage({ text: errorText(error), kind: 'err' }); }
  }), [confirm, dependencies, finishLifecycleAction, whileBusy]);

  const togglePluginEnabled = useCallback((id: string, enabled: boolean) => whileBusy(async () => {
    try {
      await finishLifecycleAction(await dependencies.lifecycle.setEnabled({ id, enabled }), enabled ? '已启用' : '已停用');
    } catch (error) { setPluginMessage({ text: errorText(error), kind: 'err' }); }
  }), [dependencies, finishLifecycleAction, whileBusy]);

  const saveSetting = useCallback(async (id: string, panelId: string, key: string, value: unknown): Promise<boolean> => {
    return whileBusy(async () => {
      try {
        const result = await dependencies.panels.save({ id, panelId, key, value });
        if (!result.ok) {
          setPluginMessage({ text: result.reason || '保存失败', kind: 'err' });
          return false;
        }
        if (result.panels) setPanels(result.panels);
        setPluginMessage(result.refreshError
          ? { text: `设置已保存，但面板刷新失败：${result.refreshError}`, kind: 'warn' }
          : { text: '设置已保存', kind: 'ok' });
        return true;
      } catch (error) {
        setPluginMessage({ text: errorText(error), kind: 'err' });
        return false;
      }
    });
  }, [dependencies, whileBusy]);

  const executeCommand = useCallback(async (command: UiCommandView): Promise<void> => {
    await whileBusy(async () => {
      try {
        const result = await dependencies.commands.execute(command, (message) =>
          confirm(message, { title: command.label }),
        );
        setPluginMessage({ text: result.message, kind: result.ok ? 'ok' : 'err' });
      } catch (error) { setPluginMessage({ text: errorText(error), kind: 'err' }); }
    });
  }, [confirm, dependencies, whileBusy]);

  return {
    pluginItems,
    panels,
    commands,
    pluginMessage,
    pluginBusy,
    pluginsStatus,
    panelsStatus,
    commandsStatus,
    loadErrors,
    loadPlugins,
    installPlugin,
    uninstallPlugin,
    togglePluginEnabled,
    saveSetting,
    executeCommand,
  };
}
