export type ConfigurationSettingsTab =
  | 'sources'
  | 'health'
  | 'profiles'
  | 'account'
  | 'storage'
  | 'appearance'
  | 'play'
  | 'shortcut'
  | 'network'
  | 'backup'
  | 'plugins';

export interface ConfigurationSettingsSection {
  id: ConfigurationSettingsTab;
  label: string;
  description: string;
  keywords: string;
}

export const CONFIGURATION_SETTINGS_SECTIONS: readonly ConfigurationSettingsSection[] = [
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

const SECTION_TAB_ALIASES: Readonly<Record<string, ConfigurationSettingsTab>> = {
  import: 'sources', sources: 'sources', live: 'sources', lives: 'sources',
  audit: 'health', cache: 'health', merge: 'profiles',
  subtitle: 'account', meta: 'account',
  'plugin-engines': 'play', 'plugin-keymap': 'shortcut',
  motion: 'appearance', 'show-discover': 'appearance', 'ui-scale': 'appearance',
  'poster-size': 'appearance', 'nav-mode': 'appearance', 'home-browse': 'appearance',
  'm3u8-purify': 'play', 'bt-player': 'play', 'vod-player': 'play', 'mpv-kernel': 'play',
};

export interface ConfigurationPageRoute {
  requestedSection: string;
  requestedTab: ConfigurationSettingsTab | undefined;
  activeTab: ConfigurationSettingsTab;
}

function resolveKnownTab(value: string | null): ConfigurationSettingsTab | undefined {
  return CONFIGURATION_SETTINGS_SECTIONS.find((section) => section.id === value)?.id;
}

export function resolveConfigurationPageRoute(searchParams: URLSearchParams): ConfigurationPageRoute {
  const requestedSection = searchParams.get('section') || '';
  const requestedTab = resolveKnownTab(requestedSection)
    ?? SECTION_TAB_ALIASES[requestedSection]
    ?? (requestedSection.startsWith('plugin-') ? 'plugins' : undefined)
    ?? resolveKnownTab(searchParams.get('tab'));

  return {
    requestedSection,
    requestedTab,
    activeTab: requestedTab ?? 'sources',
  };
}

export function normalizeConfigurationSettingsSearch(query: string): string {
  return query.trim().toLocaleLowerCase();
}

export function searchConfigurationSettings(query: string): readonly ConfigurationSettingsSection[] {
  const searchTerm = normalizeConfigurationSettingsSearch(query);
  return CONFIGURATION_SETTINGS_SECTIONS.filter((section) =>
    `${section.label} ${section.description} ${section.keywords}`.toLocaleLowerCase().includes(searchTerm),
  );
}
