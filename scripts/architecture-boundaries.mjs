import { readdir, readFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { parse } from '@babel/parser';

const sourceRootArgument = process.argv.find((argument) => argument.startsWith('--source-root='))?.slice('--source-root='.length);
const sourceRoot = path.resolve(sourceRootArgument || 'src');
const rendererRoot = path.join(sourceRoot, 'renderer');
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']);
const nodeBuiltins = new Set(builtinModules.map((specifier) => specifier.replace(/^node:/, '')));
const rules = [
  {
    layer: 'shared',
    forbiddenLayers: new Set(['engine', 'main', 'renderer']),
    forbidElectron: true,
    description: 'shared contracts must stay independent of application layers and Electron',
  },
  {
    layer: 'engine',
    forbiddenLayers: new Set(['main', 'renderer']),
    forbidElectron: true,
    description: 'engine may depend on shared contracts, but not on main, renderer, or Electron',
  },
  {
    layer: 'renderer',
    forbiddenLayers: new Set(['main']),
    forbidElectron: true,
    description: 'renderer must reach main-process capabilities only through preload contracts',
  },
  {
    layer: 'main',
    forbiddenLayers: new Set(['renderer']),
    forbidElectron: false,
    description: 'main-process code must not import renderer implementation details',
  },
];
const opaqueFactoryConsumers = new Map([
  ['engine/spider/SpiderFactoryPort.ts', '../ports'],
  ['engine/spider/SpiderSourceRuntimeAdapter.ts', '../ports'],
  ['main/spider/SpiderSearchRuntimeReadinessAdapter.ts', '../../engine/ports'],
]);
const runtimeProviderForbiddenHostImports = new Map([
  ['engine/spider/SpiderRuntimeProvider.ts', '../ports'],
]);
const featureIpcContracts = new Map([
  ['main/ipc/configurationIpc.ts', '../../engine/config/ApiConfigParser'],
]);
const productionCompositionFacadeImports = new Map([
  ['main/index.ts', './spider/SpiderHost'],
  ['main/ipc/index.ts', '../spider/SpiderHost'],
]);
const rendererControllerForbiddenImports = new Map([
  ['renderer/features/home/useHomeSearchController.ts', new Set([
    '../../lib/uiMemory',
    '../../lib/searchWin',
    'react-router-dom',
  ])],
]);
const rendererHomeModelForbiddenImports = new Map([
  ['renderer/features/home/homePageModel.ts', new Set(['../../components/CascadeBar', './useHomeBrowseController'])],
  ['renderer/features/home/useHomeSourceSession.ts', new Set(['./useHomeBrowseController', './homePageModel'])],
  ['renderer/features/home/useHomePagePresenter.ts', new Set(['../../components/CascadeBar'])],
]);
const rendererHomePresenterForbiddenBrowserEffects = new Set([
  'renderer/features/home/useHomePagePresenter.ts',
]);
const rendererSettingsPageForbiddenBrowserEffects = new Set([
  'renderer/pages/ConfigPage.tsx',
]);
const rendererProfileActivationForbiddenAdapters = new Map([
  ['renderer/features/settings/application/activateConfigurationProfile.ts', new Set([
    '../../../api/client', '../adapters/profileActivationAdapter', 'react', 'react-router-dom',
  ])],
]);
const rendererThemeRegistryForbiddenInfrastructureImports = new Map([
  ['renderer/lib/theme.ts', new Set(['../api/client'])],
  ['renderer/features/theme/application/pluginThemeRegistry.ts', new Set(['../../../api/client'])],
]);
const rendererPurePreferenceMappingForbiddenImports = new Map([
  ['renderer/lib/uiPreferenceMapping.ts', new Set(['react', 'react-dom', '../api/client', 'electron'])],
]);
const rendererPassiveSettingsViewForbiddenImports = new Map([
  ['renderer/features/settings/PlaybackCompatibilitySettingsView.tsx', new Set([
    './usePlaybackCompatibilityPresenter', './application/playbackSettingsPorts', '../../api/client',
  ])],
]);
const rendererPassiveSettingsViews = new Set([
  'renderer/features/settings/PlaybackCompatibilitySettingsView.tsx',
  'renderer/features/settings/NetworkSettingsView.tsx',
  'renderer/features/settings/StorageSettingsView.tsx',
]);
const rendererFeatureControllerForbiddenViewImports = new Map([
  ['renderer/features/playback/useSkipSegmentsController.ts', new Set(['./SkipSegmentsControl'])],
]);
const rendererPlaybackControlFiles = new Set([
  'renderer/features/playback/DanmakuPanel.tsx',
  'renderer/features/playback/DlnaCastControl.tsx',
  'renderer/features/playback/PlayerAudioControl.tsx',
  'renderer/features/playback/PlayerKernelControl.tsx',
  'renderer/features/playback/PlayerPlaybackOptions.tsx',
  'renderer/features/playback/PlayerProgressBar.tsx',
  'renderer/features/playback/PlayerSuperResolutionControl.tsx',
  'renderer/features/playback/PlayerTechnicalBar.tsx',
  'renderer/features/playback/PlayerTransportControls.tsx',
  'renderer/features/playback/PlayerVolumeControl.tsx',
  'renderer/features/playback/SkipSegmentsControl.tsx',
  'renderer/features/playback/SubtitlePanel.tsx',
]);
const rendererSkipSegmentsControllerForbiddenImports = new Map([
  ['renderer/features/playback/useSkipSegmentsController.ts', new Set([
    '../../lib/modalScope', '../../lib/skipSegments', './adapters/skipSegmentsControllerAdapter',
  ])],
]);
const rendererControllerForbiddenPresentationImports = new Map([
  ['renderer/features/playback/useDanmakuController.ts', new Set([
    './presentation/formatDanmakuCandidateLabel',
  ])],
]);
const rendererPlaybackControllerForbiddenInfrastructureImports = new Map([
  ['renderer/features/playback/useDanmakuController.ts', new Set([
    '../../api/client', './danmakuSearch',
  ])],
]);
const rendererPlaybackSessionForbiddenInfrastructureImports = new Map([
  ['renderer/features/playback/useHtml5PlaybackSession.ts', new Set(['../../lib/uiMemory'])],
  ['renderer/features/playback/usePlaybackKernelSession.ts', new Set(['../../lib/uiMemory'])],
]);
const rendererAudioPlaybackForbiddenImports = new Map([
  ['renderer/components/AudioPlayer.tsx', new Set(['../lib/uiMemory', '../lib/modalScope'])],
  ['renderer/features/playback/useAudioPlaybackSession.ts', new Set([
    '../../lib/uiMemory', '../../lib/modalScope',
    './adapters/playerPlaybackPositionAdapter',
    './adapters/audioPlaybackMediaAdapter',
    './adapters/audioPlayerShortcutGuardAdapter',
    './adapters/audioPlayerInteractionAdapter',
  ])],
  ['renderer/features/playback/AudioPlayerView.tsx', new Set([
    './useAudioPlaybackSession',
    './adapters/playerPlaybackPositionAdapter',
    './adapters/audioPlayerShortcutGuardAdapter',
    './adapters/audioPlayerInteractionAdapter',
  ])],
]);
const rendererPlayerKeyboardShortcutsForbiddenImports = new Map([
  ['renderer/features/playback/usePlayerKeyboardShortcuts.ts', new Set([
    '../../lib/modalScope', './adapters/playerKeyboardShortcutsAdapter',
  ])],
]);
const rendererPlaybackSessionForbiddenRuntimeGlobals = new Set([
  'renderer/features/playback/useHtml5PlaybackSession.ts',
]);
const rendererAudioSessionForbiddenDom = new Set([
  'renderer/features/playback/useAudioPlaybackSession.ts',
]);
const rendererPlaybackWindowControlForbiddenImports = new Map([
  ['renderer/features/playback/usePlayerWindowControls.ts', new Set([
    '../../api/client',
    './adapters/playerWindowControlEventsAdapter',
    './adapters/playerKernelCommandsAdapter',
  ])],
]);
const rendererPlayerPreferencesForbiddenInfrastructureImports = new Map([
  ['renderer/features/playback/usePlayerPreferences.ts', new Set(['../../lib/playerPrefs'])],
  ['renderer/features/settings/PlaybackSettingsSection.tsx', new Set(['../../lib/playerPrefs', '../../api/client'])],
  ['renderer/features/settings/usePlaybackSettingsPresenter.ts', new Set([
    '../../lib/playerPrefs', '../../api/client', './adapters/playbackSettingsAdapters',
  ])],
]);
const rendererMediaRuntimeForbiddenInfrastructureImports = new Map([
  ['renderer/features/settings/useMediaRuntimeManagement.ts', new Set([
    '../../api/client', './adapters/playbackSettingsAdapters',
  ])],
  ['renderer/features/settings/MediaRuntimeDownloadsSection.tsx', new Set([
    '../../api/client', './adapters/playbackSettingsAdapters',
  ])],
]);
const rendererConfigurationSnapshotForbiddenImports = new Map([
  ['renderer/features/settings/useConfigurationSnapshotSession.ts', new Set([
    '../../api/client', './adapters/configurationSnapshotAdapter',
  ])],
]);
const rendererExternalPlayerSettingsForbiddenInfrastructureImports = new Map([
  ['renderer/features/settings/useExternalPlayerSettings.ts', new Set([
    '../../api/client', './adapters/playbackSettingsAdapters',
  ])],
]);
const rendererMpvSettingsForbiddenInfrastructureImports = new Map([
  ['renderer/features/settings/PlaybackCompatibilitySettingsSection.tsx', new Set([
    '../../api/client', './adapters/playbackSettingsAdapters',
  ])],
]);
const rendererPlayerAudioTracksForbiddenInfrastructureImports = new Map([
  ['renderer/features/playback/usePlayerAudioTracks.ts', new Set([
    '../../api/client', 'hls.js', './adapters/sessionAudioPreferenceMemoryAdapter',
  ])],
]);
const rendererPlayerHistoryProgressForbiddenImports = new Map([
  ['renderer/features/playback/usePlayerHistoryProgress.ts', new Set([
    '../../api/client', './adapters/playerHistoryProgressAdapter', '../../../lib/uiMemory',
  ])],
  ['renderer/features/playback/application/playerHistoryProgress.ts', new Set([
    'react', '../../../lib/uiMemory', '../adapters/playerHistoryProgressAdapter',
  ])],
]);
const rendererPlayerPageSessionForbiddenImports = new Map([
  ['renderer/pages/PlayerPage.tsx', new Set(['../api/client', '../lib/uiMemory', '../lib/historySource'])],
  ['renderer/pages/PlayerPageView.tsx', new Set([
    '../api/client', '../lib/uiMemory', '../lib/historySource',
    '../features/playback/adapters/playerPageSessionAdapter',
    '../features/playback/adapters/playerPageWindowAdapter',
    '../features/playback/adapters/playerHistoryProgressAdapter',
    '../features/playback/adapters/playerSourceMemoryAdapter',
  ])],
  ['renderer/components/TitleBarView.tsx', new Set([
    '../api/client', '../layouts/WindowTitleBar',
    '../features/windowTitleBar/adapters/windowTitleBarAdapter',
    '../features/windowTitleBar/useWindowTitleBarPresenter',
  ])],
  ['renderer/features/playback/usePlayerPageSession.ts', new Set([
    '../../api/client', '../../../api/client', './adapters/playerPageSessionAdapter',
    './adapters/playerHistoryProgressAdapter', './adapters/playerSourceMemoryAdapter',
  ])],
  ['renderer/features/playback/usePlayerPageEvents.ts', new Set([
    '../../api/client', './adapters/playerPageSessionAdapter',
  ])],
  ['renderer/features/playback/usePlayerPageWindow.ts', new Set([
    '../../api/client', './adapters/playerPageWindowAdapter',
  ])],
]);
const rendererPlayerSessionConsumerPorts = new Map([
  ['renderer/features/playback/application/resolvePlayerPlayback.ts', 'PlayerPlaybackResolutionPort'],
  ['renderer/features/playback/application/hydratePlayerInit.ts', 'PlayerInitHydrationPort'],
  ['renderer/features/playback/usePlayerPageEvents.ts', 'PlayerPageEventsPort'],
]);
const rendererUpdateGateForbiddenImports = new Map([
  ['renderer/components/UpdateGate.tsx', new Set(['../api/client'])],
  ['renderer/components/UpdateGateView.tsx', new Set(['../api/client', '../features/updates/adapters/updateGateAdapter'])],
  ['renderer/features/updates/useUpdateGatePresenter.ts', new Set(['../../api/client', './adapters/updateGateAdapter'])],
  ['renderer/features/updates/application/updateGate.ts', new Set(['react', '../../../api/client', '../adapters/updateGateAdapter'])],
]);
const rendererHistoryUpdateForbiddenImports = new Map([
  ['renderer/features/history/application/detectHistoryUpdates.ts', new Set([
    'react', '../../../api/client', '../../../lib/uiMemory', '../adapters/historyUpdateAdapter',
  ])],
]);
const rendererHistoryPageForbiddenImports = new Map([
  ['renderer/pages/HistoryPage.tsx', new Set([
    '../api/client', '../lib/uiMemory', '../lib/historySource', '../lib/externalPlay', '../lib/detailWin',
  ])],
  ['renderer/pages/HistoryPageView.tsx', new Set([
    '../api/client', '../lib/uiMemory', '../lib/historySource', '../lib/externalPlay', '../lib/detailWin',
    '../features/history/adapters/historyPageAdapters', '../features/history/useHistoryPagePresenter',
  ])],
  ['renderer/features/history/useHistoryPagePresenter.ts', new Set([
    '../../api/client', '../../lib/uiMemory', '../../lib/externalPlay', '../../lib/detailWin',
    './adapters/historyPageAdapters',
  ])],
  ['renderer/features/history/application/historyPage.ts', new Set([
    'react', '../../../api/client', '../../../lib/uiMemory', '../../../lib/externalPlay',
    '../../../lib/detailWin', '../adapters/historyPageAdapters',
  ])],
]);
const rendererFavoritesPageForbiddenImports = new Map([
  ['renderer/pages/FavoritesPage.tsx', new Set([
    '../api/client', '../lib/favorites', '../lib/detailWin', '../lib/historySource',
  ])],
  ['renderer/pages/FavoritesPageView.tsx', new Set([
    '../api/client', '../lib/favorites', '../lib/detailWin', '../lib/historySource',
    '../features/favorites/adapters/favoritesPageAdapter', '../features/favorites/useFavoritesPagePresenter',
  ])],
  ['renderer/features/favorites/useFavoritesPagePresenter.ts', new Set([
    '../../api/client', '../../lib/favorites', '../../lib/detailWin', '../../lib/historySource',
    './adapters/favoritesPageAdapter',
  ])],
  ['renderer/features/favorites/application/favoritesPage.ts', new Set([
    'react', '../../../api/client', '../../../lib/favorites', '../adapters/favoritesPageAdapter',
  ])],
]);
const rendererStoragePageForbiddenImports = new Map([
  ['renderer/pages/StoragePage.tsx', new Set(['../api/client'])],
  ['renderer/pages/StoragePageView.tsx', new Set([
    '../api/client', '../features/storage/adapters/storageBrowserAdapter', '../features/storage/useStorageBrowserPresenter',
  ])],
  ['renderer/features/storage/useStorageBrowserPresenter.ts', new Set(['../../api/client', './adapters/storageBrowserAdapter'])],
  ['renderer/features/storage/application/storageBrowser.ts', new Set([
    'react', '../../../api/client', '../adapters/storageBrowserAdapter',
  ])],
]);
const rendererWindowTitleBarForbiddenImports = new Map([
  ['renderer/components/TitleBarView.tsx', new Set([
    '../features/windowTitleBar/adapters/windowTitleBarAdapter',
    '../features/windowTitleBar/useWindowTitleBarPresenter',
  ])],
  ['renderer/layouts/WindowTitleBar.tsx', new Set(['../api/client'])],
  ['renderer/features/windowTitleBar/useWindowTitleBarPresenter.ts', new Set([
    '../../api/client', './adapters/windowTitleBarAdapter',
  ])],
  ['renderer/features/windowTitleBar/application/windowTitleBar.ts', new Set([
    'react', '../../../api/client', '../adapters/windowTitleBarAdapter',
  ])],
]);
const rendererPageErrorBoundaryForbiddenImports = new Map([
  ['renderer/components/PageErrorBoundary.tsx', new Set([
    '../api/client', '../features/diagnostics/adapters/pageErrorReporterAdapter',
  ])],
]);
const rendererPluginSlotForbiddenImports = new Map([
  ['renderer/components/PluginSlot.tsx', new Set(['../api/client', '../lib/pluginSlots', '../lib/pluginCommands'])],
  ['renderer/components/PluginSlotView.tsx', new Set([
    '../api/client', '../lib/pluginSlots', '../lib/pluginCommands',
    '../features/plugins/adapters/pluginSlotAdapter', '../features/plugins/usePluginSlotPresenter',
  ])],
  ['renderer/features/plugins/usePluginSlotPresenter.ts', new Set([
    '../../api/client', '../../lib/pluginSlots', '../../lib/pluginCommands', './adapters/pluginSlotAdapter',
  ])],
  ['renderer/features/plugins/application/pluginSlots.ts', new Set([
    'react', '../../../api/client', '../../../lib/pluginSlots', '../../../lib/pluginCommands',
    '../adapters/pluginSlotAdapter',
  ])],
]);
const rendererSearchPanelForbiddenImports = new Map([
  ['renderer/components/SearchPanel.tsx', new Set([
    '../api/client', '../lib/searchHistory', '../lib/searchWin',
  ])],
  ['renderer/components/SearchPanelView.tsx', new Set([
    '../api/client', '../lib/searchHistory', '../lib/searchWin', '../features/search/adapters/searchPanelAdapters',
  ])],
  ['renderer/features/search/useSearchPanelPresenter.ts', new Set([
    '../../api/client', '../../lib/searchHistory', '../../lib/searchWin', './adapters/searchPanelAdapters',
  ])],
  ['renderer/features/search/application/searchPanel.ts', new Set([
    'react', '../../../api/client', '../../../lib/searchHistory', '../adapters/searchPanelAdapters',
  ])],
]);
const rendererHomePageForbiddenInfrastructureImports = new Map([
  ['renderer/pages/HomePage.tsx', new Set(['../api/client'])],
  ['renderer/features/home/HomePageView.tsx', new Set([
    '../../api/client', '../../pages/HomePage', './adapters/homePageAdapters', './useHomePagePresenter',
  ])],
  ['renderer/features/home/homePageViewModel.ts', new Set(['react', '../../api/client', './useHomeDriveBinding'])],
  ['renderer/features/home/useHomePagePresenter.ts', new Set([
    '../../api/client', '../../lib/uiMemory', './adapters/homePageAdapters', './adapters/homePageMemoryAdapter',
    '../../lib/uiPrefs', './adapters/homeSearchNavigationAdapter', './adapters/rendererSearchClock', 'react-router-dom',
  ])],
  ['renderer/features/home/useHomeSourceSession.ts', new Set([
    '../../api/client', '../../lib/uiMemory', './adapters/homePageAdapters', './adapters/homePageMemoryAdapter',
    './adapters/homeSourceSessionEventsAdapter',
  ])],
  ['renderer/features/home/useHomeSearchController.ts', new Set(['../../api/client', './adapters/rendererSearchClock'])],
  ['renderer/features/home/application/homePorts.ts', new Set(['react', '../../../api/client'])],
]);
const rendererHomePresentationForbiddenImports = new Map([
  ['renderer/features/home/homePageViewModel.ts', new Set(['react', './HomeBrowseResults', './HomeSearchResults'])],
  ['renderer/features/home/HomeBrowseResults.tsx', new Set(['./useHomeBrowseController'])],
]);
const rendererHomeBrowseControllerForbiddenImports = new Map([
  ['renderer/features/home/useHomeBrowseController.ts', new Set(['../../lib/sessionSort', '../../lib/uiPrefs'])],
]);
const rendererHomeSearchApplicationForbiddenImports = new Map([
  ['renderer/features/home/application/HomeSearchWorkflow.ts', new Set([
    'react', 'react-router-dom', '../useHomeBrowseController', '../useHomePagePresenter', '../../../api/client',
  ])],
]);
const rendererSubtitleSearchForbiddenInfrastructureImports = new Map([
  ['renderer/features/playback/useSubtitleSearch.ts', new Set(['../../api/client'])],
]);
const rendererSubtitlePlaybackForbiddenInfrastructureImports = new Map([
  ['renderer/features/playback/useSubtitlePlayback.ts', new Set(['../../api/client'])],
]);
const rendererSubscriptionImportForbiddenInfrastructureImports = new Map([
  ['renderer/features/subscriptions/useSubscriptionImport.ts', new Set(['../../api/client'])],
  ['renderer/features/subscriptions/useSubscriptionImportJobs.ts', new Set(['../../api/client'])],
  ['renderer/features/subscriptions/useLocalSourceImport.ts', new Set(['../../api/client'])],
]);
const rendererLiveSourcesForbiddenInfrastructureImports = new Map([
  ['renderer/features/subscriptions/LiveSourcesSection.tsx', new Set(['../../api/client', './adapters/liveSourcesAdapter'])],
  ['renderer/features/subscriptions/useLiveSourcesManagement.ts', new Set(['../../api/client', './adapters/liveSourcesAdapter'])],
]);
const rendererSavedProfilesForbiddenInfrastructureImports = new Map([
  ['renderer/features/subscriptions/SavedProfilesSection.tsx', new Set(['../../api/client', './adapters/savedProfilesManagementAdapter'])],
  ['renderer/features/subscriptions/useSavedProfilesManagement.ts', new Set(['../../api/client', './adapters/savedProfilesManagementAdapter'])],
]);
const rendererProfileSwitcherForbiddenInfrastructureImports = new Map([
  ['renderer/features/subscriptions/ProfileSwitcher.tsx', new Set(['../../api/client', '../../lib/configEvents', './adapters/profileSwitcherAdapter'])],
  ['renderer/features/subscriptions/useProfileSwitcher.ts', new Set(['../../api/client', '../../lib/configEvents', './adapters/profileSwitcherAdapter'])],
]);
const rendererSubscriptionGroupManagementForbiddenImports = new Map([
  ['renderer/features/subscriptions/SubscriptionGroupsSection.tsx', new Set([
    '../../api/client', './adapters/subscriptionGroupManagementAdapter', './useSubscriptionGroupManagement',
  ])],
  ['renderer/features/subscriptions/useSubscriptionGroupManagement.ts', new Set([
    '../../api/client', './adapters/subscriptionGroupManagementAdapter',
  ])],
  ['renderer/features/subscriptions/application/subscriptionGroupManagement.ts', new Set([
    'react', '../../../api/client', '../adapters/subscriptionGroupManagementAdapter',
  ])],
]);
const rendererSourcePickerForbiddenInfrastructureImports = new Map([
  ['renderer/components/SourcePicker.tsx', new Set(['../api/client', '../lib/configEvents', '../features/subscriptions/adapters/sourcePickerAdapter'])],
  ['renderer/features/subscriptions/useSourcePickerController.ts', new Set(['../../api/client', '../../../api/client', '../adapters/sourcePickerAdapter', './adapters/sourcePickerAdapter', '../../../lib/configEvents'])],
]);
const rendererDriveBindingForbiddenInfrastructureImports = new Map([
  ['renderer/components/DriveBindModal.tsx', new Set(['../api/client', '../features/driveBinding/adapters/driveBindingAdapter'])],
  ['renderer/components/DriveLogin.tsx', new Set(['../api/client'])],
  ['renderer/components/UcTvBind.tsx', new Set(['../api/client'])],
  ['renderer/features/driveBinding/useDriveCredentialManagement.ts', new Set(['../../../api/client', './adapters/driveBindingAdapter', '../adapters/driveBindingAdapter'])],
  ['renderer/features/driveBinding/application/driveBindingPorts.ts', new Set(['../../../api/client', '../adapters/driveBindingAdapter'])],
]);
const rendererDlnaCastingForbiddenInfrastructureImports = new Map([
  ['renderer/features/playback/DlnaCastControl.tsx', new Set(['../../api/client', './application/dlnaCasting', './useDlnaCastPresenter'])],
  ['renderer/features/playback/useDlnaCastPresenter.ts', new Set(['../../api/client', './adapters/dlnaCastingAdapter'])],
  ['renderer/features/playback/application/dlnaCasting.ts', new Set(['../../../api/client', '../adapters/dlnaCastingAdapter'])],
]);
const rendererMediaDiagnosticsForbiddenInfrastructureImports = new Map([
  ['renderer/features/playback/useMediaDiagnostics.ts', new Set(['../../api/client', './adapters/mediaDiagnosticsAdapter'])],
  ['renderer/features/playback/useHtml5PlaybackSession.ts', new Set(['../../api/client', './adapters/mediaDiagnosticsAdapter'])],
  ['renderer/features/playback/application/mediaDiagnostics.ts', new Set(['../../../api/client', '../adapters/mediaDiagnosticsAdapter'])],
]);
const rendererPlayerFullscreenForbiddenInfrastructureImports = new Map([
  ['renderer/features/playback/usePlayerFullscreen.ts', new Set(['../../api/client', './adapters/playerFullscreenAdapter'])],
  ['renderer/features/playback/application/playerFullscreen.ts', new Set(['../../../api/client', '../adapters/playerFullscreenAdapter'])],
]);
const rendererPluginPlaybackEnginesForbiddenInfrastructureImports = new Map([
  ['renderer/features/playback/usePluginPlaybackEngines.ts', new Set(['../../api/client', './adapters/pluginPlaybackEnginesAdapter'])],
  ['renderer/features/playback/application/pluginPlaybackEngines.ts', new Set(['../../../api/client', '../adapters/pluginPlaybackEnginesAdapter'])],
]);
const rendererLivePlaybackForbiddenInfrastructureImports = new Map([
  ['renderer/features/live/useLivePlayback.ts', new Set(['../../../api/client'])],
]);
const rendererLiveExportForbiddenInfrastructureImports = new Map([
  ['renderer/pages/LivePage.tsx', new Set(['../api/client'])],
  ['renderer/features/live/useLiveExportPresenter.ts', new Set(['../../api/client', './adapters/liveExportAdapter'])],
  ['renderer/features/live/application/liveExport.ts', new Set(['react', '../../../api/client', '../adapters/liveExportAdapter'])],
]);
const rendererMovieSourcesForbiddenInfrastructureImports = new Map([
  ['renderer/features/discovery/useMovieSources.ts', new Set(['../../api/client'])],
  ['renderer/features/detail/MovieSourcesPanel.tsx', new Set(['../../api/client'])],
]);
const rendererDiscoveryForbiddenInfrastructureImports = new Map([
  ['renderer/features/discovery/useDiscoverController.ts', new Set(['../../api/client'])],
  ['renderer/features/discovery/useDiscoverExplore.ts', new Set(['../../api/client'])],
  ['renderer/features/discovery/useDiscoverBoard.ts', new Set(['../../api/client'])],
  ['renderer/pages/DiscoverDetailPage.tsx', new Set(['../api/client'])],
  ['renderer/pages/DiscoverDetailPageView.tsx', new Set(['../api/client', '../features/discovery/adapters/discoverDetailMetadataAdapter'])],
  ['renderer/features/discovery/useDiscoverDetailMetadata.ts', new Set(['../../api/client', './adapters/discoverDetailMetadataAdapter'])],
  ['renderer/features/discovery/application/discoverDetailMetadata.ts', new Set(['react', '../../../api/client', '../adapters/discoverDetailMetadataAdapter'])],
  ['renderer/pages/BoardsPage.tsx', new Set(['../api/client'])],
  ['renderer/features/discovery/components/BoardPreviewCard.tsx', new Set(['../../../api/client'])],
]);
const rendererDetailDataForbiddenInfrastructureImports = new Map([
  ['renderer/pages/DetailPage.tsx', new Set(['../api/client'])],
  ['renderer/features/detail/useDetailDataController.ts', new Set(['../../api/client', '../../lib/uiMemory'])],
]);
const rendererDetailScrollForbiddenImports = new Map([
  ['renderer/pages/DetailPage.tsx', new Set(['../lib/uiMemory'])],
  ['renderer/features/detail/useDetailScrollMemory.ts', new Set(['../../../lib/uiMemory', './adapters/detailScrollMemoryAdapter'])],
  ['renderer/features/detail/application/detailScrollMemory.ts', new Set(['react', '../../../lib/uiMemory', '../adapters/detailScrollMemoryAdapter'])],
]);
const rendererDetailBackdropForbiddenInfrastructureImports = new Map([
  ['renderer/features/detail/useDetailBackdrop.ts', new Set(['../../api/client', './adapters/detailBackdropAdapter'])],
  ['renderer/features/detail/application/detailBackdrop.ts', new Set([
    'react', '../../../api/client', '../adapters/detailBackdropAdapter',
  ])],
  ['renderer/features/detail/useDetailFavoriteMetadata.ts', new Set([
    '../../api/client', './adapters/detailFavoriteMetadataAdapter',
  ])],
  ['renderer/features/detail/application/detailFavoriteMetadata.ts', new Set([
    'react', '../../../api/client', '../adapters/detailFavoriteMetadataAdapter',
  ])],
]);
const rendererDetailPlaybackForbiddenInfrastructureImports = new Map([
  ['renderer/features/detail/useDetailPlaybackController.ts', new Set(['../../api/client', '../../lib/uiMemory'])],
]);
const rendererDetailNavigationApplicationForbiddenImports = new Map([
  ['renderer/features/detail/application/detailNavigation.ts', new Set([
    'react', '../../../api/client', '../adapters/detailWindowNavigationAdapter',
  ])],
]);
const rendererDisplayPreferencesForbiddenImports = new Map([
  ['renderer/features/display/application/displayPreferences.ts', new Set([
    'react', '../../../api/client', '../../../lib/uiPrefs', '../../../lib/preferenceStore',
    '../adapters/displayPreferencesAdapter',
  ])],
  ['renderer/features/display/presentation/useUiScaleState.ts', new Set(['../adapters/displayPreferencesAdapter'])],
]);
const rendererSearchWindowApplicationForbiddenImports = new Map([
  ['renderer/features/search/application/searchWindowNavigation.ts', new Set([
    'react', '../../../api/client', '../../../lib/uiPrefs', '../adapters/searchWindowNavigationAdapter',
  ])],
]);
const rendererBrowserStorageForbiddenGlobals = new Set([
  'renderer/features/subscriptions/useSubscriptionImportJobs.ts',
  'renderer/features/live/useLivePlayback.ts',
]);
const rendererBrowserStorageAdapterFiles = new Set([
  'renderer/lib/favorites.ts',
  'renderer/lib/playerPrefs.ts',
  'renderer/lib/preferenceStore.ts',
  'renderer/lib/searchHistory.ts',
  'renderer/features/playback/adapters/skipSegmentsControllerAdapter.ts',
  'renderer/lib/storageEpoch.ts',
  'renderer/lib/uiMemory.ts',
]);
const rendererWindowEventForbiddenGlobals = new Set([
  'renderer/features/live/useLivePlayback.ts',
]);
const rendererCoverWorkflowForbiddenBrowserGlobals = new Set([
  'renderer/features/covers/useCovers.ts',
]);
const rendererSuperResolutionForbiddenInfrastructureImports = new Map([
  ['renderer/features/playback/useSuperResolution.ts', new Set(['../../api/client'])],
]);
const rendererSuperResolutionUseCaseForbiddenImports = new Map([
  ['renderer/features/playback/application/superResolutionUseCases.ts', new Set(['react', '../../../api/client'])],
]);
const rendererPresenterForbiddenImports = new Map([
  ['renderer/features/playback/VideoPlayerPresenter.ts', new Set(['../../api/client', '../../lib/externalPlay'])],
]);
const rendererPlaybackInfrastructureForbiddenImports = new Map([
  ['renderer/features/playback/VideoPlayerPresenter.ts', new Set([
    './htmlMediaSourceAdapter',
    './adapters/playerPreferencesStorageAdapter',
    './adapters/playerAudioTracksAdapter',
    './adapters/playerKernelCommandsAdapter',
    './adapters/playerRuntimeEventsAdapter',
    './adapters/driveBindingAdapters',
    './adapters/mpvPlaybackAdapters',
    './playerKernelWindowAdapter',
    './adapters/playerWindowAdapter',
    './adapters/danmakuControllerAdapter',
    './adapters/playerClipboardAdapter',
  ])],
  ['renderer/features/playback/application/playerClipboard.ts', new Set([
    'react', '../../../api/client', '../adapters/playerClipboardAdapter',
  ])],
  ['renderer/features/playback/usePlayerKernelSelection.ts', new Set([
    './adapters/mpvPlaybackAdapters',
  ])],
]);
const rendererSettingsSectionForbiddenInfrastructureImports = new Map([
  ['renderer/features/settings/AccountServicesSection.tsx', new Set(['../../api/client'])],
  ['renderer/features/settings/BackupSettingsSection.tsx', new Set(['../../api/client'])],
  ['renderer/features/settings/CacheMaintenanceSection.tsx', new Set(['../../api/client'])],
  ['renderer/features/settings/NetworkSection.tsx', new Set(['../../api/client'])],
  ['renderer/features/settings/StorageSettingsSection.tsx', new Set(['../../api/client'])],
  ['renderer/features/settings/ShortcutSettingsSection.tsx', new Set(['../../api/client'])],
  ['renderer/features/settings/PluginKeymapList.tsx', new Set(['../../api/client'])],
  ['renderer/features/settings/SourceManagementSection.tsx', new Set(['../../api/client'])],
  ['renderer/features/settings/SourceDiagnosticsSection.tsx', new Set(['../../api/client'])],
  ['renderer/features/settings/PlayerEngineSettings.tsx', new Set(['../../api/client'])],
  ['renderer/features/settings/PluginSettingsSection.tsx', new Set([
    '../../api/client', '../../lib/theme', '../../lib/pluginCommands',
  ])],
]);
const subscriptionImportApplicationForbiddenConcreteImports = new Set([
  './SubscriptionAutoRefreshService', './SubscriptionImportCoordinator', './SubscriptionImportService',
]);
const rendererConfigurationPageForbiddenInfrastructureImports = new Map([
  ['renderer/pages/ConfigPage.tsx', new Set(['../api/client'])],
  ['renderer/features/settings/application/configurationPagePorts.ts', new Set([
    'react', '../../../../api/client', '../adapters/configurationSnapshotAdapter', '../adapters/profileActivationAdapter',
  ])],
]);
const rendererSourceHealthAuditForbiddenImports = new Map([
  ['renderer/features/settings/SourceHealthAuditSection.tsx', new Set([
    '../../api/client', './adapters/sourceHealthAuditAdapter', './useSourceHealthAuditPresenter',
  ])],
  ['renderer/features/settings/useSourceHealthAuditPresenter.ts', new Set([
    '../../api/client', './adapters/sourceHealthAuditAdapter',
  ])],
  ['renderer/features/settings/application/sourceHealthAudit.ts', new Set([
    'react', '../../../../api/client', '../adapters/sourceHealthAuditAdapter',
  ])],
]);
const rendererMergeProfileExportForbiddenImports = new Map([
  ['renderer/features/settings/MergeProfilesExportSection.tsx', new Set([
    '../../api/client', './adapters/mergeProfileExportAdapter', './useMergeProfileExportPresenter',
  ])],
  ['renderer/features/settings/useMergeProfileExportPresenter.ts', new Set([
    '../../api/client', './adapters/mergeProfileExportAdapter',
  ])],
  ['renderer/features/settings/application/mergeProfileExport.ts', new Set([
    'react', '../../../api/client', '../adapters/mergeProfileExportAdapter',
  ])],
]);
const rendererCoverLookupForbiddenImports = new Map([
  ['renderer/features/covers/useCovers.ts', new Set([
    '../../api/client', './adapters/coverLookupAdapter',
  ])],
  ['renderer/features/covers/CoverLookupContext.tsx', new Set([
    '../api/client', './adapters/coverLookupAdapter',
  ])],
  ['renderer/features/covers/application/coverLookupPort.ts', new Set([
    'react', '../../../api/client', '../adapters/coverLookupAdapter',
  ])],
]);
const rendererPluginKeymapsForbiddenImports = new Map([
  ['renderer/features/plugins/usePluginKeymaps.ts', new Set([
    '../../../api/client', './adapters/pluginKeymapAdapter',
  ])],
  ['renderer/features/plugins/PluginKeymapsContext.tsx', new Set([
    '../../api/client', './adapters/pluginKeymapAdapter',
  ])],
  ['renderer/features/plugins/application/pluginKeymapPort.ts', new Set([
    'react', '../../../api/client', '../adapters/pluginKeymapAdapter',
  ])],
  ['renderer/features/plugins/application/keymapMatching.ts', new Set([
    'react', '../../../api/client', '../adapters/pluginKeymapAdapter',
  ])],
]);
const rendererPluginCommandForbiddenImports = new Map([
  ['renderer/features/plugins/PluginCommandContext.tsx', new Set([
    '../../api/client', './adapters/pluginCommandAdapter',
  ])],
  ['renderer/features/plugins/application/pluginCommand.ts', new Set([
    'react', '../../../api/client', '../adapters/pluginCommandAdapter', '../../../lib/theme', '../../../lib/themeTokens',
  ])],
]);
const rendererPlayerEpisodeHistoryForbiddenImports = new Map([
  ['renderer/features/playback/application/recordPlayerEpisode.ts', new Set([
    'react', '../../../api/client', '../adapters/playerHistoryProgressAdapter', '../adapters/playerSourceMemoryAdapter',
  ])],
]);
const rendererPresenterForbiddenFeatureImports = new Map([
  ['renderer/features/playback/VideoPlayerPresenter.ts', new Set([
    '../../components/AppDialog', '../../lib/pluginCommands', '../plugins/usePluginKeymaps', '../plugins/PluginCommandContext',
  ])],
]);
const rendererPresenterForbiddenSessionImports = new Map([
  ['renderer/features/playback/VideoPlayerPresenter.ts', new Set([
    './useHtml5PlaybackSession', './usePlaybackKernelSession', './useMediaDiagnostics',
  ])],
]);
const rendererPresenterForbiddenKernelSelectionImports = new Map([
  ['renderer/features/playback/VideoPlayerPresenter.ts', new Set([
    './usePluginPlaybackEngines', './application/playerKernelDecision',
  ])],
]);
const rendererPresenterForbiddenPanelImports = new Map([
  ['renderer/features/playback/VideoPlayerPresenter.ts', new Set([
    './usePlayerPanelCoordinator', './usePlayerControlsVisibility',
    '../../lib/useHoverDelay', '../../lib/usePlayerPanelPosition',
  ])],
]);
const rendererPresenterForbiddenViewImports = new Map([
  ['renderer/features/playback/VideoPlayerPresenter.ts', new Set(['./PlayerControlsBar', './PlayerContextMenu'])],
]);
const rendererPresentationModelForbiddenImports = new Map([
  ['renderer/features/playback/presentation/PlayerControlsViewModel.ts', new Set([
    '../PlayerAudioControl', '../DanmakuPanel', '../DlnaCastControl', '../PlayerPlaybackOptions',
    '../PlayerProgressBar', '../PlayerSuperResolutionControl', '../PlayerTechnicalBar',
    '../PlayerTransportControls', '../PlayerVolumeControl', '../SkipSegmentsControl',
    '../SubtitlePanel', '../PlayerKernelControl', '../PlayerControlsBar',
  ])],
]);
const rendererPresentationModelForbiddenHookImports = new Map([
  ['renderer/features/playback/presentation/PlayerControlsViewModel.ts', new Set([
    '../useMpvTechnicalState', '../usePluginPlaybackEngines', '../useSuperResolution',
  ])],
]);
const rendererPresentationModelFrameworkIndependent = new Set([
  'renderer/features/playback/presentation/PlayerControlsViewModel.ts',
  'renderer/features/playback/presentation/AudioPlayerModel.ts',
]);
const rendererPlaybackViewForbiddenDomainHelpers = new Map([
  ['renderer/features/playback/DanmakuPanel.tsx', new Set([
    '../../../engine/danmaku/endpoints', '../../../engine/danmaku/normalizeQuery',
  ])],
  ['renderer/features/playback/SubtitlePanel.tsx', new Set(['../../../engine/subtitle/normalizeQuery'])],
]);

const runtimeFactoryForbiddenImports = new Map([
  ['engine/spider/SpiderFactory.ts', new Set([
    '../js/JsSpider',
    './JarSpider',
    './PySpider',
  ])],
]);
const concreteJarBridgeForbiddenImports = new Map([
  ['engine/spider/JarSpider.ts', new Set(['./JarSpiderBridge'])],
  ['engine/spider/SpiderFactory.ts', new Set(['./JarSpiderBridge'])],
  ['engine/spider/createBuiltinSpiderRuntimeProviders.ts', new Set(['./JarSpiderBridge'])],
  ['main/spider/createSpiderHostServices.ts', new Set(['../../engine/spider/JarSpiderBridge'])],
]);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    return sourceExtensions.has(path.extname(entry.name)) ? [fullPath] : [];
  }));
  return nested.flat();
}

