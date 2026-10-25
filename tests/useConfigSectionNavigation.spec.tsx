// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useConfigSectionNavigation } from '../src/renderer/features/settings/useConfigSectionNavigation';

describe('useConfigSectionNavigation', () => {
  it('opens a collapsed parent after a conditional deep-link target mounts', async () => {
    const panel = document.createElement('div');
    panel.id = 'config-panel';
    const parent = document.createElement('details');
    const scrollIntoView = vi.fn();
    document.body.append(panel);

    const { result, unmount } = renderHook(() => useConfigSectionNavigation({
      requestedSection: 'import',
      requestedTab: 'sources',
      activeTab: 'sources',
    }));

    try {
      const target = document.createElement('section');
      target.id = 'cfg-import';
      target.scrollIntoView = scrollIntoView;
      parent.append(target);
      panel.append(parent);

      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledOnce());
      expect(parent.open).toBe(true);

      const heading = document.createElement('h2');
      heading.id = 'cfg-section-title';
      panel.append(heading);
      act(() => result.current.focusSectionHeading());
      await waitFor(() => expect(document.activeElement).toBe(heading));
    } finally {
      unmount();
      panel.remove();
    }
  });
});
