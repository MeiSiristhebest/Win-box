import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UserConfig } from '../../../shared/types';
import type { ProfileSwitcherPort } from './application/profileSwitcherPort';
import { profileChoices } from './profileChoices';

interface ProfileSwitcherOptions {
  port: ProfileSwitcherPort;
  query: string;
}

function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useProfileSwitcher({ port, query }: ProfileSwitcherOptions) {
  const [config, setConfig] = useState<UserConfig | null>(null);
  const [error, setError] = useState('');
  const [switching, setSwitching] = useState(false);
  const alive = useRef(false);
  const switchingRef = useRef(false);
  const publishingOwnChange = useRef(false);
  const loadSequence = useRef(0);

  const refresh = useCallback(async () => {
    if (!alive.current) return false;
    const request = ++loadSequence.current;
    try {
      const value = await port.loadConfiguration();
      if (alive.current && request === loadSequence.current) {
        setConfig(value);
        return true;
      }
      return false;
    } catch (cause) {
      if (alive.current && request === loadSequence.current) setError(describeFailure(cause));
      return false;
    }
  }, [port]);

  useEffect(() => {
    alive.current = true;
    const unsubscribe = port.subscribeToProfileRefresh(() => {
      if (!publishingOwnChange.current) void refresh();
    });
    // oxlint-disable-next-line react/set-state-in-effect -- Loads external configuration asynchronously after the presenter becomes active.
    void refresh();
    return () => {
      alive.current = false;
      loadSequence.current += 1;
      unsubscribe();
    };
  }, [port, refresh]);

  const activate = useCallback(async (profileId: string) => {
    if (switchingRef.current) return false;
    if (profileId === config?.activeProfileId) return true;
    switchingRef.current = true;
    setSwitching(true);
    setError('');
    try {
      await port.activateProfile(profileId);
      if (alive.current) setConfig(current => current ? { ...current, activeProfileId: profileId } : current);
      publishingOwnChange.current = true;
      try {
        port.publishProfileChanged();
      } finally {
        publishingOwnChange.current = false;
      }
      return await refresh();
    } catch (cause) {
      if (alive.current) setError(describeFailure(cause));
      return false;
    } finally {
      switchingRef.current = false;
      if (alive.current) setSwitching(false);
    }
  }, [config?.activeProfileId, port, refresh]);

  const clearError = useCallback(() => setError(''), []);
  const choices = useMemo(() => config ? profileChoices(config) : [], [config]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = useMemo(() => choices.filter(item =>
    !normalizedQuery || (item.name + ' ' + item.groupName).toLocaleLowerCase().includes(normalizedQuery),
  ), [choices, normalizedQuery]);
  const active = config?.profiles.find(profile => profile.id === config.activeProfileId);
  const activeLabel = active?.name || (config?.sources.length || config?.lives.length ? '当前配置' : '未导入');

  return {
    model: { config, choices, filtered, activeLabel, error, switching },
    actions: { refresh, activate, clearError },
  };
}
