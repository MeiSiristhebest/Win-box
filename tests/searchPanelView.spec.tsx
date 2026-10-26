// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchPanelView } from '../src/renderer/components/SearchPanelView';

afterEach(cleanup);

describe('SearchPanelView keyboard submission', () => {
  it('does not submit during IME composition and submits the entered query on Enter', () => {
    const onSearch = vi.fn();
    const portalTarget = document.createElement('div');
    document.body.append(portalTarget);
    const props: ComponentProps<typeof SearchPanelView> = {
      bar: false,
      open: true,
      wrapId: 'search-wrap',
      triggerId: 'search-trigger',
      inputId: 'search-query',
      panelId: 'search-panel',
      panelPosition: {},
      portalTarget,
      onBlur: vi.fn(),
      query: '  银河列车  ',
      hotList: null,
      hotLoading: false,
      suggestions: [],
      suggestionsLoading: false,
      history: [],
      onShow: vi.fn(),
      onClose: vi.fn(),
      onSearch,
      onQueryChange: vi.fn(),
      onRemoveHistory: vi.fn(),
      onClearHistory: vi.fn(),
      onRetryHotList: vi.fn(),
    };
    render(<SearchPanelView {...props} />);
    const input = screen.getByRole('textbox', { name: '搜索影片' });

    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(onSearch).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter', isComposing: false });
    expect(onSearch).toHaveBeenCalledOnce();
    expect(onSearch).toHaveBeenCalledWith('  银河列车  ');
  });
});