function moduleSpecifiers(sourceFile) {
  const specifiers = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    const source = node.source?.value;
    if (typeof source === 'string' && ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type)) {
      specifiers.push(source);
    } else if (node.type === 'CallExpression' && node.callee?.type === 'Import') {
      const value = node.arguments?.[0]?.value;
      if (typeof value === 'string') specifiers.push(value);
    } else if (node.type === 'CallExpression' &&
        (node.callee?.type === 'Identifier' && node.callee.name === 'require' ||
          node.callee?.type === 'MemberExpression' && node.callee.object?.name === 'module' && node.callee.property?.name === 'require')) {
      const argument = node.arguments?.[0];
      if (argument?.type === 'StringLiteral') specifiers.push(argument.value);
    } else if (node.type === 'TSImportType') {
      const value = node.argument?.value;
      if (typeof value === 'string') specifiers.push(value);
    }
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'start', 'end', 'extra', 'comments', 'leadingComments', 'trailingComments'].includes(key)) continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(sourceFile);
  return specifiers;
}

function targetLayer(importerPath, specifier) {
  if (!specifier.startsWith('.')) return null;
  const resolved = path.resolve(path.dirname(importerPath), specifier);
  const relative = path.relative(sourceRoot, resolved).split(path.sep);
  return relative[0] || null;
}

