import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAppDialog } from '../components/AppDialog';
import { SubscriptionGroupsSection } from '../features/subscriptions/SubscriptionGroupsSection';
import { SavedProfilesSection } from '../features/subscriptions/SavedProfilesSection';
import { savedProfilesManagementAdapter } from '../features/subscriptions/adapters/savedProfilesManagementAdapter';
import { subscriptionGroupManagementAdapter } from '../features/subscriptions/adapters/subscriptionGroupManagementAdapter';
import { useSubscriptionGroupManagement } from '../features/subscriptions/useSubscriptionGroupManagement';
import { AppearanceSection } from '../features/settings/AppearanceSection';
import { AccountServicesSection } from '../features/settings/AccountServicesSection';
import { browserDriveAccountsEventsAdapter } from '../features/settings/adapters/browserDriveAccountsEventsAdapter';
import { browserMetaSettingsEventsAdapter } from '../features/settings/adapters/browserMetaSettingsEventsAdapter';
import { rendererMetaSettingsAdapter } from '../features/settings/adapters/rendererMetaSettingsAdapter';
import { rendererSubtitleSettingsAdapter } from '../features/settings/adapters/rendererSubtitleSettingsAdapter';
import { browserBackupStorageAdapter } from '../features/settings/adapters/browserBackupStorageAdapter';
import { rendererBackupOperationsAdapter } from '../features/settings/adapters/rendererBackupOperationsAdapter';
import { NetworkSection } from '../features/settings/NetworkSection';
import { PlaybackSettingsSection } from '../features/settings/PlaybackSettingsSection';
import { playerPreferencesStorageAdapter } from '../features/playback/adapters/playerPreferencesStorageAdapter';
import { ShortcutSettingsSection } from '../features/settings/ShortcutSettingsSection';
import { BackupSettingsSection } from '../features/settings/BackupSettingsSection';
import { StorageSettingsSection } from '../features/settings/StorageSettingsSection';
import { SourceHealthAuditSection } from '../features/settings/SourceHealthAuditSection';
import { sourceHealthAuditAdapter } from '../features/settings/adapters/sourceHealthAuditAdapter';
import { useSourceHealthAuditPresenter } from '../features/settings/useSourceHealthAuditPresenter';
import { MergeProfilesExportSection } from '../features/settings/MergeProfilesExportSection';
import { mergeProfileExportAdapter } from '../features/settings/adapters/mergeProfileExportAdapter';
import { useMergeProfileExportPresenter } from '../features/settings/useMergeProfileExportPresenter';
import { CacheMaintenanceSection } from '../features/settings/CacheMaintenanceSection';
import { cacheMaintenanceAdapter } from '../features/settings/adapters/cacheMaintenanceAdapter';
import { networkSettingsAdapter } from '../features/settings/adapters/networkSettingsAdapter';
import { storageSettingsAdapter } from '../features/settings/adapters/storageSettingsAdapter';
import { shortcutSettingsAdapter } from '../features/settings/adapters/shortcutSettingsAdapter';
import { pluginKeymapListAdapter } from '../features/settings/adapters/pluginKeymapListAdapter';
import { sourceManagementAdapter } from '../features/settings/adapters/sourceManagementAdapter';
import { sourceDiagnosticsAdapter } from '../features/settings/adapters/sourceDiagnosticsAdapter';
import { playerEngineSettingsAdapter } from '../features/settings/adapters/playerEngineSettingsAdapter';
import { browserPlayerEngineSettingsEventsAdapter } from '../features/settings/adapters/browserPlayerEngineSettingsEventsAdapter';
import {
  pluginCommandExecutionAdapter,
  pluginLifecycleAdapter,
  pluginPanelSettingsAdapter,
  pluginSettingsCatalogAdapter,
  pluginSettingsEventsAdapter,
  pluginSkinRegistryAdapter,
} from '../features/settings/adapters/pluginSettingsAdapters';
import type { PluginSettingsDependencies } from '../features/settings/application/settingsSectionPorts';
import {
  externalPlayerDiscoveryAdapter,
  mediaRuntimeManagementAdapter,
  mpvSettingsAdapter,
  playerSettingsAdapter,
} from '../features/settings/adapters/playbackSettingsAdapters';
import { SourceManagementSection } from '../features/settings/SourceManagementSection';
import { LiveSourcesSection } from '../features/subscriptions/LiveSourcesSection';
import { liveSourcesManagementAdapter } from '../features/subscriptions/adapters/liveSourcesAdapter';
import { SubscriptionImportSection } from '../features/subscriptions/SubscriptionImportSection';
import { useSubscriptionImport } from '../features/subscriptions/useSubscriptionImport';
import {
  browserSubscriptionImportJobMemory,
  localSourceImportAdapter,
  subscriptionImportJobsAdapter,
} from '../features/subscriptions/adapters/subscriptionImportAdapters';
import { Tabs } from '../components/ui/Tabs';
import { Icon, type IconName } from '../components/ui/Icon';
import { PluginSettingsSection } from '../features/settings/PluginSettingsSection';
import { configurationSnapshotAdapter } from '../features/settings/adapters/configurationSnapshotAdapter';
import { profileActivationAdapter } from '../features/settings/adapters/profileActivationAdapter';
import { useConfigurationSnapshotSession } from '../features/settings/useConfigurationSnapshotSession';
import { useConfigurationProfileActivation } from '../features/settings/useConfigurationProfileActivation';
import { useConfigSectionNavigation } from '../features/settings/useConfigSectionNavigation';

