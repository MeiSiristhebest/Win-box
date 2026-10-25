import { useMemo } from 'react';
import { createWindowTitleBarAdapter } from '../features/windowTitleBar/adapters/windowTitleBarAdapter';
import { useWindowTitleBarPresenter } from '../features/windowTitleBar/useWindowTitleBarPresenter';
import TitleBarView, { type TitleBarViewProps } from '../components/TitleBarView';

type WindowTitleBarProps = Omit<TitleBarViewProps, 'appIcon' | 'maximized' | 'onMinimize' | 'onMaximizeToggle' | 'onClose'>;

/** Route/layout composition for the Electron window controls used by non-player shells. */
export default function WindowTitleBar(props: WindowTitleBarProps) {
  const port = useMemo(() => createWindowTitleBarAdapter(), []);
  const controls = useWindowTitleBarPresenter(port);

  return (
    <TitleBarView
      {...props}
      {...controls}
    />
  );
}
