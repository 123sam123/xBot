import { useEffect, useRef, type ReactNode } from 'react';
import { IconButton } from './Buttons';
import { useEscapeLayer } from './escapeLayers';
import { CloseIcon } from './icons';

/**
 * A sheet that covers its positioned parent (the panel) without changing its
 * size: settings, onboarding, history. Escape closes only the sheet.
 */
export function Sheet({
  open,
  title,
  onClose,
  testId,
  children,
}: {
  open: boolean;
  title: string;
  onClose(): void;
  testId?: string;
  children: ReactNode;
}) {
  useEscapeLayer(open, onClose);
  return open ? (
    <SheetSurface title={title} onClose={onClose} testId={testId}>
      {children}
    </SheetSurface>
  ) : null;
}

function SheetSurface({ title, onClose, testId, children }: { title: string; onClose(): void; testId?: string; children: ReactNode }) {
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => surface.current?.focus({ preventScroll: true }), []);
  return (
    <div ref={surface} className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} data-testid={testId}>
      <header className="sheet-header">
        <h2 className="sheet-title">{title}</h2>
        <IconButton label="Close" size="sm" onClick={onClose}>
          <CloseIcon size={16} />
        </IconButton>
      </header>
      <div className="sheet-body">{children}</div>
    </div>
  );
}
