import { useCallback, useEffect, useState } from 'react';
import type { LiveGroup } from '../../../shared/types';
import type { LiveTemplateView } from '../../../shared/plugin';
import { selectLiveExportTemplate, type LiveExportPort } from './application/liveExport';

export function useLiveExportPresenter(contextKey: string, port: LiveExportPort) {
  const [templates, setTemplates] = useState<LiveTemplateView[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [messageState, setMessageState] = useState({ key: '', text: '' });

  useEffect(() => {
    let active = true;
    void port.listTemplates().then((items) => {
      if (!active) return;
      setTemplates(items);
      setSelectedTemplateId(items[0]?.id ?? '');
    }).catch(() => undefined);
    return () => { active = false; };
  }, [port]);

  const exportMessage = messageState.key === contextKey ? messageState.text : '';

  const exportCurrent = useCallback(async (groups: LiveGroup[], liveName: string): Promise<void> => {
    const template = selectLiveExportTemplate(templates, selectedTemplateId);
    if (!template || !groups.length) return;
    setMessageState({ key: contextKey, text: '导出中…' });
    try {
      const result = await port.exportGroups({
        templateId: template.id,
        groups,
        defaultName: `${liveName || 'live'}.${template.ext}`,
      });
      setMessageState({ key: contextKey, text: result.saved ? `已导出到：${result.path}` : '已取消导出' });
    } catch (cause) {
      setMessageState({ key: contextKey, text: `导出失败：${cause instanceof Error ? cause.message : String(cause)}` });
    }
  }, [contextKey, port, selectedTemplateId, templates]);

  return {
    templates,
    selectedTemplateId,
    exportMessage,
    selectTemplate: setSelectedTemplateId,
    exportCurrent,
  };
}
