// @vitest-environment happy-dom
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Tabs, type TabItem } from '../src/renderer/components/ui/Tabs';

const items = [
  { id: 'sources', label: '订阅与源' },
  { id: 'appearance', label: '外观' },
  { id: 'backup', label: '备份' },
] as const satisfies readonly TabItem<string>[];

describe('shared tabs', () => {
  it('moves focus and selection with arrow, Home, and End keys', () => {
    const onChange = vi.fn();
    function Harness() {
      const [value, setValue] = useState<'sources' | 'appearance' | 'backup'>('sources');
      return (
        <>
          <Tabs items={items} value={value} onChange={(next) => { onChange(next); setValue(next); }} label="设置分区" idPrefix="settings" />
          <div role="tabpanel" id="settings-panel" aria-labelledby={`settings-tab-${value}`} tabIndex={0}>{value}</div>
        </>
      );
    }

    render(<Harness />);
    const first = screen.getByRole('tab', { name: '订阅与源' });
    fireEvent.keyDown(first, { key: 'ArrowRight' });

    expect(onChange).toHaveBeenCalledWith('appearance');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '外观' }));
    expect(screen.getByRole('tabpanel').textContent).toBe('appearance');

    fireEvent.keyDown(screen.getByRole('tab', { name: '外观' }), { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '备份' }));
    expect(screen.getByRole('tab', { name: '备份' }).getAttribute('aria-selected')).toBe('true');
  });
});
