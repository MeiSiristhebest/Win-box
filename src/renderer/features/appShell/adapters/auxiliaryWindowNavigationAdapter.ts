import { client } from '../../../api/client';
import type { AuxiliaryWindowNavigationPort } from '../application/auxiliaryWindowNavigationPort';

export const auxiliaryWindowNavigationAdapter: AuxiliaryWindowNavigationPort = {
  subscribeToNavigation: listener => client.winOnNavigate(listener),
  announceReady: () => client.winRouteReady(),
  schedule(callback) {
    const timer = window.setTimeout(callback, 0);
    return () => window.clearTimeout(timer);
  },
};