type TabId = 'sources' | 'health' | 'profiles' | 'account' | 'storage' | 'appearance' | 'play' | 'shortcut' | 'network' | 'backup' | 'plugins';

const SETTINGS_SECTIONS: { id: TabId; label: string; description: string; keywords: string }[] = [
  { id: 'sources', label: '订阅与源', description: '导入订阅，管理点播站点和直播线路。', keywords: '导入 多仓 单仓 json python txt m3u 地址 文件 直播' },
  { id: 'profiles', label: '配置档案', description: '切换、整理已保存的配置与订阅组。', keywords: '子仓 切换 重命名 订阅组 合并 导出' },
  { id: 'health', label: '源健康与维护', description: '检查站点可用性，清理失效源和缓存。', keywords: '体检 诊断 缓存 清理 失败 检查' },
  { id: 'appearance', label: '外观', description: '调整浅深外观、界面缩放和浏览方式。', keywords: '浅色 深色 主题 字体 缩放 海报 大小 密度 动效 窗口 发现 瀑布' },
  { id: 'play', label: '播放', description: '设置播放器、字幕、弹幕和播放行为。', keywords: '播放器 内核 外部 mpv ffmpeg 字幕 弹幕 去广告 跳过 硬件 音频' },
  { id: 'shortcut', label: '快捷键', description: '调整播放和窗口操作的快捷键。', keywords: '键盘 按键 老板键' },
  { id: 'account', label: '凭据', description: '管理全局网盘账号和元数据服务。', keywords: '账号 网盘 全局 夸克 阿里 百度 uc 天翼 115 密码 cookie token tmdb 豆瓣 api 密钥 登录' },
  { id: 'storage', label: '存储', description: '添加、检查和管理 WebDAV 连接。', keywords: 'webdav dav 网盘 服务器 用户名 密码 连接' },
  { id: 'network', label: '网络', description: '配置代理和网络访问选项。', keywords: '代理 proxy 请求 超时 连接' },
  { id: 'plugins', label: '插件与组件', description: '管理插件、播放组件和扩展功能。', keywords: '扩展 安装 更新 组件 插件 皮肤' },
  { id: 'backup', label: '备份', description: '备份、恢复和迁移应用配置。', keywords: '恢复 数据 导出 导入 迁移' },
];
const SETTINGS_CARD_TABS: Readonly<Record<string, TabId>> = {
  import: 'sources', sources: 'sources', live: 'sources', lives: 'sources',
  audit: 'health', cache: 'health', merge: 'profiles',
  subtitle: 'account', meta: 'account',
  'plugin-engines': 'play', 'plugin-keymap': 'shortcut',
  motion: 'appearance', 'show-discover': 'appearance', 'ui-scale': 'appearance', 'poster-size': 'appearance', 'nav-mode': 'appearance', 'home-browse': 'appearance',
  'm3u8-purify': 'play', 'bt-player': 'play', 'vod-player': 'play', 'mpv-kernel': 'play',
};

