import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProfileSitesView, SourceBean } from '../../../shared/types';
import type { SourcePickerPort } from './application/sourcePickerPort';

interface SourcePickerControllerOptions {
  port: SourcePickerPort;
  enabled: boolean;
  open: boolean;
}

function describeFailure(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function resolveSourcePickerPaneId(currentId: string, profiles: ProfileSitesView['profiles'], activeId: string, alignActive: boolean): string {
  return alignActive || !profiles.some(profile => profile.id === currentId) ? activeId : currentId;
}

/** Owns source/profile loading and selection. The component keeps only panel and DOM interaction state. */
export function useSourcePickerController({ port, enabled, open }: SourcePickerControllerOptions) {
  const [sources, setSources] = useState<SourceBean[]>([]);
  const [activeSourceKey, setActiveSourceKey] = useState('');
  const [profileSites, setProfileSites] = useState<ProfileSitesView | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [error, setError] = useState('');
  const [switching, setSwitching] = useState(false);
  const alive = useRef(false);
  const switchInProgress = useRef(false);
  const sourceSequence = useRef(0);
  const profileSequence = useRef(0);

  const refreshSources = useCallback(async () => {
    if (!enabled || !alive.current) return false;
    const request = ++sourceSequence.current;
    try {
      const snapshot = await port.loadCurrentSources();
      if (!alive.current || request !== sourceSequence.current) return false;
      setSources(snapshot.sources);
      setActiveSourceKey(snapshot.activeSourceKey);
      return true;
    } catch (cause) {
      if (alive.current && request === sourceSequence.current) setError(describeFailure(cause));
      return false;
    }
  }, [enabled, port]);

  const refreshProfileSites = useCallback(async (alignActive = false) => {
    if (!open || !alive.current) return false;
    const request = ++profileSequence.current;
    try {
      const snapshot = await port.loadProfileSites();
      if (!alive.current || request !== profileSequence.current) return false;
      setProfileSites(snapshot);
      setSelectedProfileId(current => resolveSourcePickerPaneId(current, snapshot.profiles, snapshot.activeId, alignActive));
      return true;
    } catch (cause) {
      if (!alive.current || request !== profileSequence.current) return false;
      setError(describeFailure(cause));
      setProfileSites(null);
      return false;
    }
  }, [open, port]);

  useEffect(() => {
    alive.current = true;
    if (!enabled) return () => { alive.current = false; };
    const unsubscribe = port.subscribeToCurrentSourcesRefresh(() => { void refreshSources(); });
    // oxlint-disable-next-line react/set-state-in-effect -- Starts an async port refresh; state changes only after loadCurrentSources settles.
    void refreshSources();
    return () => {
      alive.current = false;
      sourceSequence.current += 1;
      profileSequence.current += 1;
      unsubscribe();
    };
  }, [enabled, port, refreshSources]);

  useEffect(() => {
    if (!open) return;
    // oxlint-disable-next-line react/set-state-in-effect -- Starts an async port refresh; state changes only after loadProfileSites settles.
    void refreshProfileSites(true);
    const unsubscribe = port.subscribeToProfileSitesRefresh(() => { void refreshProfileSites(); });
    return () => {
      profileSequence.current += 1;
      unsubscribe();
    };
  }, [enabled, open, port, refreshProfileSites]);

  const beginOpen = useCallback(() => {
    setProfileSites(null);
    setSelectedProfileId('');
  }, []);

  const clearError = useCallback(() => setError(''), []);

  const activateProfile = useCallback(async (profileId: string) => {
    if (!profileId || switchInProgress.current || !profileSites || profileId === profileSites.activeId) return false;
    switchInProgress.current = true;
    setSwitching(true);
    setError('');
    try {
      await port.activateProfile(profileId);
      if (alive.current) setSelectedProfileId(profileId);
      port.publishProfileChanged();
      return true;
    } catch (cause) {
      if (alive.current) setError(describeFailure(cause));
      return false;
    } finally {
      switchInProgress.current = false;
      if (alive.current) setSwitching(false);
    }
  }, [port, profileSites]);

  const selectSource = useCallback(async (sourceKey: string, targetProfileId?: string, activeProfileId?: string) => {
    if (switchInProgress.current) return false;
    if (!targetProfileId || targetProfileId === activeProfileId) {
      if (sourceKey === activeSourceKey) return true;
      try {
        await port.setActiveSource(sourceKey);
        if (alive.current) setActiveSourceKey(sourceKey);
        port.publishSourceChanged(sourceKey);
        return true;
      } catch (cause) {
        if (alive.current) setError(describeFailure(cause));
        return false;
      }
    }

    switchInProgress.current = true;
    setSwitching(true);
    setError('');
    try {
      await port.switchProfileSource(targetProfileId, sourceKey);
      if (alive.current) setActiveSourceKey(sourceKey);
      port.publishProfileChanged(sourceKey);
      return true;
    } catch (cause) {
      if (alive.current) setError(describeFailure(cause));
      return false;
    } finally {
      switchInProgress.current = false;
      if (alive.current) setSwitching(false);
    }
  }, [activeSourceKey, port]);

  return {
    model: { sources, activeSourceKey, profileSites, selectedProfileId, error, switching },
    actions: { beginOpen, refreshSources, refreshProfileSites, activateProfile, selectSource, clearError },
  };
}
