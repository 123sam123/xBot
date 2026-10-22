import { useState, type ReactNode } from 'react';
import { CameraIcon, CursorIcon, ImageIcon, SpeakerIcon, Tooltip } from '../design-system';
import { AudioTab } from './sidebar/AudioTab';
import { BackgroundTab } from './sidebar/BackgroundTab';
import { CameraTab } from './sidebar/CameraTab';
import { CursorTab } from './sidebar/CursorTab';
import { TabNote, type TabProps } from './sidebar/parts';

export type SidebarTab = 'background' | 'camera' | 'audio' | 'cursor';

const TABS: { id: SidebarTab; label: string; icon: ReactNode }[] = [
  { id: 'background', label: 'Background', icon: <ImageIcon size={21} /> },
  { id: 'camera', label: 'Camera', icon: <CameraIcon size={21} /> },
  { id: 'audio', label: 'Audio', icon: <SpeakerIcon size={21} /> },
  { id: 'cursor', label: 'Cursor', icon: <CursorIcon size={21} /> },
];

/** The inspector on the right: icon tabs over one scrolling panel, as in Cap. */
export function Sidebar({
  disabledReason,
  hasAudio,
  tracks,
  onPickImage,
  onDesktop,
  pickDisabledReason,
  ...tab
}: Partial<TabProps> & {
  onDesktop(): void;
  /** Why editing is off (no document, rendering…); every tab is inert then. */
  disabledReason?: string;
  /** The video has a sound track. */
  hasAudio: boolean;
  /** A recording's separate audio tracks. */
  tracks: { system: boolean; microphone: boolean } | null;
  onPickImage(): void;
  pickDisabledReason?: string;
}) {
  const [active, setActive] = useState<SidebarTab>('background');
  const { composition, onChange, onCommit } = tab;
  const ready = composition && onChange && onCommit && !disabledReason;

  return (
    <aside className="studio-sidebar" data-testid="studio-sidebar">
      <nav className="sidebar-tabs" role="tablist" aria-label="Settings">
        {TABS.map((item) => (
          <Tooltip key={item.id} label={item.label} placement="bottom">
            <button
              type="button"
              role="tab"
              aria-selected={active === item.id}
              aria-label={item.label}
              className={`sidebar-tab${active === item.id ? ' sidebar-tab-active' : ''}`}
              onClick={() => setActive(item.id)}
              data-testid={`sidebar-tab-${item.id}`}
            >
              {item.icon}
            </button>
          </Tooltip>
        ))}
      </nav>
      <div className="sidebar-body" role="tabpanel" aria-label={TABS.find((item) => item.id === active)!.label}>
        {!ready ? (
          <p className="sidebar-note">{disabledReason ?? 'Open a screenshot, video or recording to edit it.'}</p>
        ) : active === 'background' ? (
          <BackgroundTab composition={composition} onChange={onChange} onCommit={onCommit} onPickImage={onPickImage} onDesktop={onDesktop} pickDisabledReason={pickDisabledReason} />
        ) : active === 'audio' ? (
          composition.video ? (
            <AudioTab composition={composition} onChange={onChange} onCommit={onCommit} hasAudio={hasAudio} tracks={tracks} />
          ) : (
            <TabNote icon={<SpeakerIcon size={28} />} title="No audio">
              Screenshots have no sound. Open a video or a recording to set its audio.
            </TabNote>
          )
        ) : active === 'camera' && composition.camera ? (
          <CameraTab composition={composition} onChange={onChange} onCommit={onCommit} />
        ) : active === 'cursor' && composition.cursor ? (
          <CursorTab composition={composition} onChange={onChange} onCommit={onCommit} />
        ) : active === 'camera' ? (
          <TabNote icon={<CameraIcon size={28} />} title="Camera">
            Record with xBot and turn on your camera to place, size and style it here.
          </TabNote>
        ) : (
          <TabNote icon={<CursorIcon size={28} />} title="Cursor">
            Record with xBot to restyle the cursor: size, smooth movement and click effects.
          </TabNote>
        )}
      </div>
    </aside>
  );
}
