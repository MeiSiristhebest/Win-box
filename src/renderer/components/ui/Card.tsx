import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Card.module.css';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  title?: string;
  children: ReactNode;
}

export function Card({ title, children, className, ...props }: CardProps) {
  return (
    <section {...props} className={[styles.card, className].filter(Boolean).join(' ')}>
      {title && <h2 className={styles.title}>{title}</h2>}
      {children}
    </section>
  );
}
