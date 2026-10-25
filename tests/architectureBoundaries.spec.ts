import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const checker = fileURLToPath(new URL('../scripts/architecture-boundaries.mjs', import.meta.url));
const fixtures: string[] = [];

function inspect(file: string, source: string) {
  const root = mkdtempSync(join(tmpdir(), 'winbox-architecture-'));
  fixtures.push(root);
  const target = join(root, 'src', file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, source);
  return spawnSync(process.execPath, [checker], { cwd: root, encoding: 'utf8', timeout: 10_000 });
}

afterEach(() => {
  for (const directory of fixtures.splice(0)) {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('winbox-architecture-')) {
      throw new Error(`Refusing cleanup outside the architecture fixture root: ${directory}`);
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('architecture dependency rules', () => {
  it.each([
    "import { existsSync } from 'node:fs';",
    "import { fileURLToPath } from 'node:url';",
    "import { md5Hex } from '../util/md5';",
    'this.host.http.request({ url: apiBase, method: "get" });',
  ])('keeps Python script I/O in the main-process adapter: %s', (source) => {
    const result = inspect('engine/spider/PySpider.ts', source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Python script');
  });

  it.each([
    ['renderer/lib/theme.ts', "import { client } from '../api/client';"],
    ['renderer/features/theme/application/pluginThemeRegistry.ts', "import { client } from '../../../api/client';"],
  ])('keeps theme registry orchestration independent from renderer IPC: %s', (file, source) => {
    const result = inspect(file, source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('theme registry coordination must use its application port');
  });

  it('allows a feature application use case to consume contracts and its own ports', () => {
    const result = inspect('renderer/features/playback/application/example.ts', `
      import type { Kernel } from '../../../lib/kernel';
      import type { PlaybackHandoff } from './playbackHandoff';
      export type Activate = (kernel: Kernel, handoff: PlaybackHandoff) => void;
    `);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Architecture boundaries passed.');
  });

  it.each([
    "import type { SubscriptionImportService } from './SubscriptionImportService';",
    "import type { SubscriptionImportCoordinator } from './SubscriptionImportCoordinator';",
    "import type { SubscriptionAutoRefreshService } from './SubscriptionAutoRefreshService';",
  ])('keeps the subscription application behind consumer-owned ports: %s', (source) => {
    const result = inspect('main/subscriptions/SubscriptionImportApplicationService.ts', source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('subscription import application must depend on its consumer-owned ports');
  });

  it.each([
    ["import { useState } from 'react';", 'UI frameworks'],
    ["import { client } from '../../../api/client';", 'UI, IPC clients'],
    ["import { Control } from '../../../components/ui/Button';", 'UI, IPC clients'],
    ["import { usePlayback } from '../usePlayback';", 'feature adapters'],
  ])('rejects a reverse dependency from a feature application use case: %s', (source, reason) => {
    const result = inspect('renderer/features/playback/application/example.ts', source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(reason);
  });

  it('keeps the playback presenter dependent on a presentation model rather than the rendered control component', () => {
    const result = inspect('renderer/features/playback/VideoPlayerPresenter.ts', "import type { PlayerControlsBarProps } from './PlayerControlsBar';");
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must depend on the presentation model');
  });

  it.each([
    ['renderer/features/playback/VideoPlayerPresenter.ts', "import { htmlMediaSourceAdapter } from './htmlMediaSourceAdapter';"],
    ['renderer/features/playback/VideoPlayerPresenter.ts', "import { mpvPlaybackSessionAdapter } from './adapters/mpvPlaybackAdapters';"],
    ['renderer/features/playback/usePlayerKernelSelection.ts', "import { mpvStatusQueryAdapter } from './adapters/mpvPlaybackAdapters';"],
  ])('keeps playback orchestration behind injected ports: %s', (file, source) => {
    const result = inspect(file, source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must receive infrastructure through injected ports');
  });

  it.each([
    "import { client } from '../../api/client';",
    "import { playerWindowControlEventsAdapter } from './adapters/playerWindowControlEventsAdapter';",
  ])('keeps the player window-control hook independent from infrastructure: %s', (source) => {
    const result = inspect('renderer/features/playback/usePlayerWindowControls.ts', source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must consume application ports');
  });

  it.each([
    ['renderer/features/discovery/useDiscoverController.ts', "import { client } from '../../api/client';"],
    ['renderer/features/discovery/useDiscoverExplore.ts', "import { client } from '../../api/client';"],
    ['renderer/features/discovery/useDiscoverBoard.ts', "import { client } from '../../api/client';"],
    ['renderer/pages/BoardsPage.tsx', "import { client } from '../api/client';"],
    ['renderer/features/discovery/components/BoardPreviewCard.tsx', "import { client } from '../../../api/client';"],
  ])('keeps discovery views and controllers behind their consumer-owned ports: %s', (file, source) => {
    const result = inspect(file, source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must use consumer-owned ports and renderer adapters');
  });

  it.each([
    "import { usePlayerPanelCoordinator } from './usePlayerPanelCoordinator';",
    "import { usePlayerControlsVisibility } from './usePlayerControlsVisibility';",
    "import { useHoverDelay } from '../../lib/useHoverDelay';",
    "import { usePlayerPanelPosition } from '../../lib/usePlayerPanelPosition';",
  ])('keeps panel lifecycle details behind the player panel session boundary: %s', (source) => {
    const result = inspect('renderer/features/playback/VideoPlayerPresenter.ts', source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must use the panel session boundary');
  });

  it('keeps the playback presentation contract independent from concrete rendered controls', () => {
    const result = inspect('renderer/features/playback/presentation/PlayerControlsViewModel.ts', "import type { PlayerAudioControl } from '../PlayerAudioControl';");
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must not import concrete rendered controls');
  });

  it('keeps playback presentation contracts independent from controller hooks', () => {
    const result = inspect('renderer/features/playback/presentation/PlayerControlsViewModel.ts', "import type { MpvTechnicalState } from '../useMpvTechnicalState';");
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must not import controller hooks');
  });

  it('keeps playback presentation contracts independent from React types and runtime', () => {
    const result = inspect('renderer/features/playback/presentation/PlayerControlsViewModel.ts', "import type { Dispatch } from 'react';");
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must not depend on React types or runtime');
  });

  it.each([
    ['renderer/components/AudioPlayer.tsx', "import { getPlayTime } from '../lib/uiMemory';"],
    ['renderer/features/playback/useAudioPlaybackSession.ts', "import { getPlayTime } from '../../lib/uiMemory';"],
    ['renderer/features/playback/useAudioPlaybackSession.ts', "import { isNativeModalOpen } from '../../lib/modalScope';"],
    ['renderer/features/playback/AudioPlayerView.tsx', "import { useAudioPlaybackSession } from './useAudioPlaybackSession';"],
  ])('keeps audio playback views and sessions behind ports and composition: %s', (file, source) => {
    const result = inspect(file, source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('audio playback must keep storage, modal and browser-event adapters outside the session and view');
  });

  it.each([
    'const element: HTMLAudioElement | null = null;',
    'const bounds = progress.getBoundingClientRect();',
    'audio.play();',
  ])('keeps audio session browser media and layout I/O behind injected ports: %s', (source) => {
    const result = inspect('renderer/features/playback/useAudioPlaybackSession.ts', source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('audio session must consume AudioPlaybackMediaPort');
  });

  it('keeps the audio presentation model independent from React', () => {
    const result = inspect('renderer/features/playback/presentation/AudioPlayerModel.ts', "import type { RefObject } from 'react';");
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('playback presentation contract must not depend on React types or runtime');
  });

  it.each([
    "import { isNativeModalOpen } from '../../lib/modalScope';",
    "window.addEventListener('keydown', listener);",
    'setInterval(callback, 40);',
  ])('keeps player keyboard shortcuts behind injected runtime ports: %s', (source) => {
    const result = inspect('renderer/features/playback/usePlayerKeyboardShortcuts.ts', source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('player keyboard shortcuts must');
  });

  it('keeps skip-segment state controllers independent from rendered control components', () => {
    const result = inspect('renderer/features/playback/useSkipSegmentsController.ts', "import type { SkipSegmentsDraft } from './SkipSegmentsControl';");
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('feature contracts, not rendered control components');
  });

  it.each([
    "import { loadSkipStore } from '../../lib/skipSegments';",
    "import { isNativeModalOpen } from '../../lib/modalScope';",
    "import { skipSegmentsControllerAdapter } from './adapters/skipSegmentsControllerAdapter';",
    "window.addEventListener('keydown', listener);",
    "localStorage.getItem('segments');",
    'Date.now();',
    'setTimeout(callback, 10);',
    "console.info('saved');",
  ])('keeps skip-segment controller effects behind injected ports: %s', (source) => {
    const result = inspect('renderer/features/playback/useSkipSegmentsController.ts', source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('skip-segment controller must consume injected storage, dismissal, scheduler and clock ports');
  });

  it.each([
    "import { client } from '../../../api/client';",
    "import { useMemo } from 'react';",
    "import { detailWindowNavigationAdapter } from '../adapters/detailWindowNavigationAdapter';",
    'window.location.hash;',
  ])('keeps detail navigation decisions independent from renderer infrastructure: %s', (source) => {
    const result = inspect('renderer/features/detail/application/detailNavigation.ts', source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('detail navigation policy must remain pure and independent from renderer infrastructure');
  });

  it.each([
    "import { client } from '../../../api/client';",
    "import { useMemo } from 'react';",
    "import { subscribePreference } from '../../../lib/preferenceStore';",
    "import { displayPreferencesSession } from '../adapters/displayPreferencesAdapter';",
    'document.documentElement.style.setProperty("--ui-zoom", "1");',
  ])('keeps display preference policy independent from renderer infrastructure: %s', (source) => {
    const result = inspect('renderer/features/display/application/displayPreferences.ts', source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/display preference session must use injected scale and poster ports|display preference policy and presentation must use injected session contracts/);
  });

  it('keeps the display scale presentation hook independent from concrete adapters', () => {
    const result = inspect(
      'renderer/features/display/presentation/useUiScaleState.ts',
      "import { displayPreferencesSession } from '../adapters/displayPreferencesAdapter';",
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('display preference policy and presentation must use injected session contracts');
  });

  it.each([
    "import { client } from '../../../api/client';",
    "import { getNavMode } from '../../../lib/uiPrefs';",
    "import { openSearchWindow } from '../adapters/searchWindowNavigationAdapter';",
    "import { useState } from 'react';",
    'window.location.hash;',
  ])('keeps search-window navigation policy pure: %s', (source) => {
    const result = inspect('renderer/features/search/application/searchWindowNavigation.ts', source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/search-window navigation policy must use route data and injected capabilities|search-window navigation policy must remain deterministic and independent/);
  });

  it('keeps danmaku controller independent from presentation implementations', () => {
    const result = inspect(
      'renderer/features/playback/useDanmakuController.ts',
      "import { formatDanmakuCandidateLabel } from './presentation/formatDanmakuCandidateLabel';",
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must use injected presentation ports');
  });

  it.each([
    "import { client } from '../../api/client';",
    "import { searchDanmakuCandidates } from './danmakuSearch';",
  ])('keeps danmaku controller dependent on application ports: %s', (source) => {
    const result = inspect('renderer/features/playback/useDanmakuController.ts', source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must consume injected application ports');
  });

  it('keeps playback preference state independent from browser storage', () => {
    const result = inspect(
      'renderer/features/playback/usePlayerPreferences.ts',
      "import { loadPlayerPrefs } from '../../lib/playerPrefs';",
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must consume PlayerPreferencesPort');
  });

  it('keeps playback settings behind the injected preference port', () => {
    const result = inspect(
      'renderer/features/settings/PlaybackSettingsSection.tsx',
      "import { loadPlayerPrefs } from '../../lib/playerPrefs';",
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must consume PlayerPreferencesPort');
  });

  it.each([
    "import { client } from '../../api/client';",
    "import { loadPlayerPrefs } from '../../lib/playerPrefs';",
    "import { playerSettingsAdapter } from './adapters/playbackSettingsAdapters';",
  ])('keeps the playback settings presenter behind injected ports: %s', source => {
    const result = inspect('renderer/features/settings/usePlaybackSettingsPresenter.ts', source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must consume PlayerPreferencesPort and injected application ports');
  });

  it.each([
    "import { client } from '../../api/client';",
    "import { mediaRuntimeManagementAdapter } from './adapters/playbackSettingsAdapters';",
  ])('keeps the media runtime download view behind its injected management port: %s', source => {
    const result = inspect('renderer/features/settings/MediaRuntimeDownloadsSection.tsx', source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must use MediaRuntimeManagementPort');
  });

  it.each([
    "import { client } from '../../api/client';",
    "import { externalPlayerDiscoveryAdapter } from './adapters/playbackSettingsAdapters';",
  ])('keeps external player settings behind injected discovery and save ports: %s', source => {
    const result = inspect('renderer/features/settings/useExternalPlayerSettings.ts', source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must consume injected application ports');
  });

  it.each([
    "import { client } from '../../api/client';",
    "import { mpvSettingsAdapter } from './adapters/playbackSettingsAdapters';",
  ])('keeps MPV settings behind injected status and settings ports: %s', source => {
    const result = inspect('renderer/features/settings/PlaybackCompatibilitySettingsSection.tsx', source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must consume injected application ports');
  });

  it.each([
    "import { client } from '../../api/client';",
    "import type Hls from 'hls.js';",
    "import { sessionAudioPreferenceMemoryAdapter } from './adapters/sessionAudioPreferenceMemoryAdapter';",
  ])('keeps audio-track workflow behind injected application ports: %s', (source) => {
    const result = inspect('renderer/features/playback/usePlayerAudioTracks.ts', source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must consume injected application ports');
  });

  it('keeps subtitle search independent from the IPC client', () => {
    const result = inspect(
      'renderer/features/playback/useSubtitleSearch.ts',
      "import { client } from '../../api/client';",
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must consume SubtitleSearchDependencies');
  });

  it('keeps subtitle query memory behind a storage adapter', () => {
    const result = inspect(
      'renderer/features/playback/useSubtitleSearch.ts',
      'export function useSubtitleSearch() { return localStorage.getItem("subtitle-query"); }',
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must consume the query-memory port');
  });

  it.each([
    'renderer/features/settings/AccountServicesSection.tsx',
    'renderer/features/settings/BackupSettingsSection.tsx',
  ])('keeps settings data access behind an injected port: %s', file => {
    const result = inspect(file, "import { client } from '../../api/client';");
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must consume an injected application port');
  });

  it('rejects direct browser storage from settings UI while allowing an adapter boundary', () => {
    const view = inspect(
      'renderer/features/settings/PlaybackSettingsSection.tsx',
      'export function PlaybackSettingsSection() { return localStorage.getItem("player"); }',
    );
    expect(view.error).toBeUndefined();
    expect(view.status).toBe(1);
    expect(view.stderr).toContain('browser storage access must be provided through a renderer adapter');

    const adapter = inspect(
      'renderer/features/settings/adapters/settingsStorageAdapter.ts',
      'export function readSetting() { return localStorage.getItem("player"); }',
    );
    expect(adapter.error).toBeUndefined();
    expect(adapter.status).toBe(0);
  });

  it('ignores browser-storage mentions in comments but catches global-qualified access', () => {
    const comment = inspect(
      'renderer/features/settings/PlaybackSettingsSection.tsx',
      '// localStorage.getItem("player") is intentionally not called here.\nexport function PlaybackSettingsSection() { return null; }',
    );
    expect(comment.error).toBeUndefined();
    expect(comment.status).toBe(0);

    const qualified = inspect(
      'renderer/features/settings/PlaybackSettingsSection.tsx',
      'export function PlaybackSettingsSection() { return window["localStorage"].getItem("player"); }',
    );
    expect(qualified.error).toBeUndefined();
    expect(qualified.status).toBe(1);
    expect(qualified.stderr).toContain('browser storage access must be provided through a renderer adapter');
  });

  it('keeps subtitle playback commands behind SubtitlePlaybackPort', () => {
    const result = inspect(
      'renderer/features/playback/useSubtitlePlayback.ts',
      "import { client } from '../../api/client';",
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must consume SubtitlePlaybackPort');
  });

  it('keeps super-resolution state behind SuperResolutionPort', () => {
    const result = inspect(
      'renderer/features/playback/useSuperResolution.ts',
      "import { client } from '../../api/client';",
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must consume SuperResolutionPort');
  });

  it.each(["import React from 'react';", "import { client } from '../../../api/client';"])(
    'keeps the super-resolution application use case independent from UI and IPC: %s',
    (source) => {
      const result = inspect('renderer/features/playback/application/superResolutionUseCases.ts', source);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('must stay framework independent and consume SuperResolutionPort');
    },
  );

  it('keeps playback preference policy free of browser storage and DOM globals', () => {
    const result = inspect(
      'renderer/features/playback/application/playerPreferences.ts',
      'export function readPreference() { return localStorage.getItem("player"); }',
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must stay independent from browser storage and DOM globals');
  });

  it.each([
    ['renderer/features/playback/DanmakuPanel.tsx', "import { mergeEndpoints } from '../../../engine/danmaku/endpoints';"],
    ['renderer/features/playback/DanmakuPanel.tsx', "import { danmakuQueryCandidates } from '../../../engine/danmaku/normalizeQuery';"],
    ['renderer/features/playback/SubtitlePanel.tsx', "import { buildSearchQuery } from '../../../engine/subtitle/normalizeQuery';"],
  ])('keeps playback views from importing engine internals instead of presentation helpers: %s', (file, source) => {
    const result = inspect(file, source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must use presentation helpers and semantic commands');
  });

  it('keeps the playback view passive by rejecting direct reads from raw player props', () => {
    const result = inspect('renderer/features/playback/VideoPlayerView.tsx', `
      export function VideoPlayerView({ props }: { props: { url: string } }) {
        return <video src={props.url} />;
      }
    `);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('passive playback view must consume the presentation model');
  });

  it('rejects a playback presenter that imports the renderer IPC client directly', () => {
    const result = inspect('renderer/features/playback/VideoPlayerPresenter.ts', "import { client } from '../../api/client';");
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('consumer-owned ports and renderer adapters');
  });

  it('rejects a playback presenter that imports the external playback renderer adapter directly', () => {
    const result = inspect('renderer/features/playback/VideoPlayerPresenter.ts', "import { openConfiguredExternalFallback } from '../../lib/externalPlay';");
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('consumer-owned ports and renderer adapters');
  });

  it.each([
    'renderer/features/subscriptions/useSubscriptionImport.ts',
    'renderer/features/subscriptions/useSubscriptionImportJobs.ts',
    'renderer/features/subscriptions/useLocalSourceImport.ts',
  ])('keeps subscription import workflows behind injected IPC ports: %s', file => {
    const result = inspect(file, "import { client } from '../../api/client';");
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must consume its injected job or file-import port');
  });

  it.each([
    'renderer/features/subscriptions/LiveSourcesSection.tsx',
    'renderer/features/subscriptions/useLiveSourcesManagement.ts',
  ])('keeps live source settings behind its consumer-owned management port: %s', file => {
    const result = inspect(file, "import { client } from '../../api/client';");
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must consume LiveSourcesManagementPort');
  });

  it.each([
    'renderer/features/subscriptions/SavedProfilesSection.tsx',
    'renderer/features/subscriptions/useSavedProfilesManagement.ts',
  ])('keeps saved profile management behind its consumer-owned port: %s', file => {
    const result = inspect(file, "import { client } from '../../api/client';");
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must consume SavedProfilesManagementPort');
  });

  it.each([
    ['renderer/features/subscriptions/ProfileSwitcher.tsx', "import { client } from '../../api/client';"],
    ['renderer/features/subscriptions/ProfileSwitcher.tsx', "import { profileSwitcherAdapter } from './adapters/profileSwitcherAdapter';"],
    ['renderer/features/subscriptions/useProfileSwitcher.ts', "import { client } from '../../api/client';"],
    ['renderer/features/subscriptions/useProfileSwitcher.ts', "import { notifyProfileChanged } from '../../lib/configEvents';"],
  ])('keeps profile switching behind its injected consumer port: %s', (file, source) => {
    const result = inspect(file, source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('injected ProfileSwitcherPort');
  });

  it.each([
    ['renderer/components/SourcePicker.tsx', "import { client } from '../api/client';"],
    ['renderer/components/SourcePicker.tsx', "import { notifyProfileChanged } from '../lib/configEvents';"],
    ['renderer/features/subscriptions/useSourcePickerController.ts', "import { client } from '../../../api/client';"],
    ['renderer/features/subscriptions/useSourcePickerController.ts', "import { sourcePickerAdapter } from './adapters/sourcePickerAdapter';"],
  ])('keeps source selection behind its injected consumer port: %s', (file, source) => {
    const result = inspect(file, source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('injected SourcePickerPort');
  });

  it.each([
    ['renderer/components/DriveBindModal.tsx', "import { client } from '../api/client';"],
    ['renderer/components/DriveLogin.tsx', "import { client } from '../api/client';"],
    ['renderer/components/UcTvBind.tsx', "import { client } from '../api/client';"],
    ['renderer/features/driveBinding/useDriveCredentialManagement.ts', "import { client } from '../../../api/client';"],
    ['renderer/features/driveBinding/application/driveBindingPorts.ts', "import { client } from '../../../api/client';"],
  ])('keeps drive-binding IPC behind injected consumer ports: %s', (file, source) => {
    const result = inspect(file, source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('DriveBindingPorts');
  });

  it.each([
    ['renderer/features/playback/DlnaCastControl.tsx', "import { client } from '../../api/client';"],
    ['renderer/features/playback/DlnaCastControl.tsx', "import { useDlnaCastPresenter } from './useDlnaCastPresenter';"],
    ['renderer/features/playback/useDlnaCastPresenter.ts', "import { client } from '../../api/client';"],
    ['renderer/features/playback/useDlnaCastPresenter.ts', "import { dlnaCastingAdapter } from './adapters/dlnaCastingAdapter';"],
    ['renderer/features/playback/application/dlnaCasting.ts', "import { client } from '../../../api/client';"],
  ])('keeps DLNA IO behind the injected playback capability port: %s', (file, source) => {
    const result = inspect(file, source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('DLNA controls must consume the playback presentation model');
  });

  it.each([
    ['renderer/features/playback/useMediaDiagnostics.ts', "import { client } from '../../api/client';"],
    ['renderer/features/playback/useMediaDiagnostics.ts', "import { mediaDiagnosticsAdapter } from './adapters/mediaDiagnosticsAdapter';"],
    ['renderer/features/playback/useHtml5PlaybackSession.ts', "import { client } from '../../api/client';"],
    ['renderer/features/playback/application/mediaDiagnostics.ts', "import { client } from '../../../api/client';"],
  ])('keeps playback diagnostics behind MediaDiagnosticsPort: %s', (file, source) => {
    const result = inspect(file, source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must report through MediaDiagnosticsPort');
  });

  it.each([
    ['renderer/features/playback/usePlayerFullscreen.ts', "import { client } from '../../api/client';"],
    ['renderer/features/playback/usePlayerFullscreen.ts', "import { playerFullscreenAdapter } from './adapters/playerFullscreenAdapter';"],
    ['renderer/features/playback/application/playerFullscreen.ts', "import { client } from '../../../api/client';"],
  ])('keeps player fullscreen behavior behind PlayerFullscreenPort: %s', (file, source) => {
    const result = inspect(file, source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('injected PlayerFullscreenPort');
  });

  it.each([
    ['renderer/features/playback/usePluginPlaybackEngines.ts', "import { client } from '../../api/client';"],
    ['renderer/features/playback/usePluginPlaybackEngines.ts', "import { pluginPlaybackEnginesAdapter } from './adapters/pluginPlaybackEnginesAdapter';"],
    ['renderer/features/playback/application/pluginPlaybackEngines.ts', "import { client } from '../../../api/client';"],
  ])('keeps plugin engine discovery behind PluginPlaybackEnginesPort: %s', (file, source) => {
    const result = inspect(file, source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must use PluginPlaybackEnginesPort');
  });

  it('keeps browser session storage behind the subscription import memory adapter', () => {
    const result = inspect('renderer/features/subscriptions/useSubscriptionImportJobs.ts', 'sessionStorage.getItem("active-job");');
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must consume a memory port');
  });

  it.each([
    ["import { client } from '../../../api/client';", 'LivePlaybackDataPort'],
    ['localStorage.getItem("live-selection");', 'LiveSelectionMemoryPort'],
    ["window.addEventListener('focus', refresh);", 'LivePlaybackRefreshPort'],
  ])('keeps live playback controllers behind injected infrastructure ports: %s', (source, boundary) => {
    const result = inspect('renderer/features/live/useLivePlayback.ts', source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(boundary);
  });

  it.each([
    ['renderer/features/discovery/useMovieSources.ts', "import { client } from '../../api/client';"],
    ['renderer/features/detail/MovieSourcesPanel.tsx', "import { client } from '../../api/client';"],
  ])('keeps aggregate movie-source search and folder IO behind application ports: %s', (file, source) => {
    const result = inspect(file, source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('consumer-owned application ports and renderer adapters');
  });

  it.each([
    "import { client } from '../../api/client';",
    "import { uiMem } from '../../lib/uiMemory';",
  ])('keeps detail route loading behind DetailDataPort: %s', source => {
    const result = inspect('renderer/features/detail/useDetailDataController.ts', source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('injected DetailDataPort');
  });

  it.each([
    "import { client } from '../../api/client';",
    "import { uiMem } from '../../lib/uiMemory';",
  ])('keeps detail playback IO behind DetailPlaybackPort: %s', source => {
    const result = inspect('renderer/features/detail/useDetailPlaybackController.ts', source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('DetailPlaybackPort');
  });

  it.each([
    ['renderer/pages/DetailPage.tsx', "import { uiMem } from '../lib/uiMemory';"],
    ['renderer/features/detail/useDetailScrollMemory.ts', "import { uiMem } from '../../../lib/uiMemory';"],
    ['renderer/features/detail/application/detailScrollMemory.ts', "import { uiMem } from '../../../lib/uiMemory';"],
  ])('keeps detail scroll persistence behind DetailScrollMemoryPort: %s', (file, source) => {
    const result = inspect(file, source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('DetailScrollMemoryPort');
  });

  it.each([
    "import { useAppDialog } from '../../components/AppDialog';",
    "import { usePluginCommandRunner } from '../plugins/PluginCommandContext';",
    "import { usePluginKeymaps } from '../plugins/usePluginKeymaps';",
  ])('keeps plugin command and dialog integration behind the player feature controller: %s', (source) => {
    const result = inspect('renderer/features/playback/VideoPlayerPresenter.ts', source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('delegate plugin command and dialog integration');
  });

  it('keeps plugin dialog UI behind PluginDialogPort', () => {
    const result = inspect('renderer/features/plugins/PluginDialogBridge.tsx', 'window.api?.plugins');
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('plugin dialog UI must consume PluginDialogPort');
  });

  it('keeps desktop preload access inside renderer adapters and persistence boundaries', () => {
    const view = inspect('renderer/features/example/presentation/ExampleView.tsx', 'window.api?.config.listSites()');
    expect(view.error).toBeUndefined();
    expect(view.status).toBe(1);
    expect(view.stderr).toContain('renderer preload access belongs in the typed API client');

    const adapter = inspect('renderer/features/example/adapters/exampleAdapter.ts', 'window.api?.config.listSites()');
    expect(adapter.error).toBeUndefined();
    expect(adapter.status).toBe(0);
  });

  it('keeps subscription import error and notice state inside its workflow', () => {
    const result = inspect(
      'renderer/features/subscriptions/useSubscriptionImport.ts',
      'interface UseSubscriptionImportOptions { setError: (message: string) => void; }',
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('subscription import feedback must be owned by its workflow');
  });

  it.each([
    "import { useHtml5PlaybackSession } from './useHtml5PlaybackSession';",
    "import { usePlaybackKernelSession } from './usePlaybackKernelSession';",
    "import { useMediaDiagnostics } from './useMediaDiagnostics';",
  ])('keeps playback engine lifecycle hooks behind the session composition boundary: %s', (source) => {
    const result = inspect('renderer/features/playback/VideoPlayerPresenter.ts', source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('player session composition boundary');
  });

  it.each([
    "import { usePluginPlaybackEngines } from './usePluginPlaybackEngines';",
    "import { resolvePlayerKernelDecision } from './application/playerKernelDecision';",
    "import { resolveKernel } from '../../lib/kernel';",
  ])('keeps kernel discovery and decision policy behind the kernel selection boundary: %s', (source) => {
    const result = inspect('renderer/features/playback/VideoPlayerPresenter.ts', source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('kernel selection boundary');
  });

  it.each([
    'window.innerWidth;',
    'window.location.reload();',
  ])('keeps renderer-window access behind playback adapters: %s', (source) => {
    const result = inspect('renderer/features/playback/VideoPlayerPresenter.ts', source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('player window adapter');
  });

  it.each([
    [
      'renderer/features/playback/useHtml5PlaybackSession.ts',
      "import { getPlayTime } from '../../lib/uiMemory';",
      'PlaybackPositionMemoryPort',
    ],
    [
      'renderer/features/playback/usePlaybackKernelSession.ts',
      "import { setPlayTime } from '../../lib/uiMemory';",
      'PlaybackPositionMemoryPort',
    ],
    [
      'renderer/features/playback/useHtml5PlaybackSession.ts',
      'const desktop = typeof window.api !== \'undefined\';',
      'PlaybackRuntimePort',
    ],
  ])('keeps playback session infrastructure behind ports: %s', (file, source, expectedPort) => {
    const result = inspect(file, source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(expectedPort);
  });

  it('rejects reintroducing the full runtime host into VOD use cases through a type import', () => {
    const result = inspect('engine/vod/example.ts', "import type { EngineHost } from '../ports';");
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('source capability ports');
  });

  it('rejects an engine host contract that imports the JS sandbox implementation type', () => {
    const result = inspect('engine/ports.ts', "import type { JsSandboxLike } from './js/JsSandbox';");
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('consumer-owned runtime ports');
  });

  it('keeps runtime provider contracts from requiring the complete engine host', () => {
    const result = inspect('engine/spider/SpiderRuntimeProvider.ts', "import type { EngineHost } from '../ports';");
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SpiderInit runtime capabilities');
  });

  it('rejects a source runtime adapter that imports the engine host instead of treating context as opaque', () => {
    const result = inspect('engine/spider/SpiderSourceRuntimeAdapter.ts', "import type { EngineHost } from '../ports';");
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('treat factory construction context as opaque');
  });

  it.each([
    "import { JsSpider } from '../js/JsSpider';",
    "import { JarSpider } from './JarSpider';",
    "import { PySpider } from './PySpider';",
  ])('rejects adding concrete runtime selection branches back to SpiderFactory: %s', (source) => {
    const result = inspect('engine/spider/SpiderFactory.ts', source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must select through SpiderRuntimeProvider');
  });

  it.each([
    ['engine/spider/JarSpider.ts', "import { JarSpiderBridge } from './JarSpiderBridge';"],
    ['engine/spider/SpiderFactory.ts', "import type { JarSpiderBridge } from './JarSpiderBridge';"],
    ['engine/spider/createBuiltinSpiderRuntimeProviders.ts', "import type { JarSpiderBridge } from './JarSpiderBridge';"],
    ['main/spider/createSpiderHostServices.ts', "import { normalizeJarUrl } from '../../engine/spider/JarSpiderBridge';"],
  ])('keeps JVM spider consumers behind JarSpiderRuntimePort: %s', (file, source) => {
    const result = inspect(file, source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must depend on JarSpiderRuntimePort or pure utilities');
  });

  it('rejects an IPC feature adapter that imports its result DTO from the parser implementation', () => {
    const result = inspect('main/ipc/configurationIpc.ts', "import type { ParseResult } from '../../engine/config/ApiConfigParser';");
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('stable shared DTOs');
  });

  it('rejects a feature IPC adapter that depends on the SpiderHost composition root', () => {
    const result = inspect('main/ipc/liveIpc.ts', "import type { SpiderHost } from '../spider/SpiderHost';");
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('consumer-owned ports');
  });

  it('rejects the backup settings adapter when it depends on the SpiderHost composition root', () => {
    const result = inspect('main/settings/backupIpc.ts', "import type { SpiderHost } from '../spider/SpiderHost';");
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('consumer-owned ports');
  });

  it.each([
    ['main/index.ts', "import { SpiderHost } from './spider/SpiderHost';"],
    ['main/ipc/index.ts', "import { SpiderHost } from '../spider/SpiderHost';"],
  ])('rejects production composition roots that reintroduce SpiderHost: %s', (file, source) => {
    const result = inspect(file, source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('production composition roots');
  });

  it('keeps persisted home-filter preferences at the HomePage composition boundary', () => {
    const result = inspect(
      'renderer/features/home/useHomePagePresenter.ts',
      "import { useHomeFilters, setHomeFilters } from '../../lib/uiPrefs';",
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('HomePage presentation coordination must consume injected state and capabilities');
  });

  it.each([
    'document.getElementById("cfg-section-title");',
    'new MutationObserver(() => {});',
    'element.scrollIntoView({ block: "start" });',
    'requestAnimationFrame(() => {});',
  ])('keeps settings deep-link DOM effects in the settings navigation hook: %s', (source) => {
    const result = inspect('renderer/pages/ConfigPage.tsx', source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('settings deep-link DOM effects belong in the settings navigation hook');
  });

  it.each([
    ['renderer/features/home/homePageViewModel.ts', "import type { HomeBrowseResultsProps } from './HomeBrowseResults';"],
    ['renderer/features/home/HomeBrowseResults.tsx', "import type { SortClassView } from './useHomeBrowseController';"],
  ])('keeps HomePage view contracts independent from concrete views and controllers: %s', (file, source) => {
    const result = inspect(file, source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must depend on feature view models, not concrete views or controller hooks');
  });

  it.each([
    ['renderer/features/home/homePageModel.ts', "import type { CascadeLevel } from '../../components/CascadeBar';"],
    ['renderer/features/home/homePageModel.ts', "import type { SortClassView } from './useHomeBrowseController';"],
    ['renderer/features/home/useHomeSourceSession.ts', "import type { SortClassView } from './useHomeBrowseController';"],
    ['renderer/features/home/useHomeSourceSession.ts', "import { selectHomeSource } from './homePageModel';"],
    ['renderer/features/home/useHomePagePresenter.ts', "import type { CascadeLevel } from '../../components/CascadeBar';"],
    ['renderer/features/home/useHomePagePresenter.ts', "import { useHomeBrowseController, type SortClassView } from './useHomeBrowseController';"],
  ])('keeps HomePage contracts independent from UI and controller-owned types: %s', (file, source) => {
    const result = inspect(file, source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/feature-owned types|feature-owned sort-class contract/);
  });

  it.each([
    "import { useWaterfall } from '../../lib/uiPrefs';",
    "import { getSessionSort } from '../../lib/sessionSort';",
  ])('keeps HomePage browse policy independent from persisted preference and session-memory adapters: %s', (source) => {
    const result = inspect('renderer/features/home/useHomeBrowseController.ts', source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('home browse workflows must receive preferences and category state through injected values and ports');
  });

  it.each([
    "import React from 'react';",
    "import { useHomeBrowseController } from '../useHomeBrowseController';",
    "import { client } from '../../../api/client';",
  ])('keeps HomeSearchWorkflow independent from UI, controller and infrastructure imports: %s', (source) => {
    const result = inspect('renderer/features/home/application/HomeSearchWorkflow.ts', source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('home search application workflows must remain UI and infrastructure independent and coordinate browse through ports');
  });

  it('rejects a playback use case that imports main-process drive, network, or torrent adapters', () => {
    const result = inspect('main/spider/SpiderPlaybackService.ts', "import { resolveShare } from '../net/driveTransfer';");
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('consumer-owned ports');
  });

  it.each([
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
  ])('keeps individual playback controls independent from the aggregate view model: %s', (file) => {
    const result = inspect(file, "import type { PlayerControlsViewModel } from './presentation/PlayerControlsViewModel';");
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('individual playback controls must depend on their narrow control model');
  });

  it.each([
    "import { client } from '../../api/client';",
    "import { configurationSnapshotAdapter } from './adapters/configurationSnapshotAdapter';",
  ])('keeps configuration snapshot reads behind the injected port: %s', (source) => {
    const result = inspect('renderer/features/settings/useConfigurationSnapshotSession.ts', source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ConfigurationSnapshotPort');
  });
  it.each([
    "window.addEventListener('focus', () => {});",
    'navigator.userAgent;',
    "const event = new StorageEvent('storage');",
  ])('keeps browser events and image environment in cover adapters: %s', (source) => {
    const result = inspect('renderer/features/covers/useCovers.ts', source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('cover workflow must consume injected settings-change and image ports');
  });
  it.each([
    "import { client } from '../../../api/client';",
    "import { profileActivationAdapter } from '../adapters/profileActivationAdapter';",
    "import { useState } from 'react';",
    "import { useNavigate } from 'react-router-dom';",
  ])('keeps profile activation behind application ports: %s', (source) => {
    const result = inspect('renderer/features/settings/application/activateConfigurationProfile.ts', source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('profile activation use case must depend on its application ports');
  });

  it.each([
    "import { usePlaybackCompatibilityPresenter } from './usePlaybackCompatibilityPresenter';",
    "import type { MpvSettingsPort } from './application/playbackSettingsPorts';",
    "import { client } from '../../api/client';",
  ])('keeps compatibility settings view passive: %s', (source) => {
    const result = inspect('renderer/features/settings/PlaybackCompatibilitySettingsView.tsx', source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('settings presentation views must consume a view model and semantic actions');
  });

  it.each([
    "useEffect(() => {}, []);",
    "document.querySelector('#settings');",
    "window.localStorage.getItem('player');",
  ])('rejects state and browser effects inside the compatibility settings view: %s', (source) => {
    const result = inspect('renderer/features/settings/PlaybackCompatibilitySettingsView.tsx', source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('settings presentation views must remain passive');
  });

  it.each([
    ['renderer/features/settings/NetworkSettingsView.tsx', "import { useState } from 'react';"],
    ['renderer/features/settings/StorageSettingsView.tsx', "useEffect(() => {}, []);"],
  ])('keeps settings views passive: %s', (file, source) => {
    const result = inspect(file, source);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('settings presentation views must remain passive');
  });

});
