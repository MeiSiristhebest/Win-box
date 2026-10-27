import { describe, expect, it } from 'vitest';
import { appHomePath, decideAppBackAction, shouldHandleAppBackShortcut } from '../src/renderer/features/appShell/application/appNavigationPolicy';

describe('app navigation policy', () => {
  it('chooses the landing route from the discover preference', () => {
    expect(appHomePath(true)).toBe('/');
    expect(appHomePath(false)).toBe('/home');
  });

  it('uses browser history first, closes an auxiliary window without history, and otherwise returns home', () => {
    expect(decideAppBackAction({ historyLength: 2, auxiliaryWindow: true, homePath: '/' })).toEqual({ kind: 'history' });
    expect(decideAppBackAction({ historyLength: 1, auxiliaryWindow: true, homePath: '/' })).toEqual({ kind: 'close-window' });
    expect(decideAppBackAction({ historyLength: 1, auxiliaryWindow: false, homePath: '/home' })).toEqual({ kind: 'navigate-home', path: '/home' });
  });

  it('keeps back shortcuts out of typing, IME composition, modal dialogs and the home route', () => {
    const base = { key: 'Backspace', altKey: false, composing: false, typingTarget: false, modalOpen: false, pathname: '/detail', homePath: '/' };
    expect(shouldHandleAppBackShortcut(base)).toBe(true);
    expect(shouldHandleAppBackShortcut({ ...base, typingTarget: true })).toBe(false);
    expect(shouldHandleAppBackShortcut({ ...base, composing: true })).toBe(false);
    expect(shouldHandleAppBackShortcut({ ...base, modalOpen: true })).toBe(false);
    expect(shouldHandleAppBackShortcut({ ...base, pathname: '/' })).toBe(false);
    expect(shouldHandleAppBackShortcut({ ...base, key: 'ArrowLeft', altKey: true })).toBe(true);
    expect(shouldHandleAppBackShortcut({ ...base, key: 'ArrowLeft', altKey: false })).toBe(false);
  });
});
