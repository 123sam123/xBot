import { useEffect, useId } from 'react';
import { Sheet } from '../design-system';
import { settingsSections, type SettingsSection } from './registry';

function Section({ section }: { section: SettingsSection }) {
  const titleId = useId();
  const { Component } = section;
  return (
    <section className="settings-section" aria-labelledby={titleId} data-section={section.id}>
      <h3 id={titleId} className="sheet-section-title">
        {section.title}
      </h3>
      <div className="settings-section-body">
        <Component />
      </div>
    </section>
  );
}

/**
 * The composer's settings sheet (header menu or tray → "Settings…"), built
 * from the section registry. `focusSection` scrolls that section into view
 * when the sheet opens (e.g. "Local AI settings…").
 */
export function SettingsSheet({ open, onClose, focusSection }: { open: boolean; onClose(): void; focusSection?: string }) {
  useEffect(() => {
    if (!open || !focusSection) return;
    const frame = requestAnimationFrame(() =>
      document.querySelector(`.settings-section[data-section="${CSS.escape(focusSection)}"]`)?.scrollIntoView({ block: 'start' }),
    );
    return () => cancelAnimationFrame(frame);
  }, [open, focusSection]);
  return (
    <Sheet open={open} title="Settings" onClose={onClose} testId="settings-sheet">
      {settingsSections.map((section) => (
        <Section key={section.id} section={section} />
      ))}
    </Sheet>
  );
}
