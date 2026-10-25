import { useEffect, useLayoutEffect, useRef } from 'react';
import type { RelaySpeedEventsPort } from './application/playerRuntimeEventsPorts';

export function useRelaySpeedSubscription(events: RelaySpeedEventsPort, onSpeed: (kilobytesPerSecond: number) => void): void {
  const onSpeedRef = useRef(onSpeed);
  useLayoutEffect(() => {
    onSpeedRef.current = onSpeed;
  }, [onSpeed]);

  useEffect(() => events.subscribe((speed) => onSpeedRef.current(speed)), [events]);
}
