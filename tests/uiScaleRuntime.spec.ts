import { beforeEach, describe, expect, it, vi } from 'vitest';

const displays = vi.hoisted(() => ({
  primary: { workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
  secondary: { workArea: { x: 1920, y: 0, width: 3840, height: 2120 } },
}));

vi.mock('electron', () => ({
  screen: {
    getPrimaryDisplay: () => displays.primary,
    getDisplayMatching: (bounds: { x: number }) => bounds.x >= 1920 ? displays.secondary : displays.primary,
  },
}));
vi.mock('../src/main/store/JsonStore', () => ({
  JsonStore: class {
    getObject() { return { value: 'auto' }; }
  },
}));
vi.mock('../src/main/util/paths', () => ({ userDataDir: () => 'C:/temp' }));
vi.mock('../src/main/util/logger', () => ({ fileLogger: { w: vi.fn() } }));

import { scaledWindowFor, setMainWindowProvider } from '../src/main/ui/uiScale';

const mainWindow = {
  isDestroyed: () => false,
  isMinimized: () => false,
  getBounds: () => ({ x: 0, y: 0, width: 1280, height: 800 }),
};
const playerWindow = {
  isDestroyed: () => false,
  isMinimized: () => false,
  getBounds: () => ({ x: 1920, y: 0, width: 1280, height: 800 }),
};

beforeEach(() => setMainWindowProvider(() => mainWindow as never));

describe('scaledWindowFor', () => {
  it('uses the target window display when restoring a player window', () => {
    const base = { width: 1040, height: 640, minWidth: 720, minHeight: 420 };

    expect(scaledWindowFor(base).width).toBe(1040);
    expect(scaledWindowFor(base, playerWindow as never).width).toBe(1820);
  });
});
