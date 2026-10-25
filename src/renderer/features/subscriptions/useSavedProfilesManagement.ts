import { useCallback, useRef, useState } from 'react';
import type { SavedProfilesManagementPort } from './application/savedProfilesManagementPort';

interface SavedProfilesManagementOptions {
  port: SavedProfilesManagementPort;
  onRefresh: () => Promise<void>;
}

function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useSavedProfilesManagement({ port, onRefresh }: SavedProfilesManagementOptions) {
  const [profileName, setProfileName] = useState('');
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const savingRef = useRef(false);

  const changeProfileName = useCallback((name: string) => setProfileName(name), []);
  const changeRenameDraft = useCallback((name: string) => setRenameDraft(name), []);

  const beginRename = useCallback((id: string, name: string) => {
    setRenameId(id);
    setRenameDraft(name);
  }, []);

  const cancelRename = useCallback(() => {
    setRenameId(null);
    setRenameDraft('');
  }, []);

  const saveProfile = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      await port.saveCurrentProfile(profileName.trim() || '未命名配置');
      setProfileName('');
      await onRefresh();
    } catch (error) {
      setError(describeFailure(error));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [onRefresh, port, profileName]);

  const saveRename = useCallback(async (id: string) => {
    const name = renameDraft.trim();
    cancelRename();
    if (!name) return;
    setError('');
    try {
      await port.renameProfile({ id, name });
      await onRefresh();
    } catch (error) {
      setError(describeFailure(error));
    }
  }, [cancelRename, onRefresh, port, renameDraft]);

  const deleteProfile = useCallback(async (id: string) => {
    setError('');
    try {
      await port.deleteProfile(id);
      await onRefresh();
    } catch (error) {
      setError(describeFailure(error));
    }
  }, [onRefresh, port]);

  return {
    model: { profileName, renameId, renameDraft, saving, error },
    actions: { changeProfileName, changeRenameDraft, beginRename, cancelRename, saveProfile, saveRename, deleteProfile },
  };
}
