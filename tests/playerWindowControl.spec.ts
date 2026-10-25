import { describe, expect, it } from 'vitest';
import {
  resolvePlayerWindowControl,
  type PlayerWindowControlAction,
  type PlayerWindowControlMessage,
} from '../src/renderer/features/playback/application/playerWindowControl';

describe('resolvePlayerWindowControl', () => {
  it('selects adjacent episodes only when they exist', () => {
    expect(resolvePlayerWindowControl({ op: 'prev' }, 0, 3)).toBeNull();
    expect(resolvePlayerWindowControl({ op: 'next' }, 2, 3)).toBeNull();
    expect(resolvePlayerWindowControl({ op: 'prev' }, 1, 3)).toEqual({ type: 'selectEpisode', index: 0 });
    expect(resolvePlayerWindowControl({ op: 'next' }, 1, 3)).toEqual({ type: 'selectEpisode', index: 2 });
  });

  const commandCases: Array<[PlayerWindowControlMessage, PlayerWindowControlAction]> = [
    [{ op: 'play' }, { type: 'sendMpvCommand', command: { type: 'play' } }],
    [{ op: 'pause' }, { type: 'sendMpvCommand', command: { type: 'pause' } }],
    [{ op: 'seek', value: '12.5' }, { type: 'sendMpvCommand', command: { type: 'seek', value: 12.5 } }],
    [{ op: 'volume', value: 0.4 }, { type: 'sendMpvCommand', command: { type: 'volume', value: 0.4 } }],
    [{ op: 'audioTrack', value: '2' }, { type: 'sendMpvCommand', command: { type: 'aid', value: 2 } }],
    [{ op: 'subtitle', value: '-1' }, { type: 'sendMpvCommand', command: { type: 'sid', value: -1 } }],
  ];

  it.each(commandCases)('translates %o into a media command', (message, expected) => {
    expect(resolvePlayerWindowControl(message, 0, 1)).toEqual(expected);
  });

  it('ignores unknown commands and non-finite numeric values', () => {
    expect(resolvePlayerWindowControl({ op: 'unknown' }, 0, 1)).toBeNull();
    expect(resolvePlayerWindowControl({ op: 'seek', value: 'not-a-number' }, 0, 1)).toBeNull();
  });
});
