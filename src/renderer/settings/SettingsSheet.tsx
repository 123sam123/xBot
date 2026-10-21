import { useId } from 'react';
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

/** The composer's settings sheet (header menu or tray → "Settings…"), built from the section registry. */
export function SettingsSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  return (
    <Sheet open={open} title="Settings" onClose={onClose} testId="settings-sheet">
      {settingsSections.map((section) => (
        <Section key={section.id} section={section} />
      ))}
    </Sheet>
  );
}
