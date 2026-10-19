import { useState } from 'react';
import { client } from '../../api/client';
import { useAppDialog } from '../../components/AppDialog';
import { prepareRendererBackupRestore, STORAGE_EPOCH_KEY } from '../../lib/storageEpoch';

export function BackupSettingsSection({ active }: { active: boolean }) {
  const dialog = useAppDialog();
  const [message, setMessage] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);
  const [busy, setBusy] = useState(false);

  function collectLocalStorage(): Record<string, string> {
    const out: Record<string, string> = {};
    try {
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (!key || key === STORAGE_EPOCH_KEY) continue;
        const value = localStorage.getItem(key);
        if (typeof value === 'string') out[key] = value;
      }
    } catch {
      // Back up main-process settings when renderer storage is unavailable.
    }
    return out;
  }

  async function exportBackup() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await client.backupExport(collectLocalStorage());
      setMessage(result.saved ? { text: `已导出到：${result.path}`, kind: 'ok' } : { text: '已取消导出', kind: 'ok' });
    } catch (error) {
      setMessage({ text: (error as Error).message, kind: 'err' });
    } finally {
      setBusy(false);
    }
  }

  async function importBackup() {
    if (!(await dialog.confirm('导入备份会覆盖当前的设置、凭据、收藏与观看历史，并关闭播放、详情和搜索窗口。确定继续？', { title: '导入设置备份', confirmLabel: '继续导入', tone: 'danger' }))) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await client.backupImport();
      if (result.canceled) {
        setMessage({ text: '已取消导入', kind: 'ok' });
        return;
      }
      if (!result.ok) {
        setMessage({ text: result.error || '导入失败', kind: 'err' });
        return;
      }
      if (!result.restoreId) throw new Error('备份恢复会话缺失，请重新选择文件');
      let transaction: ReturnType<typeof prepareRendererBackupRestore> | undefined;
      try {
        transaction = prepareRendererBackupRestore(result.renderer || {});
        await client.backupCommit(result.restoreId);
      } catch (error) {
        transaction?.rollback();
        await client.backupCancel(result.restoreId).catch(() => undefined);
        throw error;
      }
      window.location.reload();
    } catch (error) {
      setMessage({ text: (error as Error).message, kind: 'err' });
    } finally {
      setBusy(false);
    }
  }

  if (!active) return null;

  return (
    <div className="card" style={{ padding: 12, marginBottom: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          备份内容：订阅源与档案、网盘 Cookie、字幕与 TMDB 凭据、弹幕与播放偏好、代理、快捷键、外观、观看历史与收藏。
        </span>
        <span className="muted" style={{ fontSize: 12 }}>
          凭据（网盘 Cookie 和接口密钥）会以明文写入备份文件。请妥善保管文件。
        </span>
        <div className="row" style={{ alignItems: 'center', gap: 10 }}>
          <button className="primary" disabled={busy} onClick={() => void exportBackup()}>导出设置备份</button>
          <button disabled={busy} onClick={() => void importBackup()}>导入设置备份</button>
          {message && <span className={message.kind === 'err' ? 'err' : 'status'} style={{ margin: 0 }} aria-live="polite">{message.text}</span>}
        </div>
      </div>
    </div>
  );
}
