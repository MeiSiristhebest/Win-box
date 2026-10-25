import { useCallback, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ProfileActivationPort } from './application/configurationPagePorts';
import { activateConfigurationProfile } from './application/activateConfigurationProfile';

interface ConfigurationProfileActivationOptions {
  profile: ProfileActivationPort;
  refreshConfiguration(): Promise<void>;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  importRunning: boolean;
}

/** Coordinates profile activation with settings mutations and presents failures to the owning section. */
export function useConfigurationProfileActivation({
  profile,
  refreshConfiguration,
  busy,
  setBusy,
  importRunning,
}: ConfigurationProfileActivationOptions) {
  const [error, setError] = useState('');
  const activationInProgress = useRef(false);

  const activate = useCallback(async (profileId: string): Promise<boolean> => {
    if (busy || importRunning || activationInProgress.current) return false;

    activationInProgress.current = true;
    setError('');
    setBusy(true);
    try {
      await activateConfigurationProfile(profileId, { profile, refreshConfiguration });
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      activationInProgress.current = false;
      setBusy(false);
    }
  }, [busy, importRunning, profile, refreshConfiguration, setBusy]);

  return { error, activate };
}
