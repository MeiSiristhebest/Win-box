import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SourceBean } from '../../../shared/types';
import { needsDriveBind } from '../../../shared/driveProvider';
import type { HomeDrivePort } from './application/homePorts';

const DRIVE_LABELS: Record<string, string> = {
  quark: '夸克',
  uc: 'UC',
  baidu: '百度',
  ali: '阿里',
  '115': '115',
  bili: '哔哩',
};

/** Owns account-binding status and focus refreshes for the current source. */
export function useHomeDriveBinding({
  source,
  port,
  afterSave,
}: {
  source?: SourceBean;
  port: HomeDrivePort;
  afterSave: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [learnedSourceKeys, setLearnedSourceKeys] = useState<string[]>([]);

  const refreshCredentials = useCallback((): void => {
    void Promise.resolve().then(() => port.getCredentials()).then(setCredentials).catch(() => undefined);
  }, [port]);
  const refreshLearnedSources = useCallback((): void => {
    void Promise.resolve().then(() => port.getLearnedSourceKeys()).then(setLearnedSourceKeys).catch(() => undefined);
  }, [port]);

  const required = needsDriveBind(source, learnedSourceKeys);
  const boundNames = useMemo(
    () => Object.keys(DRIVE_LABELS).filter((provider) => credentials[provider]).map((provider) => DRIVE_LABELS[provider]),
    [credentials],
  );

  useEffect(() => {
    if (required) refreshCredentials();
  }, [required, refreshCredentials]);

  useEffect(() => {
    refreshLearnedSources();
    window.addEventListener('focus', refreshLearnedSources);
    window.addEventListener('winbox:sources-changed', refreshLearnedSources);
    return () => {
      window.removeEventListener('focus', refreshLearnedSources);
      window.removeEventListener('winbox:sources-changed', refreshLearnedSources);
    };
  }, [refreshLearnedSources]);

  const closeDialog = useCallback(() => setDialogOpen(false), []);
  const openDialog = useCallback(() => setDialogOpen(true), []);
  const onSaved = useCallback(() => {
    refreshCredentials();
    afterSave();
  }, [afterSave, refreshCredentials]);

  return { required, boundNames, dialogOpen, openDialog, closeDialog, onSaved };
}
