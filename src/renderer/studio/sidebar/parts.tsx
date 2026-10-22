import type { ReactNode } from 'react';
import type { Composition } from '../../../shared/composition/model';

export interface TabProps {
  composition: Composition;
  onChange(next: Composition, gesture?: string): void;
  /** A slider drag or a typing run ended: the next change is a new undo step. */
  onCommit(): void;
}

/** A titled block in a sidebar tab, as in Cap's inspector. */
export function Section({ title, icon, action, children }: { title: string; icon?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="sidebar-section">
      <header className="sidebar-section-head">
        <h3 className="sidebar-section-title">
          {icon}
          {title}
        </h3>
        {action}
      </header>
      {children}
    </section>
  );
}

/** A label on the left, a control filling the rest. */
export function SliderRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sidebar-row">
      <span className="sidebar-row-label">{label}</span>
      {children}
    </div>
  );
}

/** What a tab shows when it doesn't apply to the open document. */
export function TabNote({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="sidebar-empty">
      {icon}
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
