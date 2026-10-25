import { useCallback, useEffect, useRef, useState } from 'react';
import type { DriveBindingPromptPort } from './application/driveBindingPorts';

export type { DriveBindingPromptPort } from './application/driveBindingPorts';

export interface DriveBindingPromptOptions {
  url: string;
  providerOverride?: string | null;
  port: DriveBindingPromptPort;
  onBound?: () => void;
}

/** Owns drive credential detection and the prompt lifecycle for one playback session. */
export function useDriveBindingPrompt({ url, providerOverride, port, onBound }: DriveBindingPromptOptions) {
  const candidate = String(providerOverride ?? '').trim() || port.providerFromUrl(url) || '';
  const requestKey = JSON.stringify([url, providerOverride ?? null]);
  const [prompt, setPrompt] = useState<{ requestKey: string; provider: string; modalOpen: boolean } | null>(null);
  const dismissedRef = useRef(false);

  useEffect(() => {
    if (!candidate || dismissedRef.current) return;

    let active = true;
    void Promise.resolve()
      .then(() => port.getCredentials())
      .then((credentials) => {
        if (!active) return;
        if (credentials[candidate]) return;
        setPrompt({ requestKey, provider: candidate, modalOpen: true });
      })
      .catch(() => {
        if (!active) return;
        // Surface the binding path when credential status cannot be read.
        setPrompt({ requestKey, provider: candidate, modalOpen: true });
      });
    return () => { active = false; };
  }, [candidate, requestKey, port]);

  const currentPrompt = candidate && prompt?.requestKey === requestKey ? prompt : null;
  const openModal = useCallback(() => {
    setPrompt((current) => current?.requestKey === requestKey ? { ...current, modalOpen: true } : current);
  }, [requestKey]);
  const dismissNotice = useCallback(() => {
    dismissedRef.current = true;
    setPrompt(null);
  }, []);
  const closeModal = useCallback(() => {
    dismissedRef.current = true;
    setPrompt((current) => current?.requestKey === requestKey ? { ...current, modalOpen: false } : current);
  }, [requestKey]);
  const onSaved = useCallback(() => {
    setPrompt(null);
    dismissedRef.current = false;
    onBound?.();
  }, [onBound]);

  return {
    provider: currentPrompt?.provider ?? null,
    modalOpen: currentPrompt?.modalOpen ?? false,
    openModal,
    dismissNotice,
    closeModal,
    onSaved,
  };
}
