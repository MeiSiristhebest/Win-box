import { client } from '../../../api/client';
import type { PluginCommandPort } from '../application/pluginCommand';
import { themeApplication } from '../../theme/themeRuntime';
import { findSkin } from '../../../lib/themeTokens';

export const pluginCommandAdapter: PluginCommandPort = {
  openExternal(url) {
    window.open(url, '_blank', 'noopener,noreferrer');
  },
  navigate(hash) {
    location.hash = hash;
  },
  setTheme(id) {
    const skin = findSkin(id);
    if (!skin) return undefined;
    themeApplication.applyTheme(id);
    return skin.label || id;
  },
  async exportLive(templateId) {
    const config = await client.cfgGet();
    const index = Math.max(0, Number(config.ui?.activeLiveIndex) || 0);
    const { groups, liveName } = await client.loadLive(index);
    const templates = await client.liveTemplates();
    const template = (templateId ? templates.find((item) => item.id === templateId) : undefined) ?? templates[0];
    if (!template) throw new Error('无可用导出模板');
    const result = await client.liveExport({
      templateId: template.id,
      groups,
      defaultName: `${liveName || 'live'}.${template.ext}`,
    });
    return { saved: result.saved, ...(result.path ? { path: result.path } : {}) };
  },
};
