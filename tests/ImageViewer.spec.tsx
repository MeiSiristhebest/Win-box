// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ImageViewer from '../src/renderer/components/ImageViewer';

afterEach(cleanup);

describe('ImageViewer presentation', () => {
  it('retries the same image with a fresh request URL and resets failed presentation state', () => {
    const { container } = render(
      <ImageViewer url="https://images.example/poster.jpg?size=small#preview" name="Poster" />,
    );
    const firstImage = container.querySelector<HTMLImageElement>('.ivi-img');
    expect(firstImage?.getAttribute('src')).toBe('https://images.example/poster.jpg?size=small#preview');

    fireEvent.error(firstImage!);
    expect(screen.getByText(/图片加载失败/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    const retriedImage = container.querySelector<HTMLImageElement>('.ivi-img');
    expect(retriedImage?.getAttribute('src'))
      .toBe('https://images.example/poster.jpg?size=small&_r=1#preview');
    expect(screen.queryByText(/图片加载失败/)).toBeNull();
    expect(screen.getByText('图片加载中')).toBeTruthy();
  });
});
