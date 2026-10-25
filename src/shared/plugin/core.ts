export type PluginReasonCode =
  | 'MISSING_MANIFEST' | 'ID_INVALID' | 'API_VERSION_MISMATCH' | 'KIND_PERM_MISMATCH'
  | 'UNKNOWN_CONTRIBUTE' | 'UNKNOWN_CONTRIBUTE_KIND' | 'UNKNOWN_PERMISSION'
  | 'PATH_ESCAPE' | 'DEP_NOT_ALLOWED' | 'BAD_UPDATE_URL'
  // 皮肤（`contributes.theme`）——沿用 `docs/design/皮肤与主题规范.md` §5 的原因码
  | 'THEME_TOKENS_REQUIRED' | 'UNKNOWN_THEME_TOKEN' | 'BAD_THEME_TOKEN_VALUE'
  | 'THEME_STYLE_NOT_ALLOWED' | 'BAD_THEME_LAYOUT'
  // 字幕源 / 元数据源（L2 声明式 provider）
  | 'SUBTITLE_PROVIDER_INVALID' | 'SUBTITLE_ID_TAKEN' | 'BAD_PROVIDER_URL' | 'BAD_PROVIDER_PATH'
  | 'META_PROVIDER_INVALID' | 'META_ID_TAKEN'
  | 'DISCOVER_PROVIDER_INVALID'
  | 'DANMAKU_PROVIDER_INVALID'
  // 直播输出模板（L2 声明式**输出**；不发请求）
  | 'LIVE_TEMPLATE_INVALID' | 'BAD_LIVE_TEMPLATE_LINE'
  // 受限动作按钮（L3 声明式 UI；动作词表 + 挂载点白名单）
  | 'UI_COMMAND_INVALID' | 'BAD_UI_COMMAND_URL'
  // 追加快捷键（L3 声明式 UI；动作复用上表；键位必须含 Ctrl/Alt/Meta）
  | 'KEYMAP_INVALID' | 'BAD_KEYMAP_KEY' | 'BAD_KEYMAP_URL'
  // 插件设置面板（L3 声明式 UI；4 类受限字段；宿主代持久化，读取面留 L4）
  | 'SETTINGS_PANEL_INVALID' | 'BAD_SETTINGS_DEFAULT'
  // 受限 UI 槽位（L3 声明式 UI；6 类受限组件；link 复用动作词表）
  | 'UI_SLOT_INVALID' | 'BAD_UI_SLOT_URL'
  // L4 权限说明（`permissionNotes`；键必须 ⊆ 已声明权限，值 1~200 字无换行）
  | 'BAD_PERMISSION_NOTES'
  // 第三方播放内核（`contributes.player.engine`；宿主托管进程 — 插件只给描述符）
  | 'PLAYER_ENGINE_INVALID' | 'BAD_ENGINE_ARGS';

export interface ValidateResult { ok: boolean; reasonCode?: PluginReasonCode; reason?: string }

/** id 规则：`[a-z0-9-]{3,40}`，且不以 `-` 开头/结尾 */
export const ID_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
