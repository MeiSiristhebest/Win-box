// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { APP_NAV_GROUPS, NAV, ShellFrame } from '../src/renderer/layouts/ShellLayouts';
import type { ShellFrameProps } from '../src/renderer/layouts/ShellLayouts';

vi.mock('../src/renderer/layouts/WindowTitleBar', () => ({ default: () => null }));
vi.mock('../src/renderer/components/SearchPanel', () => ({ default: () => null }));
vi.mock('../src/renderer/features/subscriptions/SourcePicker', () => ({ default: () => null }));

function StatefulPage() {
  const [draft, setDraft] = useState('');
  return <input aria-label="Page draft" value={draft} onChange={(event) => setDraft(event.target.value)} />;
}

function shell(presentation: ShellFrameProps['presentation']) {
  const theme = presentation === 'integrated-nav' ? 'netflix' : presentation === 'apple-sidebar' ? 'apple' : 'douban';
  return (
    <MemoryRouter>
      <ShellFrame
        presentation={presentation}
        theme={theme}
        navItems={NAV}
        appleGroups={APP_NAV_GROUPS}
        appIcon=""
        pageTitle="Home"
        onBack={() => undefined}
        backDisabled={false}
        disclaimer={null}
      >
        <StatefulPage />
      </ShellFrame>
    </MemoryRouter>
  );
}

describe('ShellFrame', () => {
  it('keeps mounted page state when the presentation changes', () => {
    const view = render(shell('integrated-nav'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'unfinished search' } });

    view.rerender(shell('apple-sidebar'));
    expect(screen.getByRole('textbox')).toHaveProperty('value', 'unfinished search');

    view.rerender(shell('douban-header'));
    expect(screen.getByRole('textbox')).toHaveProperty('value', 'unfinished search');
  });
});
