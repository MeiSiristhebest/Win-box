// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DetailEpisodeList } from '../src/renderer/features/detail/DetailEpisodeList';
import type { Episode } from '../src/shared/types';

afterEach(() => cleanup());

function episodes(count: number): Episode[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `第${index + 1}集`,
    url: `https://example.test/episode-${index + 1}`,
  }));
}

describe('DetailEpisodeList', () => {
  it('renders the selected range and uses global indices for selection and playback', () => {
    const onPageChange = vi.fn();
    const onChooseEpisode = vi.fn();
    const onPlayEpisode = vi.fn();

    render(
      <DetailEpisodeList
        episodes={episodes(52)}
        page={1}
        selectedEpisode={50}
        onPageChange={onPageChange}
        onChooseEpisode={onChooseEpisode}
        onPlayEpisode={onPlayEpisode}
      />,
    );

    expect(screen.getByRole('button', { name: '51-52' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '第51集' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '第52集' }).getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: '第52集' }));
    fireEvent.doubleClick(screen.getByRole('button', { name: '第52集' }));

    expect(onChooseEpisode).toHaveBeenCalledWith(51);
    expect(onPlayEpisode).toHaveBeenCalledWith(51);
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('requests the zero-based page selected by a range button', () => {
    const onPageChange = vi.fn();

    render(
      <DetailEpisodeList
        episodes={episodes(101)}
        page={0}
        selectedEpisode={0}
        onPageChange={onPageChange}
        onChooseEpisode={vi.fn()}
        onPlayEpisode={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '51-100' }));

    expect(onPageChange).toHaveBeenCalledWith(1);
  });
});
