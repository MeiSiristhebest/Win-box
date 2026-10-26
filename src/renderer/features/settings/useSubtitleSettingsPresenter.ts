import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { SubtitleProviderView } from '../../../shared/subtitle';
import type { SubtitleSettingsPort } from './application/subtitleSettingsPort';

export interface SubtitleSettingsViewModel {
  status: 'loading' | 'ready' | 'error';
  token: string;
  tokenSaved: boolean;
  providers: SubtitleProviderView[];
  busy: string;
  error: string;
}

const INITIAL_MODEL: SubtitleSettingsViewModel = {
  status: 'loading',
  token: '',
  tokenSaved: false,
  providers: [],
  busy: '',
  error: '',
};

export function useSubtitleSettingsPresenter(port: SubtitleSettingsPort) {
  const [model, setModel] = useState(INITIAL_MODEL);

  useEffect(() => {
    let current = true;
    void Promise.all([port.getSettings(), port.listProviders()])
      .then(([settings, providers]) => {
        if (!current) return;
        setModel({
          ...INITIAL_MODEL,
          status: 'ready',
          token: settings.assrtToken || '',
          tokenSaved: Boolean(settings.assrtToken),
          providers,
        });
      })
      .catch((error: unknown) => {
        if (current) setModel({ ...INITIAL_MODEL, status: 'error', error: errorMessage(error) });
      });
    return () => { current = false; };
  }, [port]);

  function changeToken(token: string) {
    setModel((current) => ({ ...current, token, tokenSaved: false, error: '' }));
  }

  async function saveToken() {
    const token = model.token.trim();
    if (!token || model.busy) return;
    setModel((current) => ({ ...current, busy: 'token', error: '' }));
    try {
      await port.saveSettings({ assrtToken: token });
      setModel((current) => ({ ...current, tokenSaved: true }));
      await refreshProviders(port, setModel);
    } catch (error) {
      setModel((current) => ({ ...current, error: errorMessage(error) }));
    } finally {
      setModel((current) => ({ ...current, busy: '' }));
    }
  }

  async function toggleProvider(providerId: string) {
    const provider = model.providers.find((item) => item.id === providerId);
    if (!provider || model.busy) return;
    const providers = Object.fromEntries(model.providers.map((item) => [item.id, item.enabled]));
    providers[providerId] = !provider.enabled;
    setModel((current) => ({ ...current, busy: providerId, error: '' }));
    try {
      await port.saveSettings({ providers });
      await refreshProviders(port, setModel);
    } catch (error) {
      setModel((current) => ({ ...current, error: errorMessage(error) }));
    } finally {
      setModel((current) => ({ ...current, busy: '' }));
    }
  }

  return { model, changeToken, saveToken, toggleProvider };
}

async function refreshProviders(port: SubtitleSettingsPort, setModel: Dispatch<SetStateAction<SubtitleSettingsViewModel>>) {
  const providers = await port.listProviders();
  setModel((current) => ({ ...current, providers, status: 'ready' }));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
