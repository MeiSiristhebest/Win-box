export interface SkipSegmentsDraft {
  intro: string;
  outro: string;
}

export type SkipSegmentsDraftCommand =
  | { type: 'change-intro'; value: string }
  | { type: 'change-outro'; value: string };

/** Purely applies an edit intent to the in-progress skip-segment draft. */
export function reduceSkipSegmentsDraft(
  current: SkipSegmentsDraft,
  command: SkipSegmentsDraftCommand,
): SkipSegmentsDraft {
  switch (command.type) {
    case 'change-intro':
      return current.intro === command.value ? current : { ...current, intro: command.value };
    case 'change-outro':
      return current.outro === command.value ? current : { ...current, outro: command.value };
  }
}
