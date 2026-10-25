import { useCallback, useEffect, useState } from 'react';
import type { PlayerPageWindowPort } from './application/playerPageSession';

export interface PlayerPageWindowState {
  appIcon: string;
  maximized: boolean;
  mini: boolean;
  pinTop: boolean;
  minimize(): void;
  toggleMaximize(): void;
  setMini(enabled: boolean): void;
  togglePinTop(): void;
  close(): void;
}

export function usePlayerPageWindow(port: PlayerPageWindowPort): PlayerPageWindowState {
  const [appIcon, setAppIcon] = useState('');
  const [maximized, setMaximized] = useState(false);
  const [mini, setMiniState] = useState(false);
  const [pinTop, setPinTop] = useState(false);

  useEffect(() => {
    let active = true;
    void port.readAppIcon().then((icon) => {
      if (active && icon) setAppIcon(icon);
    }).catch(() => undefined);
    void port.readMaximized().then((enabled) => {
      if (active) setMaximized(Boolean(enabled));
    }).catch(() => undefined);
    void port.readAlwaysOnTop().then((enabled) => {
      if (active) setPinTop(Boolean(enabled));
    }).catch(() => undefined);
    const unsubscribe = port.onMiniChanged(setMiniState);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [port]);

  const togglePinTop = useCallback(() => {
    void port.setAlwaysOnTop(!pinTop).then((enabled) => setPinTop(Boolean(enabled))).catch(() => undefined);
  }, [pinTop, port]);
  const minimize = useCallback(() => {
    void port.minimize().catch(() => undefined);
  }, [port]);
  const toggleMaximize = useCallback(() => {
    void port.toggleMaximize().then((enabled) => setMaximized(Boolean(enabled))).catch(() => undefined);
  }, [port]);
  const setMini = useCallback((enabled: boolean) => {
    void port.setMini(enabled).catch(() => undefined);
  }, [port]);
  const close = useCallback(() => {
    void port.close().catch(() => undefined);
  }, [port]);

  return { appIcon, maximized, mini, pinTop, minimize, toggleMaximize, setMini, togglePinTop, close };
}
