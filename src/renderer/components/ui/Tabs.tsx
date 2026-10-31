import type { KeyboardEvent, ReactNode } from 'react';
import { Tab as FluentTab, TabList as FluentTabList } from '@fluentui/react-components';
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
  panelId?: string;
  className?: string;
  orientation?: 'horizontal' | 'vertical';
}

export function Tabs<Value extends string>({ items, value, onChange, label, idPrefix, panelId, className, orientation = 'horizontal' }: TabsProps<Value>) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (items.length < 2) return;
    const target = event.target as Element;
    const selectedTab = target.closest<HTMLElement>('[role="tab"]');
    if (!selectedTab) return;
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
    const currentIndex = tabs.indexOf(selectedTab);
    if (currentIndex < 0) return;

    let nextIndex: number;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = items.length - 1;
    else if (orientation === 'vertical' && event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length;
    else if (orientation === 'vertical' && event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length;
    else if (orientation === 'horizontal' && event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % items.length;
    else if (orientation === 'horizontal' && event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + items.length) % items.length;
    else return;

    event.preventDefault();
    event.stopPropagation();
    tabs[nextIndex].focus();
    onChange(items[nextIndex].id);
  };

  return (
    <FluentTabList
      className={[styles.root, orientation === 'vertical' ? styles.vertical : styles.horizontal, className].filter(Boolean).join(' ')}
      aria-label={label}
      vertical={orientation === 'vertical'}
      selectedValue={value}
      onTabSelect={(_event, data) => onChange(data.value as Value)}
      onKeyDown={onKeyDown}
      appearance="subtle"
    >
      {items.map((item) => (
        <FluentTab
          key={item.id}
          id={`${idPrefix}-tab-${item.id}`}
          aria-controls={panelId}
          className={[styles.tab, orientation === 'vertical' ? styles.verticalTab : ''].filter(Boolean).join(' ')}
          value={item.id}
          icon={item.icon ? <>{item.icon}</> : undefined}
        >
          {item.label}
        </FluentTab>
      ))}
    </FluentTabList>
  );
}