function rendererArea(importerPath, specifier) {
  if (!specifier.startsWith('.')) return null;
  const resolved = path.resolve(path.dirname(importerPath), specifier);
  const relative = path.relative(rendererRoot, resolved).split(path.sep);
  return { feature: relative[0] === 'features', page: relative[0] === 'pages' };
}

function isNodeBuiltin(specifier) {
  const normalized = specifier.replace(/^node:/, '');
  return [...nodeBuiltins].some((builtin) => normalized === builtin || normalized.startsWith(`${builtin}/`));
}

function browserStorageAccesses(sourceFile) {
  const accesses = [];
  const propertyName = (member) => member?.computed
    ? member.property?.type === 'StringLiteral' ? member.property.value : null
    : member.property?.name;
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (['MemberExpression', 'OptionalMemberExpression'].includes(node.type)) {
      const property = propertyName(node);
      const object = node.object;
      const isGlobalStorage = ['localStorage', 'sessionStorage'].includes(property) &&
        object?.type === 'Identifier' && ['window', 'globalThis', 'self'].includes(object.name);
      const isStorageObject = object?.type === 'Identifier' && ['localStorage', 'sessionStorage'].includes(object.name);
      if (isGlobalStorage || isStorageObject) accesses.push(node);
    }
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'start', 'end', 'extra', 'comments', 'leadingComments', 'trailingComments'].includes(key)) continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(sourceFile);
  return accesses;
}

