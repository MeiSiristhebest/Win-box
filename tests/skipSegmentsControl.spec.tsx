// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SkipSegmentsControl } from '../src/renderer/features/playback/SkipSegmentsControl';

afterEach(() => cleanup());

describe('SkipSegmentsControl', () => {
  it('exposes saved and inherited settings and sends edits to the play session', () => {
    const onDraftChange = vi.fn();
    const onSave = vi.fn();
    const onClear = vi.fn();
    const onToggle = vi.fn();
    render(
      <SkipSegmentsControl
        segments={{ intro: 90, outro: 120 }}
        inheritedFrom="第3集"
        draft={{ intro: '90', outro: '120' }}
        open
        onDraftChange={onDraftChange}
        onSave={onSave}
        onClear={onClear}
        onToggle={onToggle}
      />,
    );

    expect(screen.getByText('本集未单独设置，当前沿用「第3集」的设置；在本集保存/清除后即不再继承。')).toBeTruthy();
    expect((screen.getByRole('spinbutton', { name: '片头跳过秒数' }) as HTMLInputElement).value).toBe('90');
    expect((screen.getByRole('spinbutton', { name: '片尾跳过秒数' }) as HTMLInputElement).value).toBe('120');
    expect(screen.getByRole('button', { name: '跳过片头片尾设置' }).getAttribute('aria-expanded')).toBe('true');

    fireEvent.change(screen.getByRole('spinbutton', { name: '片头跳过秒数' }), { target: { value: '45' } });
    expect(onDraftChange).toHaveBeenCalledWith({ intro: '45', outro: '120' });
    fireEvent.click(screen.getByRole('button', { name: '保存到本集' }));
    fireEvent.click(screen.getByRole('button', { name: '清除' }));
    fireEvent.click(screen.getByRole('button', { name: '跳过片头片尾设置' }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onClear).toHaveBeenCalledOnce();
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
