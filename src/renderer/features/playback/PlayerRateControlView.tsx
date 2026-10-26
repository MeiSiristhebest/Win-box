import type { FocusEvent, KeyboardEvent, PointerEvent, RefObject } from 'react';

type PlayerRateControlViewProps = {
  rate: number;
  open: boolean;
  panelId: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  options: readonly { value: number; selected: boolean }[];
  onPointerEnter(event: PointerEvent<HTMLDivElement>): void;
  onPointerLeave(event: PointerEvent<HTMLDivElement>): void;
  onBlur(event: FocusEvent<HTMLDivElement>): void;
  onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>): void;
  onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>): void;
  onOpen(): void;
  onSelect(value: number): void;
};

/** Passive rate selector markup; interaction and focus policy live in its presenter. */
export function PlayerRateControlView({
  rate, open, panelId, triggerRef, options,
  onPointerEnter, onPointerLeave, onBlur, onTriggerKeyDown, onMenuKeyDown, onOpen, onSelect,
}: PlayerRateControlViewProps) {
  return (
    <div className={`vp-rate-host${open ? ' open' : ''}`} onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave} onBlur={onBlur}>
      <button
        ref={triggerRef}
        type="button"
        className="vp-ctl vp-rate"
        title={`播放速度：${rate}x`}
        aria-label={`播放速度：${rate}倍`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={panelId}
        aria-keyshortcuts="ArrowDown"
        onKeyDown={onTriggerKeyDown}
        onClick={onOpen}
      >
        <span>{rate}x</span>
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <div id={panelId} className="vp-rate-menu" role="menu" tabIndex={-1} aria-label="播放速度" aria-hidden={!open} onKeyDown={onMenuKeyDown}>
        {options.map(({ value, selected }) => (
          <button
            key={value}
            type="button"
            role="menuitemradio"
            aria-checked={selected}
            tabIndex={open && selected ? 0 : -1}
            className={`vp-rate-option${selected ? ' selected' : ''}`}
            onClick={() => onSelect(value)}
          >
            <span>{value}x</span>
            {selected && <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4.2 4.2L19 6.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          </button>
        ))}
      </div>
    </div>
  );
}
