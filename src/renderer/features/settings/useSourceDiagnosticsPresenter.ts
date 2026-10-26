import { useEffect, useState } from 'react';
import type { SourceDebugReport } from '../../../shared/types';
import type { SourceDiagnosticsPort } from './application/settingsSectionPorts';

export interface SourceDiagnosticsRequest {
  sourceKey: string;
  revision: number;
}

type RequestState =
  | { revision: number; status: 'loading' }
  | { revision: number; status: 'ready'; report: SourceDebugReport }
  | { revision: number; status: 'error'; error: string };

export type SourceDiagnosticsViewModel =
  | { sourceKey: string; status: 'loading' }
  | { sourceKey: string; status: 'ready'; report: SourceDebugReport }
  | { sourceKey: string; status: 'error'; error: string };

export function useSourceDiagnosticsPresenter(request: SourceDiagnosticsRequest | null, port: SourceDiagnosticsPort): SourceDiagnosticsViewModel | null {
  const [state, setState] = useState<RequestState | null>(null);

  useEffect(() => {
    if (!request) return;
    let current = true;

    void Promise.resolve()
      .then(() => port.debugSource(request.sourceKey))
      .then((report) => {
        if (current) setState({ revision: request.revision, status: 'ready', report });
      })
      .catch((cause: unknown) => {
        if (current) setState({
          revision: request.revision,
          status: 'error',
          error: cause instanceof Error ? cause.message : String(cause),
        });
      });

    return () => { current = false; };
  }, [request, port]);

  if (!request) return null;
  const currentState = state?.revision === request.revision ? state : { revision: request.revision, status: 'loading' as const };
  return currentState.status === 'ready'
    ? { sourceKey: request.sourceKey, status: 'ready', report: currentState.report }
    : currentState.status === 'error'
      ? { sourceKey: request.sourceKey, status: 'error', error: currentState.error }
      : { sourceKey: request.sourceKey, status: 'loading' };
}
