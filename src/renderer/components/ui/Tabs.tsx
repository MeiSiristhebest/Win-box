import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import styles from './Tabs.module.css';

export interface TabItem<Value extends string> {
  id: Value;
  label: string;
  icon?: ReactNode;
}

export interface TabsProps<Value extends string> {
  items: readonly TabItem<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  label: string;
  idPrefix: string;
  className?: string;
  orientation?: 'horizontal' | 'vertical';
}

export function Tabs<Value extends string>({ items, value, onChange, label, idPrefix, className, orientation = 'horizontal' }: TabsProps<Value>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (items.length === 0) return;
    let nextIndex: number;
    switch (event.key) {
      case 'ArrowRight': if (orientation !== 'horizontal') return; nextIndex = (index + 1) % items.length; break;
      case 'ArrowLeft': if (orientation !== 'horizontal') return; nextIndex = (index - 1 + items.length) % items.length; break;
      case 'ArrowDown': if (orientation !== 'vertical') return; nextIndex = (index + 1) % items.length; break;
      case 'ArrowUp': if (orientation !== 'vertical') return; nextIndex = (index - 1 + items.length) % items.length; break;
      case 'Home': nextIndex = 0; break;
      case 'End': nextIndex = items.length - 1; break;
      default: return;
    }
    event.preventDefault();
    const next = items[nextIndex];
    if (!next) return;
    onChange(next.id);
    refs.current[nextIndex]?.focus();
  };

  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')}>
      <div className={styles.list} role="tablist" aria-label={label} aria-orientation={orientation}>
        {items.map((item, index) => {
          const selected = item.id === value;
          const tabId = `${idPrefix}-tab-${item.id}`;
          return (
            <button
              key={item.id}
              ref={(element) => { refs.current[index] = element; }}
              id={tabId}
              className={styles.tab}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${idPrefix}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(item.id)}
              onKeyDown={(event) => moveFocus(event, index)}
            >
              {item.icon}{item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
