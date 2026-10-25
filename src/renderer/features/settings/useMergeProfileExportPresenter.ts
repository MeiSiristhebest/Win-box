import { useCallback, useState } from 'react';
import { mergeAndSaveProfiles, type MergeProfileExportPort } from './application/mergeProfileExport';

export interface MergeProfileExportMessage {
  text: string;
  kind: 'ok' | 'err';
}

export function useMergeProfileExportPresenter(port: MergeProfileExportPort) {
  const [selectedProfileIds, setSelectedProfileIds] = useState<Set<string>>(() => new Set());
  const [message, setMessage] = useState<MergeProfileExportMessage | null>(null);

  const toggleProfile = useCallback((profileId: string) => {
    setSelectedProfileIds((current) => {
      const next = new Set(current);
      if (next.has(profileId)) next.delete(profileId);
      else next.add(profileId);
      return next;
    });
    setMessage(null);
  }, []);

  const exportSelected = useCallback(async () => {
    if (!selectedProfileIds.size) {
      setMessage({ text: '请先勾选要合并的配置档案', kind: 'err' });
      return;
    }

    setMessage(null);
    try {
      const result = await mergeAndSaveProfiles([...selectedProfileIds], port);
      if (result.kind === 'cancelled') {
        setMessage({ text: '已取消保存（合并内容未落盘，原始文件未受影响）', kind: 'ok' });
      } else {
        setMessage({
          text: `已导出到：${result.path}（合并 ${result.profileCount} 个配置 · 去重后 ${result.keptSourceCount} 个源 / 原共 ${result.totalSourceCount} 个）`,
          kind: 'ok',
        });
      }
    } catch (error) {
      setMessage({ text: `合并失败：${error instanceof Error ? error.message : String(error)}`, kind: 'err' });
    }
  }, [port, selectedProfileIds]);

  return { selectedProfileIds, message, toggleProfile, exportSelected };
}