const violations = [];
const pythonSpiderForbiddenImports = new Set(['node:fs', 'node:path', 'node:url', '../util/md5']);
for (const filePath of await sourceFiles(sourceRoot)) {
  const relativeFile = path.relative(sourceRoot, filePath);
  const layer = relativeFile.split(path.sep)[0];
  const rule = rules.find((candidate) => candidate.layer === layer);
  if (!rule) continue;
  const source = await readFile(filePath, 'utf8');
  const normalizedSourcePath = relativeFile.split(path.sep).join('/');
  const readsDesktopPreloadApi = /\bwindow\s*\.\s*api\b/.test(source);
  const isRendererPreloadBoundary = normalizedSourcePath === 'renderer/api/client.ts' ||
    normalizedSourcePath === 'renderer/lib/preferenceStore.ts' ||
    /^renderer\/features\/.+\/adapters\/[^/]+\.tsx?$/.test(normalizedSourcePath);
  if (layer === 'renderer' && readsDesktopPreloadApi && !isRendererPreloadBoundary) {
    violations.push(`${normalizedSourcePath}: renderer preload access belongs in the typed API client, a feature adapter, or the preference persistence boundary`);
  }
  const requiredSessionPort = rendererPlayerSessionConsumerPorts.get(normalizedSourcePath);
  if (requiredSessionPort && !new RegExp(`\\b${requiredSessionPort}\\b`).test(source)) {
    violations.push(`${normalizedSourcePath}: this consumer must depend on its narrow ${requiredSessionPort} capability port`);
  }
  if (requiredSessionPort && /\bPlayerPageSessionPort\b/.test(source)) {
    violations.push(`${normalizedSourcePath}: this consumer must not depend on the aggregate PlayerPageSessionPort`);
  }
  if (normalizedSourcePath === 'renderer/features/home/useHomeSourceSession.ts' && /\bwindow\s*\./.test(source)) {
    violations.push(normalizedSourcePath + ': home source session must consume HomeSourceSessionEventsPort instead of window globals');
  }
  if (normalizedSourcePath === 'renderer/features/plugins/PluginDialogBridge.tsx' && /\bwindow\s*\.\s*api\b/.test(source)) {
    violations.push(`${normalizedSourcePath}: plugin dialog UI must consume PluginDialogPort; window IPC belongs in its adapter`);
  }
  if (normalizedSourcePath === 'renderer/features/subscriptions/useSubscriptionImport.ts' &&
      /interface\s+UseSubscriptionImportOptions\s*\{[^}]*\bset(?:Error|Notice)\b/s.test(source)) {
    violations.push(`${normalizedSourcePath}: subscription import feedback must be owned by its workflow, not injected from page-wide error and notice state`);
  }
  if (normalizedSourcePath === 'renderer/features/playback/VideoPlayerPresenter.ts' &&
      /\bwindow\s*\.\s*(?:innerWidth|innerHeight)\b|\bwindow\s*\.\s*location\s*\.\s*reload\s*\(/.test(source)) {
    violations.push(`${normalizedSourcePath}: renderer-window viewport and reload effects must use the player window adapter`);
  }
  if (rendererPlaybackSessionForbiddenRuntimeGlobals.has(normalizedSourcePath) && /\bwindow\s*\.\s*api\b/.test(source)) {
    violations.push(`${normalizedSourcePath}: playback runtime detection must use the injected PlaybackRuntimePort`);
  }
  if (rendererAudioSessionForbiddenDom.has(normalizedSourcePath) &&
      /\bHTML(?:Audio|Div)Element\b|\bgetBoundingClientRect\s*\(|\b(?:load|play|pause)\s*\(\s*\)/.test(source)) {
    violations.push(`${normalizedSourcePath}: audio session must consume AudioPlaybackMediaPort and value-only progress geometry instead of browser media or layout APIs`);
  }
  if (normalizedSourcePath === 'renderer/features/playback/usePlayerKeyboardShortcuts.ts' &&
      /\bwindow\s*\.\s*(?:addEventListener|removeEventListener)\s*\(|\b(?:setTimeout|clearTimeout|setInterval|clearInterval)\s*\(/.test(source)) {
    violations.push(`${normalizedSourcePath}: player keyboard shortcuts must keep browser events and timers behind injected ports`);
  }
  if (normalizedSourcePath === 'renderer/features/playback/useSkipSegmentsController.ts' &&
      /\b(?:localStorage|sessionStorage|window|document|console)\b|\bDate\s*\.\s*now\s*\(|\b(?:setTimeout|clearTimeout)\s*\(/.test(source)) {
    violations.push(`${normalizedSourcePath}: skip-segment controller must consume injected storage, dismissal, scheduler and clock ports`);
  }
  if (normalizedSourcePath === 'renderer/features/detail/application/detailNavigation.ts' &&
      /\bwindow\s*\.|\bdocument\s*\.|\b(?:localStorage|sessionStorage)\s*\./.test(source)) {
    violations.push(`${normalizedSourcePath}: detail navigation policy must remain pure and independent from renderer infrastructure`);
  }
  if (normalizedSourcePath === 'renderer/features/display/application/displayPreferences.ts' &&
      /\bwindow\s*\.|\bdocument\s*\.|\b(?:localStorage|sessionStorage|console)\s*\.|\b(?:setTimeout|clearTimeout)\s*\(/.test(source)) {
    violations.push(`${normalizedSourcePath}: display preference session must use injected scale and poster ports without browser or scheduling globals`);
  }
  if (normalizedSourcePath === 'renderer/features/search/application/searchWindowNavigation.ts' &&
      /\bwindow\s*\.|\bdocument\s*\.|\b(?:localStorage|sessionStorage|console)\s*\.|\b(?:setTimeout|clearTimeout)\s*\(/.test(source)) {
    violations.push(`${normalizedSourcePath}: search-window navigation policy must remain deterministic and independent from browser and IPC globals`);
  }
  if (normalizedSourcePath === 'renderer/features/playback/VideoPlayerPresenter.ts' &&
      /\bimport\s*\{[^}]*\bresolveKernel\b[^}]*\}\s*from\s*['"][^'"]*\/kernel['"]/s.test(source)) {
    violations.push(`${normalizedSourcePath}: kernel preference resolution must stay behind the kernel selection boundary`);
  }
  if (normalizedSourcePath === 'renderer/features/playback/application/playerPreferences.ts' &&
      /\b(?:localStorage|window|document)\b/.test(source)) {
    violations.push(`${normalizedSourcePath}: playback preference policy must stay independent from browser storage and DOM globals`);
  }
  if (normalizedSourcePath === 'renderer/features/playback/useSubtitleSearch.ts' &&
      /\b(?:localStorage|window|document)\b/.test(source)) {
    violations.push(`${normalizedSourcePath}: subtitle search must consume the query-memory port instead of browser storage`);
  }
  const extension = path.extname(filePath);
  const isTypeScript = ['.ts', '.tsx', '.mts', '.cts'].includes(extension);
  const hasJsx = ['.tsx', '.jsx', '.js', '.mjs', '.cjs'].includes(extension);
  const sourceFile = parse(source, {
    sourceType: 'unambiguous',
    sourceFilename: filePath,
    plugins: [
      ...(isTypeScript ? ['typescript'] : []),
      ...(hasJsx ? ['jsx'] : []),
      'decorators-legacy',
      'importAttributes',
    ],
  });
  for (const specifier of moduleSpecifiers(sourceFile)) {
    if (normalizedSourcePath === 'engine/spider/PySpider.ts' && pythonSpiderForbiddenImports.has(specifier)) {
      violations.push(`${normalizedSourcePath} → ${specifier}: Python script filesystem, URL resolution, and cache concerns belong in the main-process script adapter`);
    }
    const forbiddenLayer = targetLayer(filePath, specifier);
    if (forbiddenLayer && rule.forbiddenLayers.has(forbiddenLayer)) {
      violations.push(`${relativeFile} → ${specifier}: ${rule.description}`);
    } else if (rule.forbidElectron && /^(?:electron|electron\/)/.test(specifier)) {
      violations.push(`${relativeFile} → ${specifier}: ${rule.description}`);
    }

    const belongsToPortableCore = layer === 'shared' || (layer === 'engine' && relativeFile.startsWith(`engine${path.sep}vod${path.sep}`));
    if (belongsToPortableCore && isNodeBuiltin(specifier)) {
      violations.push(`${relativeFile} → ${specifier}: shared contracts and VOD use cases must not depend on Node.js built-ins`);
    }
    if (belongsToPortableCore && /^(?:react|react-dom)(?:\/|$)/.test(specifier)) {
      violations.push(`${relativeFile} → ${specifier}: shared contracts and VOD use cases must not depend on UI frameworks`);
    }

    if (layer === 'engine' && relativeFile.startsWith(`engine${path.sep}vod${path.sep}`) && specifier.startsWith('.')) {
      const target = path.relative(sourceRoot, path.resolve(path.dirname(filePath), specifier))
        .split(path.sep).join('/').replace(/\.(?:[cm]?[jt]sx?)$/, '');
      const portableSpiderContracts = new Set(['engine/spider/errors', 'engine/spider/sourceTimeout']);
      if (target === 'engine/ports' || target.startsWith('engine/js/') ||
          (target.startsWith('engine/spider/') && !portableSpiderContracts.has(target))) {
        violations.push(`${relativeFile} → ${specifier}: VOD use cases must depend on source capability ports, not runtime hosts, factories, or Spider implementations`);
      }
    }

    if (relativeFile === `engine${path.sep}ports.ts` && specifier === './js/JsSandbox') {
      violations.push(`${relativeFile} → ${specifier}: engine host contracts must depend on consumer-owned runtime ports, not sandbox implementations`);
    }

    const normalizedFile = relativeFile.split(path.sep).join('/');
    const rendererControllerForbidden = rendererControllerForbiddenImports.get(normalizedFile);
    if (rendererControllerForbidden?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: home search controller must use injected navigation and memory ports, not renderer infrastructure directly`);
    }
    if (rendererHomeModelForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: home models and source-session contracts must use feature-owned types, not rendered components or browse controllers`);
    }
    if (rendererProfileActivationForbiddenAdapters.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: profile activation use case must depend on its application ports, not renderer adapters or UI frameworks`);
    }
    const rendererFeatureControllerForbiddenViewImport = rendererFeatureControllerForbiddenViewImports.get(normalizedFile);
    if (rendererPassiveSettingsViewForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: settings presentation views must consume a view model and semantic actions, not controllers or infrastructure`);
    }
    if (rendererFeatureControllerForbiddenViewImport?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: playback state controllers must depend on feature contracts, not rendered control components`);
    }
    if (rendererPlaybackControlFiles.has(normalizedFile) && specifier.includes('PlayerControlsViewModel')) {
      violations.push(`${normalizedFile} → ${specifier}: individual playback controls must depend on their narrow control model, not the aggregate player view model`);
    }
    if (rendererSkipSegmentsControllerForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: skip-segment controller must consume injected storage, dismissal, scheduler and clock ports`);
    }
    if (rendererControllerForbiddenPresentationImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: playback controllers must use injected presentation ports, not depend on presentation implementations`);
    }
    if (rendererThemeRegistryForbiddenInfrastructureImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: theme registry coordination must use its application port; IPC belongs in the renderer adapter`);
    }
    if (rendererPurePreferenceMappingForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: UI preference mapping must stay framework and infrastructure independent`);
    }
    if (rendererPlaybackControllerForbiddenInfrastructureImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: danmaku controller must consume injected application ports, not IPC or combined infrastructure modules`);
    }
    if (rendererPlaybackSessionForbiddenInfrastructureImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: playback sessions must use PlaybackPositionMemoryPort instead of renderer storage directly`);
    }
    if (rendererAudioPlaybackForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: audio playback must keep storage, modal and browser-event adapters outside the session and view`);
    }
    if (rendererPlayerKeyboardShortcutsForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: player keyboard shortcuts must consume injected event, scheduler and modal-guard ports`);
    }
    if (rendererPlaybackWindowControlForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: player window control hook must consume application ports, not renderer IPC or adapter implementations`);
    }
    if (rendererPlayerPreferencesForbiddenInfrastructureImports.get(normalizedFile)?.has(specifier)) {
        violations.push(`${normalizedFile} → ${specifier}: playback settings must consume PlayerPreferencesPort and injected application ports instead of renderer infrastructure directly`);
    }
    if (rendererMediaRuntimeForbiddenInfrastructureImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: media runtime lifecycle must use MediaRuntimeManagementPort instead of IPC infrastructure`);
    }
    if (rendererConfigurationSnapshotForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: configuration snapshot session must use ConfigurationSnapshotPort instead of IPC/adapters`);
    }
      if (rendererExternalPlayerSettingsForbiddenInfrastructureImports.get(normalizedFile)?.has(specifier)) {
        violations.push(`${normalizedFile} → ${specifier}: external player settings must consume injected application ports instead of IPC infrastructure`);
      }
      if (rendererMpvSettingsForbiddenInfrastructureImports.get(normalizedFile)?.has(specifier)) {
        violations.push(`${normalizedFile} → ${specifier}: MPV settings must consume injected application ports instead of IPC infrastructure`);
      }
    if (rendererPlayerAudioTracksForbiddenInfrastructureImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: audio-track workflow must consume injected application ports instead of IPC or concrete adapters`);
    }
    if (rendererSubtitleSearchForbiddenInfrastructureImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: subtitle search must consume SubtitleSearchDependencies instead of IPC infrastructure`);
    }
    if (rendererSubtitlePlaybackForbiddenInfrastructureImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: subtitle playback must consume SubtitlePlaybackPort instead of IPC infrastructure`);
    }
    if (rendererSubscriptionImportForbiddenInfrastructureImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: subscription import workflow must consume its injected job or file-import port instead of the renderer IPC client`);
    }
    if (rendererLiveSourcesForbiddenInfrastructureImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: live source settings must consume LiveSourcesManagementPort instead of renderer IPC or adapter implementations`);
    }
    if (rendererSavedProfilesForbiddenInfrastructureImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: saved profile management must consume SavedProfilesManagementPort instead of renderer IPC or adapter implementations`);
    }
    if (rendererProfileSwitcherForbiddenInfrastructureImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: profile switching must consume an injected ProfileSwitcherPort instead of renderer IPC, browser events, or adapter implementations`);
    }
    if (rendererSubscriptionGroupManagementForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: subscription-group actions must use their consumer-owned port; IPC belongs in the adapter and the section remains passive`);
    }
    if (rendererSourcePickerForbiddenInfrastructureImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: source picking must consume an injected SourcePickerPort; IPC and browser events belong in the adapter`);
    }
    if (rendererDriveBindingForbiddenInfrastructureImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: drive-binding views and controllers must consume DriveBindingPorts; IPC belongs in the drive-binding adapter`);
    }
    if (rendererDlnaCastingForbiddenInfrastructureImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: DLNA controls must consume the playback presentation model; DLNA use cases must use DlnaCastingPort, with IPC in the adapter`);
    }
    if (rendererMediaDiagnosticsForbiddenInfrastructureImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: playback diagnostics must report through MediaDiagnosticsPort; DOM lifecycle hooks and use cases must not import renderer IPC or adapters`);
    }
    if (rendererPlayerFullscreenForbiddenInfrastructureImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: fullscreen behavior must use the injected PlayerFullscreenPort; renderer IPC belongs in its adapter`);
    }
    if (rendererPlayerHistoryProgressForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: history progress workflow must use PlayerHistoryProgressPort; UI memory I/O belongs in the adapter`);
    }
    if (rendererPlayerPageSessionForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: player-page session and window behavior must use injected ports; IPC belongs in route adapters`);
    }
    if (rendererUpdateGateForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: update-gate workflow must use the update port and passive view boundary`);
    }
    if (rendererHistoryUpdateForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: history update detection must remain a framework-independent application workflow`);
    }
    if (rendererHistoryPageForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: history UI and presenter must use history ports; IPC, storage and navigation implementations belong in the adapter`);
    }
    if (rendererFavoritesPageForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: favorites UI and presenter must use favorite ports; IPC, storage and navigation implementations belong in the adapter`);
    }
    if (rendererStoragePageForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: WebDAV browsing must use StorageBrowserPort; IPC belongs in the storage adapter`);
    }
    if (rendererWindowTitleBarForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: window controls must delegate window I/O through WindowTitleBarPort`);
    }
    if (rendererPageErrorBoundaryForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: page error boundaries must report through the injected reporting callback`);
    }
    if (rendererPluginSlotForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: plugin slots must render declarative view models and delegate effects through the plugin slot port`);
    }
    if (rendererSearchPanelForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: search panel UI and presenter must use injected recommendation, history and navigation ports`);
    }
    if (rendererHomePageForbiddenInfrastructureImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: HomePage presentation coordination must consume injected state and capabilities; persisted preference and IPC adapters belong at the composition boundary`);
    }
    if (rendererHomePresentationForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: HomePage views and presentation contracts must depend on feature view models, not concrete views or controller hooks`);
    }
    if (rendererHomeBrowseControllerForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: home browse workflows must receive preferences and category state through injected values and ports`);
    }
    if (rendererHomeSearchApplicationForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: home search application workflows must remain UI and infrastructure independent and coordinate browse through ports`);
    }
    if (rendererPluginPlaybackEnginesForbiddenInfrastructureImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: plugin playback-engine discovery must use PluginPlaybackEnginesPort; IPC and browser events belong in its adapter`);
    }
    if (rendererLivePlaybackForbiddenInfrastructureImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: live playback controller must consume LivePlaybackDataPort instead of the renderer IPC client`);
    }
    if (rendererLiveExportForbiddenInfrastructureImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: live-export workflow must use its port and keep IPC in the adapter`);
    }
    if (rendererMovieSourcesForbiddenInfrastructureImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: movie-source search and folder expansion must use consumer-owned application ports and renderer adapters`);
    }
    if (rendererDiscoveryForbiddenInfrastructureImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: discovery views and controllers must use consumer-owned ports and renderer adapters instead of the renderer IPC client`);
    }
    if (rendererDetailDataForbiddenInfrastructureImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: detail route state must load through the application use case and an injected DetailDataPort`);
    }
    if (rendererDetailNavigationApplicationForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: detail navigation policy must remain pure and independent from renderer infrastructure`);
    }
    if (rendererDisplayPreferencesForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: display preference policy and presentation must use injected session contracts, not renderer infrastructure or concrete adapters`);
    }
    if (rendererSearchWindowApplicationForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: search-window navigation policy must use route data and injected capabilities, not renderer infrastructure`);
    }
    if (rendererDetailScrollForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: detail scroll persistence must use the injected DetailScrollMemoryPort; storage belongs in its adapter`);
    }
    if (rendererDetailBackdropForbiddenInfrastructureImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: optional detail backdrop loading must use its injected port; metadata IPC belongs in the adapter`);
    }
    if (rendererDetailPlaybackForbiddenInfrastructureImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: detail playback must use DetailPlaybackPort and keep IPC/storage in renderer adapters`);
    }
    if (rendererSuperResolutionForbiddenInfrastructureImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: super-resolution workflow must consume SuperResolutionPort instead of IPC infrastructure`);
    }
    if (rendererSuperResolutionUseCaseForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: super-resolution application use case must stay framework independent and consume SuperResolutionPort`);
    }
    const rendererPresenterForbidden = rendererPresenterForbiddenImports.get(normalizedFile);
    if (rendererPresenterForbidden?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: playback presenter must compose consumer-owned ports and renderer adapters, not call the IPC client directly`);
    }
    if (rendererPlaybackInfrastructureForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: playback presenters and controllers must receive infrastructure through injected ports; concrete renderer adapters belong at the composition boundary`);
    }
    if (rendererSettingsSectionForbiddenInfrastructureImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: settings section must consume an injected application port instead of the renderer IPC client`);
    }
    if (rendererConfigurationPageForbiddenInfrastructureImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: configuration-page capabilities must be declared by application ports and implemented in adapters`);
    }
    if (rendererSourceHealthAuditForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: source audit UI/controller must use SourceHealthAuditPort; audit mutations and profile persistence belong in the adapter`);
    }
    if (rendererMergeProfileExportForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: merge-profile export view and presenter must use the application port; IPC and save-dialog calls belong in the adapter`);
    }
    if (rendererCoverLookupForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: cover lookup state must depend on CoverLookupPort; IPC belongs in the cover lookup adapter`);
    }
    if (rendererPluginKeymapsForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: keymap matching and key-event lifecycle must use PluginKeymapPort; IPC belongs in the adapter`);
    }
    if (rendererPluginCommandForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: plugin command policy must use PluginCommandPort; UI, theme and IPC effects belong in adapters`);
    }
    if (rendererPlayerEpisodeHistoryForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: successful episode history must remain an application use case and consume history/source-memory ports`);
    }
    const rendererPresenterForbiddenFeatureImport = rendererPresenterForbiddenFeatureImports.get(normalizedFile);
    if (rendererPresenterForbiddenFeatureImport?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: playback presenter must delegate plugin command and dialog integration to the player feature controller`);
    }
    if (rendererPresenterForbiddenSessionImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: playback presenter must use the player session composition boundary, not own engine lifecycle hooks`);
    }
    if (rendererPresenterForbiddenKernelSelectionImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: playback presenter must use the kernel selection boundary, not own runtime discovery or kernel decision policy`);
    }
    if (rendererPresenterForbiddenPanelImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: playback presenter must use the panel session boundary, not assemble panel lifecycle details directly`);
    }
    const rendererPresenterForbiddenView = rendererPresenterForbiddenViewImports.get(normalizedFile);
    if (rendererPresenterForbiddenView?.has(specifier)) {
      violations.push(normalizedFile + ' → ' + specifier + ': playback presenter must depend on the presentation model, not the rendered control component');
    }
    if (rendererPresentationModelForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(normalizedFile + ' → ' + specifier + ': playback presentation contract must not import concrete rendered controls');
    }
    if (rendererPresentationModelForbiddenHookImports.get(normalizedFile)?.has(specifier)) {
      violations.push(normalizedFile + ' → ' + specifier + ': playback presentation contract must not import controller hooks');
    }
    if (rendererPresentationModelFrameworkIndependent.has(normalizedFile) && /^(?:react|react-dom)(?:\/|$)/.test(specifier)) {
      violations.push(normalizedFile + ' → ' + specifier + ': playback presentation contract must not depend on React types or runtime');
    }
    if (rendererPlaybackViewForbiddenDomainHelpers.get(normalizedFile)?.has(specifier)) {
      violations.push(normalizedFile + ' → ' + specifier + ': playback views must use presentation helpers and semantic commands instead of importing engine internals directly');
    }
    if (opaqueFactoryConsumers.get(normalizedFile) === specifier) {
      violations.push(`${relativeFile} → ${specifier}: runtime consumers must treat factory construction context as opaque`);
    }
    if (runtimeProviderForbiddenHostImports.get(normalizedFile) === specifier) {
      violations.push(`${relativeFile} → ${specifier}: runtime provider contracts must use SpiderInit runtime capabilities instead of the complete EngineHost`);
    }
    if (runtimeFactoryForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: SpiderFactory must select through SpiderRuntimeProvider; concrete runtimes belong in the built-in provider composition`);
    }
    if (concreteJarBridgeForbiddenImports.get(normalizedFile)?.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: JVM spider consumers must depend on JarSpiderRuntimePort or pure utilities, not JarSpiderBridge`);
    }
    if (featureIpcContracts.get(normalizedFile) === specifier) {
      violations.push(`${relativeFile} → ${specifier}: IPC adapters must consume stable shared DTOs, not parser implementation types`);
    }
    if (productionCompositionFacadeImports.get(normalizedFile) === specifier) {
      violations.push(`${relativeFile} → ${specifier}: production composition roots must wire application services through consumer-owned ports, not SpiderHost`);
    }
    if (normalizedFile === 'main/subscriptions/SubscriptionImportApplicationService.ts' &&
        subscriptionImportApplicationForbiddenConcreteImports.has(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: subscription import application must depend on its consumer-owned ports, not concrete services`);
    }

    const isFeatureAdapter =
      (relativeFile.startsWith(`main${path.sep}ipc${path.sep}`) && relativeFile !== `main${path.sep}ipc${path.sep}index.ts`) ||
      relativeFile === `main${path.sep}settings${path.sep}backupIpc.ts`;
    if (isFeatureAdapter &&
        specifier === '../spider/SpiderHost') {
      violations.push(`${relativeFile} → ${specifier}: IPC feature adapters must depend on consumer-owned ports, not the SpiderHost composition root`);
    }

    if (normalizedFile === 'main/spider/SpiderPlaybackService.ts' && /^\.\.\/(?:drive|net|torrent)\//.test(specifier)) {
      violations.push(`${normalizedFile} → ${specifier}: playback use case must depend on consumer-owned ports, not drive, network, or torrent adapters`);
    }

    if (layer === 'renderer') {
      const rendererPath = path.relative(rendererRoot, filePath).split(path.sep);
      const importerIsUiPrimitive = rendererPath[0] === 'components' && rendererPath[1] === 'ui';
      const importerIsFeature = rendererPath[0] === 'features';
      const importerIsUseCase = importerIsFeature && rendererPath[2] === 'application';
      const target = rendererArea(filePath, specifier);
      if (target && importerIsUiPrimitive && (target.feature || target.page)) {
        violations.push(`${relativeFile} → ${specifier}: UI primitives may not depend on feature or page modules`);
      } else if (target?.page && importerIsFeature) {
        violations.push(`${relativeFile} → ${specifier}: feature modules may not depend on page modules`);
      }
      if (importerIsUseCase) {
        if (isNodeBuiltin(specifier) || /^(?:react|react-dom)(?:\/|$)/.test(specifier)) {
          violations.push(`${relativeFile} → ${specifier}: feature application use cases must stay independent of Node.js and UI frameworks`);
        }
        if (specifier.startsWith('.')) {
          const relativeTarget = path.relative(rendererRoot, path.resolve(path.dirname(filePath), specifier)).split(path.sep);
          const targetsOuterLayer = ['api', 'components', 'pages', 'layouts'].includes(relativeTarget[0]);
          const targetsFeatureAdapter = relativeTarget[0] === 'features' && relativeTarget[2] !== 'application';
          if (targetsOuterLayer || targetsFeatureAdapter) {
            violations.push(`${relativeFile} → ${specifier}: feature application use cases may not depend on UI, IPC clients, or feature adapters`);
          }
        }
      }
    }
  }
  if (normalizedSourcePath === 'engine/spider/PySpider.ts' && /\bthis\.host\.http\.request\s*\(/.test(source)) {
    violations.push(`${normalizedSourcePath}: Python script downloads must use the injected PythonSpiderScriptPort, not the general engine host`);
  }
  if (relativeFile.split(path.sep).join('/') === 'renderer/features/playback/VideoPlayerView.tsx' &&
      (/\bprops\s*\./.test(source) || /\bVideoPlayerProps\b/.test(source))) {
    violations.push('renderer/features/playback/VideoPlayerView.tsx: passive playback view must consume the presentation model, not raw player input props');
  }
  const normalizedFile = relativeFile.split(path.sep).join('/');
  if (rendererHomePresenterForbiddenBrowserEffects.has(normalizedFile) &&
      /\.addEventListener\(['"]scroll['"]|\.removeEventListener\(['"]scroll['"]|\.scrollTo\(/.test(source)) {
    violations.push(`${normalizedFile}: home-page scroll DOM events and imperative scrolling belong in the page memory lifecycle hook`);
  }
  if (normalizedFile === 'renderer/features/home/useHomePagePresenter.ts' && /type\s+SortClassView\b/.test(source)) {
    violations.push(`${normalizedFile}: home presentation coordination must use the feature-owned sort-class contract, not a controller-exported view type`);
  }
  if (rendererSettingsPageForbiddenBrowserEffects.has(normalizedFile) &&
      /document\.getElementById|MutationObserver|\.scrollIntoView\(|requestAnimationFrame\(/.test(source)) {
    violations.push(`${normalizedFile}: settings deep-link DOM effects belong in the settings navigation hook`);
  }
  if (rendererPassiveSettingsViews.has(normalizedFile) &&
      /\b(?:useEffect|useState|useLayoutEffect|document\.querySelector|window\.)/.test(source)) {
    violations.push(`${normalizedFile}: settings presentation views must remain passive and not own state or browser effects`);
  }
  const storageAccesses = browserStorageAccesses(sourceFile);
  if (normalizedFile.startsWith('renderer/') && storageAccesses.length > 0 &&
      !normalizedFile.split('/').includes('adapters') &&
      !rendererBrowserStorageAdapterFiles.has(normalizedFile)) {
    violations.push(`${normalizedFile}: browser storage access must be provided through a renderer adapter`);
  }
  if (rendererBrowserStorageForbiddenGlobals.has(normalizedFile) && /\b(?:localStorage|sessionStorage)\b/.test(source)) {
    const message = normalizedFile === 'renderer/features/live/useLivePlayback.ts'
      ? 'live playback controller must consume LiveSelectionMemoryPort instead of browser storage globals'
      : 'subscription import workflow must consume a memory port instead of browser storage globals';
    violations.push(`${normalizedFile}: ${message}`);
  }
  if (rendererWindowEventForbiddenGlobals.has(normalizedFile) && /\bwindow\s*\./.test(source)) {
    violations.push(`${normalizedFile}: live playback controller must consume LivePlaybackRefreshPort instead of browser window events`);
  }
  if (rendererCoverWorkflowForbiddenBrowserGlobals.has(normalizedFile) && /\b(?:window|navigator|StorageEvent)\b/.test(source)) {
    violations.push(`${normalizedFile}: cover workflow must consume injected settings-change and image ports instead of browser globals`);
  }
}

if (violations.length > 0) {
  console.error(`Architecture boundary violations (${violations.length}):\n${violations.map((item) => `- ${item}`).join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('Architecture boundaries passed.');
}