const SETTINGS_ICONS: Record<TabId, IconName> = {
  sources: 'globe', profiles: 'layers', health: 'shield', appearance: 'palette', play: 'play',
  shortcut: 'keyboard', account: 'key', storage: 'storage', network: 'globe', plugins: 'plug', backup: 'archive',
};

const pluginSettingsDependencies: PluginSettingsDependencies = {
  catalog: pluginSettingsCatalogAdapter,
  lifecycle: pluginLifecycleAdapter,
  panels: pluginPanelSettingsAdapter,
  commands: pluginCommandExecutionAdapter,
  skins: pluginSkinRegistryAdapter,
  events: pluginSettingsEventsAdapter,
};

export default function ConfigPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = searchParams.get('section') || '';
  const requestedTab = SETTINGS_SECTIONS.find(item => item.id === requestedSection)?.id
    ?? SETTINGS_CARD_TABS[requestedSection]
    ?? (requestedSection.startsWith('plugin-') ? 'plugins' : undefined)
    ?? SETTINGS_SECTIONS.find(item => item.id === searchParams.get('tab'))?.id;
  const dialog = useAppDialog();
  const [busy, setBusy] = useState(false);
  const { configuration: cfg, refresh } = useConfigurationSnapshotSession(configurationSnapshotAdapter);
  const [configurationError, setConfigurationError] = useState('');

  // 档案改名（内联编辑）
  const mergeExport = useMergeProfileExportPresenter(mergeProfileExportAdapter);
  // 多配置档案

  const subscriptionGroupManagement = useSubscriptionGroupManagement({
    port: subscriptionGroupManagementAdapter,
    confirm: (message, options) => dialog.confirm(message, options),
    refresh,
  });

  const importFlow = useSubscriptionImport({
    busy,
    setBusy,
    onRefresh: refresh,
    jobs: subscriptionImportJobsAdapter,
    localSources: localSourceImportAdapter,
    jobMemory: browserSubscriptionImportJobMemory,
  });
  const importRunning = importFlow.importRunning;
  const profileActivation = useConfigurationProfileActivation({
    profile: profileActivationAdapter,
    refreshConfiguration: refresh,
    busy,
    setBusy,
    importRunning,
  });

  useEffect(() => {
    async function loadInitialConfig() {
      try {
        await refresh();
        setConfigurationError('');
      } catch (error) {
        setConfigurationError((error as Error).message);
      }
    }
    void loadInitialConfig();
  }, [refresh]);

  const sources = cfg?.sources ?? [];
  const activeKey = cfg?.ui.activeSourceKey ?? '';
  const activeProfileName = cfg?.profiles.find((profile) => profile.id === cfg.activeProfileId)?.name ?? '';
  const sourceHealthAudit = useSourceHealthAuditPresenter({
    port: sourceHealthAuditAdapter,
    sources,
    activeProfileId: cfg?.activeProfileId ?? '',
    activeProfileName,
    confirm: (message, options) => dialog.confirm(message, options),
    refresh,
  });

  // ---- 选项卡（替代原 <a href="#cfg-*"> 锚点跳转，避免 HashRouter 下触发路由跳到空页）----
  const TABS = SETTINGS_SECTIONS.map(item => ({ ...item, icon: <Icon name={SETTINGS_ICONS[item.id]} size={16} /> }));
  const [settingsQuery, setSettingsQuery] = useState('');
  const searchTerm = settingsQuery.trim().toLocaleLowerCase();
  const matchingSections = SETTINGS_SECTIONS.filter(item => `${item.label} ${item.description} ${item.keywords}`.toLocaleLowerCase().includes(searchTerm));
  const tab: TabId = requestedTab ?? 'sources';
  const configNavigation = useConfigSectionNavigation({ requestedSection, requestedTab, activeTab: tab });
  const selectTab = (t: TabId) => {
    setSettingsQuery('');
    setSearchParams({ tab: t }, { replace: true });
  };
  return (
    <div className="content cfg-content">
      <header className="page-heading cfg-page-heading">
        <div><h1>设置</h1><p>管理内容来源和应用偏好。</p></div>
        <input className="cfg-search" aria-label="搜索设置" placeholder="搜索设置，如字幕、代理" value={settingsQuery} onChange={event => setSettingsQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) setSettingsQuery(''); }} />
      </header>
      <div className="cfg-layout">
      <aside className="cfg-navigation" aria-label="设置分类">
        <Tabs items={TABS} value={tab} onChange={value => { selectTab(value); setSettingsQuery(''); }} orientation="vertical" label="配置分区" idPrefix="config" panelId="config-panel" className="cfg-tab-control" />
      </aside>

      <div className="cfg-panel" id="config-panel" role="tabpanel" aria-labelledby={searchTerm ? 'cfg-results-title' : `config-tab-${tab}`} tabIndex={0}>
        {searchTerm && <section className="cfg-search-results">
          <div className="cfg-section-heading"><h2 id="cfg-results-title">搜索结果</h2><output>找到 {matchingSections.length} 个相关分类</output></div>
          {matchingSections.map(item => <button key={item.id} className="cfg-search-result" onClick={() => { selectTab(item.id); configNavigation.focusSectionHeading(); }}>
            <strong>{item.label}</strong><span>{item.description}</span><span aria-hidden="true">›</span>
          </button>)}
          {!matchingSections.length && <div className="empty"><h3>没有匹配的设置</h3><p>试试“播放”“订阅”或“网络”等关键词。</p><button onClick={() => setSettingsQuery('')}>清除搜索</button></div>}
        </section>}
        <div className="cfg-section-content" hidden={Boolean(searchTerm)}>
        <div className="cfg-section-heading"><h2 id="cfg-section-title" tabIndex={-1}>{TABS.find(item => item.id === tab)?.label}</h2><p>{TABS.find(item => item.id === tab)?.description}</p></div>
        {configurationError && <div className="err" role="alert">{configurationError}</div>}
        <SubscriptionImportSection active={tab === 'sources'} flow={importFlow} />

      {/* ===== 一、订阅与源 ===== */}
      <SourceManagementSection
        active={tab === 'sources'}
        sources={sources}
        globallyBlockedKeys={cfg?.globallyBlockedSourceKeys}
        activeSourceKey={activeKey}
        profileId={cfg?.activeProfileId ?? ''}
        busy={busy}
        onRefresh={refresh}
        confirmDangerousAction={(message, title, confirmLabel) => dialog.confirm(message, { title, confirmLabel, tone: 'danger' })}
        sourcesPort={sourceManagementAdapter}
        diagnosticsPort={sourceDiagnosticsAdapter}
      />
      <LiveSourcesSection
        active={tab === 'sources'}
        lives={cfg?.lives ?? []}
        activeIndex={cfg?.ui.activeLiveIndex ?? 0}
        managementPort={liveSourcesManagementAdapter}
        onRefresh={refresh}
        confirmRemoval={(displayName) => dialog.confirm('确定删除直播线路「' + displayName + '」吗？\n删除后直播页顶部线路下拉将不再出现它（原始文件不会被改动）。', { title: '删除直播线路', confirmLabel: '删除', tone: 'danger' })}
      />
      {/* ===== 二、源健康与维护 ===== */}
      {tab === 'health' && (
      <>

      <SourceHealthAuditSection
        audit={sourceHealthAudit.audit}
        auditBusy={sourceHealthAudit.auditBusy}
        filter={sourceHealthAudit.filter}
        sources={sources}
        onRunAudit={() => void sourceHealthAudit.runAudit()}
        onDeleteFailedSources={() => void sourceHealthAudit.deleteFailedSources()}
        onFilterChange={sourceHealthAudit.setFilter}
        error={sourceHealthAudit.error}
        notice={sourceHealthAudit.notice}
      />
      {/* ===== 三、配置档案 ===== */}
      </>
      )}

      <CacheMaintenanceSection active={tab === 'health'} port={cacheMaintenanceAdapter} />

      {/* ===== 三、配置档案 ===== */}
      {tab === 'profiles' && (
      <>
      <SavedProfilesSection
        profiles={cfg?.profiles ?? []}
        activeProfileId={cfg?.activeProfileId ?? ''}
        busy={busy}
        onActivate={(profileId) => { void profileActivation.activate(profileId); }}
        activationError={profileActivation.error}
        onRefresh={refresh}
        managementPort={savedProfilesManagementAdapter}
      />

      <SubscriptionGroupsSection
        active={tab === 'profiles'}
        groups={cfg?.subscriptionGroups ?? []}
        profiles={cfg?.profiles ?? []}
        activeProfileId={cfg?.activeProfileId ?? ''}
        busy={busy}
        importRunning={importRunning}
        error={subscriptionGroupManagement.error}
        onRefresh={(groupUrl, groupName) => { void importFlow.startSubscriptionImport(groupUrl, groupName); }}
        onActivate={(profileId) => { void profileActivation.activate(profileId); }}
        onRemoveMember={(groupId, memberId, name) => { void subscriptionGroupManagement.removeMember(groupId, memberId, name); }}
        onResolveRefresh={(groupId, memberId, resolution) => { void subscriptionGroupManagement.resolveRefresh(groupId, memberId, resolution); }}
      />

      {/* 0b) 合并导出（多配置 → 去重 → 新 JSON，不写原文件） */}
      <MergeProfilesExportSection
        profiles={cfg?.profiles ?? []}
        selectedProfileIds={mergeExport.selectedProfileIds}
        message={mergeExport.message}
        onToggleProfile={mergeExport.toggleProfile}
        onExport={() => { void mergeExport.exportSelected(); }}
      />


      {/* ===== 四、凭据 ===== */}
      </>
      )}

      {/* ===== 四、凭据 ===== */}
      {tab === 'account' && (
        <AccountServicesSection
          subtitle={rendererSubtitleSettingsAdapter}
          metadata={rendererMetaSettingsAdapter}
          driveEvents={browserDriveAccountsEventsAdapter}
          metadataEvents={browserMetaSettingsEventsAdapter}
        />
      )}

      {tab === 'appearance' && <AppearanceSection />}

      {/* ===== 六、播放（去广告） ===== */}
      {tab === 'play' && <PlaybackSettingsSection active requestedSection={requestedTab === 'play' ? requestedSection : ''} preferences={playerPreferencesStorageAdapter} engineSettings={playerEngineSettingsAdapter} engineEvents={browserPlayerEngineSettingsEventsAdapter} playerSettings={playerSettingsAdapter} externalPlayers={externalPlayerDiscoveryAdapter} mpvSettings={mpvSettingsAdapter} mediaRuntimes={mediaRuntimeManagementAdapter} key={requestedTab === 'play' ? requestedSection : 'play'} />}

      {/* ===== 七、快捷键（老板键） ===== */}
      <PluginSettingsSection active={tab === 'plugins'} dependencies={pluginSettingsDependencies} />
      <ShortcutSettingsSection active={tab === 'shortcut'} port={shortcutSettingsAdapter} keymaps={pluginKeymapListAdapter} />

      <NetworkSection active={tab === 'network'} port={networkSettingsAdapter} />

      <StorageSettingsSection
        active={tab === 'storage'}
        port={storageSettingsAdapter}
        confirmRemoval={(message, options) => dialog.confirm(message, options)}
      />
      <BackupSettingsSection active={tab === 'backup'} backup={rendererBackupOperationsAdapter} storage={browserBackupStorageAdapter} />
      </div>
      </div>
      </div>
    </div>
  );
}
