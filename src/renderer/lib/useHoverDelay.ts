import { useEffect, useLayoutEffect, useState } from 'react';
import { makeHoverDelay } from './hoverDelay';

export function useHoverDelay(change: (open: boolean) => void) {
  const [delay] = useState(() => makeHoverDelay(change));
  useLayoutEffect(() => { delay.update(change); }, [change, delay]);
  useEffect(() => () => delay.cancel(), [delay]);
  return delay;
}
