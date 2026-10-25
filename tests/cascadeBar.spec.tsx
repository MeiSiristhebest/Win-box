// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import CascadeBar from '../src/renderer/components/CascadeBar';

describe('cascade selection groups', () => {
  it('names each option group from its visible level label and exposes the selected option', () => {
    render(
      <CascadeBar
        levels={[{
          key: 'region',
          label: '地区',
          value: 'east',
          options: [
            { id: 'all', label: '全部' },
            { id: 'east', label: '华东' },
          ],
        }]}
        onPick={() => undefined}
      />,
    );

    const group = screen.getByRole('group', { name: '地区' });
    const selected = screen.getByRole('button', { name: '华东' });
    expect(group.tagName).toBe('FIELDSET');
    expect(group.contains(selected)).toBe(true);
    expect(selected.getAttribute('aria-pressed')).toBe('true');
  });
});
