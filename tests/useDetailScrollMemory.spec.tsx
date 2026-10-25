// @vitest-environment happy-dom
import { useRef } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VodDetail } from '../src/shared/types';
import type { DetailScrollMemoryPort } from '../src/renderer/features/detail/application/detailScrollMemory';
import type { DetailSelectionMemory } from '../src/renderer/features/detail/application/detailDataPorts';
import { useDetailScrollMemory } from '../src/renderer/features/detail/useDetailScrollMemory';

const memoryKey = 'profile-a:source-a:movie-a';
const savedSelection: DetailSelectionMemory = { flag: '1080P', ep: 4, scrollTop: 175 };

const detailFixture = {
  id: 'movie-a', name: 'Test', pic: '', type: 'movie', year: '', area: '', director: '', actor: '',
  des: '', remarks: '', flags: [], episodes: {},
} satisfies VodDetail;

function Harness({ port, detail = null }: { port: DetailScrollMemoryPort; detail?: VodDetail | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useDetailScrollMemory({
    containerRef,
    memoryKey,
    flag: '1080P',
    episodeIndex: 4,
    detail,
  }, port);
  return <div ref={containerRef} data-testid="detail-content" />;
}

function createMemoryPort() {
  const selections = new Map<string, DetailSelectionMemory>();
  return {
    selections,
    port: {
      readSelection: (key: string) => selections.get(key),
      rememberSelection: (key: string, selection: DetailSelectionMemory) => selections.set(key, selection),
      persistSelection: vi.fn(),
    } satisfies DetailScrollMemoryPort,
  };
}

afterEach(() => cleanup());

describe('useDetailScrollMemory', () => {
  it('restores the saved scroll offset after detail content is ready', () => {
    const { selections, port } = createMemoryPort();
    selections.set(memoryKey, savedSelection);

    const { rerender } = render(<Harness port={port} detail={null} />);
    rerender(<Harness port={port} detail={detailFixture} />);

    expect((screen.getByTestId('detail-content') as HTMLDivElement).scrollTop).toBe(175);
  });

  it('remembers the current selection with the scroll offset and persists on cleanup', () => {
    const { selections, port } = createMemoryPort();
    const { unmount } = render(<Harness port={port} />);
    const container = screen.getByTestId('detail-content') as HTMLDivElement;
    container.scrollTop = 260;

    act(() => container.dispatchEvent(new Event('scroll')));

    expect(selections.get(memoryKey)).toEqual({ flag: '1080P', ep: 4, scrollTop: 260 });
    unmount();
    expect(port.persistSelection).toHaveBeenCalledOnce();
  });
});
