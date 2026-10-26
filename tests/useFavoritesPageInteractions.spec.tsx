// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useFavoritesPageInteractions } from '../src/renderer/features/favorites/useFavoritesPageInteractions';

function InteractionHarness({ editingKey }: { editingKey: string | null }) {
  const interactions = useFavoritesPageInteractions(editingKey);
  return editingKey ? <input id={interactions.titleInputId} aria-label="Favorite title" /> : null;
}

describe('favorite page interactions', () => {
  afterEach(cleanup);

  it('focuses the title field when editing starts or moves to another favorite', async () => {
    const { rerender } = render(<InteractionHarness editingKey={null} />);
    rerender(<InteractionHarness editingKey="first" />);
    const title = screen.getByRole('textbox', { name: 'Favorite title' });

    await waitFor(() => expect(document.activeElement).toBe(title));
    rerender(<InteractionHarness editingKey="second" />);

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Favorite title' })));
  });
});
