import { useCallback } from 'react';
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
import { useConfigurationProfileActivation } from '../features/settings/useConfigurationProfileActivation';
import { useConfigSectionNavigation } from '../features/settings/useConfigSectionNavigation';
import { CONFIGURATION_SETTINGS_SECTIONS, type ConfigurationSettingsTab } from '../features/settings/application/configurationPagePresentation';
import { useConfigurationPagePresenter } from '../features/settings/useConfigurationPagePresenter';

const SETTINGS_ICONS: Record<ConfigurationSettingsTab, IconName> = {
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
  const navigateToTab = useCallback((tab: ConfigurationSettingsTab) => {
    setSearchParams({ tab }, { replace: true });
  }, [setSearchParams]);
  const page = useConfigurationPagePresenter({
    searchParams,
    navigateToTab,
    configuration: configurationSnapshotAdapter,
  });
  const {
    requestedSection,
    requestedTab,
    tab,
    busy,
    setBusy,
    configuration: cfg,
    refresh,
    configurationError,
    retryConfigurationLoad,
    settingsQuery,
    searchTerm,
    matchingSections,
    changeSettingsQuery,
    clearSettingsQuery,
    handleSearchKey,
    selectTab,
  } = page;
  const dialog = useAppDialog();

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
  const TABS = CONFIGURATION_SETTINGS_SECTIONS.map(item => ({ ...item, icon: <Icon name={SETTINGS_ICONS[item.id]} size={16} /> }));
  const configNavigation = useConfigSectionNavigation({ requestedSection, requestedTab, activeTab: tab });
  return (
    <div className="content cfg-content">
      <header className="page-heading cfg-page-heading">
        <div><h1>设置</h1><p>管理内容来源和应用偏好。</p></div>
        <input className="cfg-search" aria-label="搜索设置" placeholder="搜索设置，如字幕、代理" value={settingsQuery} onChange={event => changeSettingsQuery(event.target.value)} onKeyDown={event => handleSearchKey(event.key, event.nativeEvent.isComposing)} />
      </header>
      <div className="cfg-layout">
      <aside className="cfg-navigation" aria-label="设置分类">
        <Tabs items={TABS} value={tab} onChange={selectTab} orientation="vertical" label="配置分区" idPrefix="config" panelId="config-panel" className="cfg-tab-control" />
      </aside>

      <div className="cfg-panel" id="config-panel" role="tabpanel" aria-labelledby={searchTerm ? 'cfg-results-title' : `config-tab-${tab}`} tabIndex={0}>
        {searchTerm && <section className="cfg-search-results">
          <div className="cfg-section-heading"><h2 id="cfg-results-title">搜索结果</h2><output>找到 {matchingSections.length} 个相关分类</output></div>
          {matchingSections.map(item => <button key={item.id} className="cfg-search-result" onClick={() => { selectTab(item.id); configNavigation.focusSectionHeading(); }}>
            <strong>{item.label}</strong><span>{item.description}</span><span aria-hidden="true">›</span>
          </button>)}
          {!matchingSections.length && <div className="empty"><h3>没有匹配的设置</h3><p>试试“播放”“订阅”或“网络”等关键词。</p><button onClick={clearSettingsQuery}>清除搜索</button></div>}
        </section>}
        <div className="cfg-section-content" hidden={Boolean(searchTerm)}>
        <div className="cfg-section-heading"><h2 id="cfg-section-title" tabIndex={-1}>{TABS.find(item => item.id === tab)?.label}</h2><p>{TABS.find(item => item.id === tab)?.description}</p></div>
        {configurationError && <div className="err" role="alert"><span>{configurationError}</span><button type="button" onClick={() => { void retryConfigurationLoad(); }}>重试</button></div>}
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
      {tab === 'play' && <PlaybackSettingsSection active requestedSection={requestedTab === 'play' ? requestedSection : ''} preferences={playerPreferencesStorageAdapter} engineCatalog={playerEngineSettingsAdapter} engineActivation={playerEngineSettingsAdapter} enginePathSettings={playerEngineSettingsAdapter} engineEvents={browserPlayerEngineSettingsEventsAdapter} playerSettings={playerSettingsAdapter} externalPlayers={externalPlayerDiscoveryAdapter} mpvSettings={mpvSettingsAdapter} mediaRuntimes={mediaRuntimeManagementAdapter} key={requestedTab === 'play' ? requestedSection : 'play'} />}

      {/* ===== 七、快捷键（老板键） ===== */}
      <PluginSettingsSection active={tab === 'plugins'} dependencies={pluginSettingsDependencies} />
      <ShortcutSettingsSection active={tab === 'shortcut'} port={shortcutSettingsAdapter} keymaps={pluginKeymapListAdapter} />

      <NetworkSection active={tab === 'network'} port={networkSettingsAdapter} />

      <StorageSettingsSection
        active={tab === 'storage'}
        port={storageSettingsAdapter}
        confirmRemoval={(message, options) => dialog.confirm(message, options)}
      />
      {tab === 'backup' && <BackupSettingsSection backup={rendererBackupOperationsAdapter} storage={browserBackupStorageAdapter} />}
      </div>
      </div>
      </div>
    </div>
  );
}
