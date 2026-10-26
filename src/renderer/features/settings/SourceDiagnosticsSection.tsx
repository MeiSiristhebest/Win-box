import type { SourceDiagnosticsPort } from './application/settingsSectionPorts';
import { SourceDiagnosticsView } from './SourceDiagnosticsView';
import type { SourceDiagnosticsRequest } from './useSourceDiagnosticsPresenter';
import { useSourceDiagnosticsPresenter } from './useSourceDiagnosticsPresenter';

interface SourceDiagnosticsSectionProps {
  request: SourceDiagnosticsRequest | null;
  port: SourceDiagnosticsPort;
  onClose: () => void;
}

export function SourceDiagnosticsSection({ request, port, onClose }: SourceDiagnosticsSectionProps) {
  const model = useSourceDiagnosticsPresenter(request, port);
  return <SourceDiagnosticsView model={model} onClose={onClose} />;
}
