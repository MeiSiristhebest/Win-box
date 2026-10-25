import { useCallback, useEffect, useState } from 'react';
import type { WindowTitleBarPort } from './application/windowTitleBar';

export function useWindowTitleBarPresenter(port: WindowTitleBarPort) {
  const [appIcon, setAppIcon] = useState('');
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let active = true;
    void port.loadAppIcon().then((icon) => {
      if (active && icon) setAppIcon(icon);
    }).catch(() => undefined);
    void port.readMaximized().then((value) => {
      if (active) setMaximized(value);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [port]);

  const onMinimize = useCallback(() => {
    void port.minimize().catch(() => undefined);
  }, [port]);

  const onMaximizeToggle = useCallback(() => {
    void port.toggleMaximize().then(setMaximized).catch(() => undefined);
  }, [port]);

  const onClose = useCallback(() => {
    void port.close().catch(() => undefined);
  }, [port]);

  return { appIcon, maximized, onMinimize, onMaximizeToggle, onClose };
}
