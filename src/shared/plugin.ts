// 插件模块兼容门面：保持 shared/plugin 的既有导入路径。
// 清单校验、各类贡献契约与展示模型分别位于 plugin/ 下的独立模块。

export type { PluginReasonCode, ValidateResult } from './plugin/core';
export { isSafeRelPath } from './plugin/paths';
export { THEME_TOKENS, validateThemeContribute } from './plugin/theme';
export type { ThemeTokenKind, ThemeTokenSpec, ThemeNav, ThemeDensity, ThemeMotion, ThemeRadiusScale, ThemeShell, ThemeDetailStyle, ThemeDiscoverStyle, ThemeFilterStyle, ThemeLayout, ThemeContribute } from './plugin/theme';
export { placeholdersOf, isProviderPath } from './plugin/providerSchema';
export { RESERVED_SUBTITLE_IDS, SUB_PLACEHOLDERS_SEARCH, SUB_PLACEHOLDERS_FETCH, SUB_MAP_FIELDS, validateSubtitleProviderContribute, expandSubTemplate, jsonPathGet } from './plugin/subtitleProvider';
export type { SubHttpSpec, SubtitleProviderContribute } from './plugin/subtitleProvider';
export { RESERVED_META_IDS, META_PLACEHOLDERS, META_MAP_FIELDS, validateMetaProviderContribute } from './plugin/metaProvider';
export type { MetaProviderContribute } from './plugin/metaProvider';
export { DISCOVER_PLACEHOLDERS, DISCOVER_MAP_FIELDS, validateDiscoverSourceContribute } from './plugin/discoverSource';
export type { DiscoverSectionContribute, DiscoverSourceContribute } from './plugin/discoverSource';
export { DANMAKU_SEARCH_PLACEHOLDERS, DANMAKU_EPISODES_PLACEHOLDERS, DANMAKU_COMMENTS_PLACEHOLDERS, DANMAKU_ANIME_MAP_FIELDS, DANMAKU_EPISODE_MAP_FIELDS, validateDanmakuSourceContribute } from './plugin/danmakuSource';
export type { DanmakuSearchSpec, DanmakuEpisodesSpec, DanmakuSourceContribute } from './plugin/danmakuSource';
export { LIVE_TEMPLATE_PLACEHOLDERS, LIVE_TEMPLATE_FORMATS, liveTemplateExt, LIVE_TEMPLATE_EOL, validateLiveTemplateContribute } from './plugin/liveTemplate';
export type { LiveTemplateContribute } from './plugin/liveTemplate';
export { UI_COMMAND_PLACEMENTS, UI_COMMAND_ACTIONS, UI_NAV_TARGETS, UI_NAV_PATHS, validateUiCommandContribute, KEYMAP_SCOPES, KEYMAP_MODIFIERS, parseKeyCombo, validateKeymapContribute, keymapContributeOf } from './plugin/uiActions';
export type { UiCommandPlacement, UiCommandAction, UiNavTarget, UiCommandContribute, KeymapScope, KeymapAction, KeymapModifier, ParsedKeyCombo, KeymapContribute } from './plugin/uiActions';
export { SETTINGS_FIELD_TYPES, settingsValueError, settingsEffectiveValue, validateSettingsPanelContribute, settingsPanelContributeOf } from './plugin/settingsPanel';
export type { SettingsFieldType, SettingsValue, SettingsOption, SettingsFieldContribute, SettingsPanelContribute } from './plugin/settingsPanel';
export { UI_SLOT_IDS, UI_SLOT_ITEM_TYPES, validateUiSlotContribute, uiSlotContributeOf } from './plugin/uiSlot';
export type { UiSlotId, UiSlotItemType, UiSlotKvItem, UiSlotItem, UiSlotContribute } from './plugin/uiSlot';
export { PLAYER_ENGINE_PROTOCOLS, PLAYER_ENGINE_CAPABILITIES, PLAYER_ENGINE_PLACEHOLDERS, validatePlayerEngineContribute, playerEngineContributeOf } from './plugin/playerEngine';
export type { PlayerEngineProtocol, PlayerEngineBinarySource, PlayerEngineCapability, PlayerEngineContribute } from './plugin/playerEngine';
export * from './plugin/manifest';
export * from './plugin/viewModels';
