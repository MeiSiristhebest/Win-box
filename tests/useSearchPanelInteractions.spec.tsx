// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSearchPanelInteractions } from '../src/renderer/components/useSearchPanelInteractions';

vi.mock('../src/renderer/components/useAnchoredPanel', () => ({
  useAnchoredPanel: () => ({ position: 'fixed', left: 12 }),
}));

vi.mock('../src/renderer/lib/modalScope', () => ({ isNativeModalOpen: () => false }));

function InteractionHarness({ open, onClose }: { open: boolean; onClose: () => void }) {
  const interactions = useSearchPanelInteractions(open, onClose, 'search-panel-test');
  return (
    <>
      <div id={interactions.wrapId} onBlur={interactions.onBlur}>
        <button id={interactions.triggerId}>Search</button>
        {open && <input id={interactions.inputId} aria-label="Search query" />}
      </div>
      {open && <section id={interactions.panelId} style={interactions.panelPosition}>Search panel</section>}
      <button>Outside</button>
    </>
  );
}

describe('search panel interactions', () => {
  afterEach(cleanup);

  it('focuses the query and dismisses on Escape while restoring trigger focus', async () => {
    const onClose = vi.fn();
    render(<InteractionHarness open onClose={onClose} />);
    const trigger = screen.getByRole('button', { name: 'Search' });
    const query = screen.getByRole('textbox', { name: 'Search query' });

    await waitFor(() => expect(document.activeElement).toBe(query));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
  });

  it('dismisses when the pointer moves outside both panel and trigger', () => {
    const onClose = vi.fn();
    render(<InteractionHarness open onClose={onClose} />);

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
