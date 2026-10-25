// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SourceHealthAuditSection } from '../src/renderer/features/settings/SourceHealthAuditSection';

describe('SourceHealthAuditSection', () => {
  it('renders audit errors in the audit section', () => {
    render(<SourceHealthAuditSection
      audit={null}
      auditBusy={false}
      filter="all"
      sources={[]}
      onRunAudit={vi.fn()}
      onDeleteFailedSources={vi.fn()}
      onFilterChange={vi.fn()}
      error="体检失败：network unavailable"
    />);

    expect(screen.getByRole('alert').textContent).toBe('体检失败：network unavailable');
  });
});
