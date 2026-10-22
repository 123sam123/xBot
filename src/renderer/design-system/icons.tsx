import type { ReactNode, SVGProps } from 'react';

// Inline SVG icons in the SF Symbols spirit: 24-unit grid, round 1.75 strokes,
// currentColor. Decorative by default (aria-hidden); label the control instead.

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number;
}

function icon(name: string, paths: ReactNode, defaults: SVGProps<SVGSVGElement> = {}) {
  function Icon({ size = 20, ...props }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        {...defaults}
        {...props}
      >
        {paths}
      </svg>
    );
  }
  Icon.displayName = name;
  return Icon;
}

export const ChevronDownIcon = icon('ChevronDownIcon', <path d="M6 9.5l6 6 6-6" />);
export const ChevronLeftIcon = icon('ChevronLeftIcon', <path d="M15 5l-7 7 7 7" />);
export const ChevronUpIcon = icon('ChevronUpIcon', <path d="M6 14.5l6-6 6 6" />);
export const CloseIcon = icon('CloseIcon', <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />);
export const PlusIcon = icon('PlusIcon', <path d="M12 5v14M5 12h14" />);
export const ArrowUpIcon = icon('ArrowUpIcon', <path d="M12 19.5V5M6 11l6-6 6 6" />);
export const ArrowUpRightIcon = icon('ArrowUpRightIcon', <path d="M7 17L17 7M8.5 7H17v8.5" />);
export const CheckIcon = icon('CheckIcon', <path d="M5 12.5l4.5 4.5L19 7.5" />);

export const AlarmIcon = icon(
  'AlarmIcon',
  <>
    <circle cx="12" cy="13" r="7.25" />
    <path d="M12 9.5V13l2.5 1.75M4.5 5.5l2.5-2M19.5 5.5l-2.5-2" />
  </>,
);

export const ImageIcon = icon(
  'ImageIcon',
  <>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M20.5 16l-4.5-4.5L7 19.5" />
  </>,
);

export const FrameIcon = icon(
  'FrameIcon',
  <rect x="4.5" y="4.5" width="15" height="15" rx="2.5" strokeDasharray="2.6 2.4" />,
);

export const PaddingIcon = icon(
  'PaddingIcon',
  <>
    <rect x="3.5" y="3.5" width="17" height="17" rx="3" strokeDasharray="2.6 2.4" />
    <rect x="8" y="8" width="8" height="8" rx="1.5" />
  </>,
);

export const ShadowIcon = icon(
  'ShadowIcon',
  <>
    <rect x="4" y="4" width="13.5" height="13.5" rx="3" />
    <path d="M7.5 20.5H17a3.5 3.5 0 0 0 3.5-3.5V7.5" />
  </>,
);

export const CropIcon = icon('CropIcon', <path d="M6.5 2.5v13a2 2 0 0 0 2 2h13M2.5 6.5h13a2 2 0 0 1 2 2v13" />);

export const PlayIcon = icon('PlayIcon', <path d="M8 5.2v13.6L19 12z" fill="currentColor" strokeWidth={1.25} />);

export const PauseIcon = icon(
  'PauseIcon',
  <>
    <rect x="6.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none" />
    <rect x="14" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none" />
  </>,
);

/** Sound on (T5's timeline mute toggle). */
export const SpeakerIcon = icon(
  'SpeakerIcon',
  <>
    <path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z" />
    <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
  </>,
);

export const SpeakerMutedIcon = icon(
  'SpeakerMutedIcon',
  <>
    <path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z" />
    <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" />
  </>,
);

export const SunIcon = icon(
  'SunIcon',
  <>
    <circle cx="12" cy="12" r="3.5" />
    <path d="M12 3v1.8M12 19.2V21M3 12h1.8M19.2 12H21M5.6 5.6l1.3 1.3M17.1 17.1l1.3 1.3M5.6 18.4l1.3-1.3M17.1 6.9l1.3-1.3" />
  </>,
);

export const FullscreenIcon = icon(
  'FullscreenIcon',
  <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />,
);

export const LockIcon = icon(
  'LockIcon',
  <>
    <rect x="5.5" y="10.5" width="13" height="10" rx="2" fill="currentColor" stroke="none" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </>,
);

export const ShareIcon = icon('ShareIcon', <path d="M12 3.5v11M8 7.5l4-4 4 4M7 11H6a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 18 11h-1" />);

export const TabsIcon = icon(
  'TabsIcon',
  <>
    <rect x="8" y="8" width="12" height="12" rx="2.5" />
    <path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8" />
  </>,
);

export const UndoIcon = icon('UndoIcon', <path d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />);

export const RedoIcon = icon('RedoIcon', <path d="M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />);

export const MoreIcon = icon(
  'MoreIcon',
  <>
    <circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none" />
  </>,
);

export const SparkleIcon = icon('SparkleIcon', <path d="M12 3.5l1.9 5.4 5.6 1.6-5.6 1.6L12 17.5l-1.9-5.4-5.6-1.6 5.6-1.6z" />);

export const LightbulbIcon = icon(
  'LightbulbIcon',
  <path d="M9.5 18h5M10.25 21h3.5M12 3a6 6 0 0 0-3.6 10.8c.7.55 1.1 1.3 1.1 2.1V16h5v-.1c0-.8.4-1.55 1.1-2.1A6 6 0 0 0 12 3z" />,
);

export const GridIcon = icon(
  'GridIcon',
  <>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
  </>,
);

export const SmileIcon = icon(
  'SmileIcon',
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.5 14a4.5 4.5 0 0 0 7 0M9.5 9.5h.01M14.5 9.5h.01" strokeWidth={2.25} />
  </>,
);

export const RecordIcon = icon(
  'RecordIcon',
  <>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.25" fill="currentColor" stroke="none" />
  </>,
);

export const CameraIcon = icon(
  'CameraIcon',
  <>
    <rect x="3" y="6.5" width="12.5" height="11" rx="2.5" />
    <path d="M15.5 10.5l5-3v9l-5-3" />
  </>,
);

export const MicIcon = icon(
  'MicIcon',
  <>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
  </>,
);

export const CursorIcon = icon('CursorIcon', <path d="M5.5 3.5l13 7.2-5.6 1.7-2.3 5.6z" />);

export const SearchIcon = icon(
  'SearchIcon',
  <>
    <circle cx="10.5" cy="10.5" r="6" />
    <path d="M15 15l5 5" />
  </>,
);

export const ZoomInIcon = icon(
  'ZoomInIcon',
  <>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="M15.3 15.3L20 20M8 10.5h5M10.5 8v5" />
  </>,
);

export const ZoomOutIcon = icon(
  'ZoomOutIcon',
  <>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="M15.3 15.3L20 20M8 10.5h5" />
  </>,
);

export const ScissorsIcon = icon(
  'ScissorsIcon',
  <>
    <circle cx="6.5" cy="7" r="2.75" />
    <circle cx="6.5" cy="17" r="2.75" />
    <path d="M8.8 8.6L20 17.5M8.8 15.4L20 6.5" />
  </>,
);

export const TrashIcon = icon('TrashIcon', <path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l.9 12.1a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12.1M10 10.5v6M14 10.5v6" />);

export const FolderIcon = icon('FolderIcon', <path d="M3.5 7A1.5 1.5 0 0 1 5 5.5h4.2l2 2H19A1.5 1.5 0 0 1 20.5 9v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" />);

export const UploadIcon = icon('UploadIcon', <path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M4.5 14.5v3A2.5 2.5 0 0 0 7 20h10a2.5 2.5 0 0 0 2.5-2.5v-3" />);

export const FilmIcon = icon(
  'FilmIcon',
  <>
    <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
    <path d="M3.5 9.5h17M8 5v4.5M12 5v4.5M16 5v4.5" />
  </>,
);

export const WandIcon = icon('WandIcon', <path d="M4.5 19.5l10-10M13 5l1.5-1.5M18.5 9.5L20 8M16.5 3.5v2M20.5 5.5h-2M13 8l3 3" />);

export const SkipBackIcon = icon('SkipBackIcon', <path d="M6 5.5v13M18.5 6.2v11.6L9 12z" fill="currentColor" strokeWidth={1.25} />);

export const SkipForwardIcon = icon('SkipForwardIcon', <path d="M18 5.5v13M5.5 6.2v11.6L15 12z" fill="currentColor" strokeWidth={1.25} />);

export const ClockIcon = icon(
  'ClockIcon',
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </>,
);

export const MonitorIcon = icon(
  'MonitorIcon',
  <>
    <rect x="3" y="4.5" width="18" height="12" rx="2" />
    <path d="M9 20h6M12 16.5V20" />
  </>,
);

export const KeyboardIcon = icon(
  'KeyboardIcon',
  <>
    <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
    <path d="M6 9.5h.01M9.5 9.5h.01M13 9.5h.01M16.5 9.5h.01M18 13h.01M6 13h.01M8 15.5h8" strokeWidth={2} />
  </>,
);

export const CaptionsIcon = icon(
  'CaptionsIcon',
  <>
    <path d="M4.5 5.5h15a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4 3v-3H4.5A1.5 1.5 0 0 1 3 16V7a1.5 1.5 0 0 1 1.5-1.5z" />
    <path d="M7.5 10h9M7.5 13.5h6" />
  </>,
);

export const NoImageIcon = icon(
  'NoImageIcon',
  <>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <path d="M4 5l16 14M20.5 16l-4.5-4.5" />
  </>,
);

export const CheckerIcon = icon(
  'CheckerIcon',
  <path d="M4 4h4v4H4zM12 4h4v4h-4zM8 8h4v4H8zM16 8h4v4h-4zM4 12h4v4H4zM12 12h4v4h-4zM8 16h4v4H8zM16 16h4v4h-4z" fill="currentColor" stroke="none" opacity="0.8" />,
);

export const DragHandleIcon = icon('DragHandleIcon', <path d="M5 9.5h14M5 14.5h14" />);

export const StopIcon = icon('StopIcon', <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none" />);

export const RestartIcon = icon('RestartIcon', <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4" />);

export const WindowIcon = icon(
  'WindowIcon',
  <>
    <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
    <path d="M3.5 9h17" />
  </>,
);

export const AreaIcon = icon('AreaIcon', <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />);

/** The xBot mark: blue "audio bars" on a white rounded square. */
export function AppMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden="true" focusable="false" className="app-mark">
      <rect width="30" height="30" rx="8" fill="#fff" />
      <rect x="9.25" y="11" width="3" height="8" rx="1.5" fill="#2f62e6" />
      <rect x="13.5" y="7.5" width="3" height="15" rx="1.5" fill="#2f62e6" />
      <rect x="17.75" y="9.75" width="3" height="10.5" rx="1.5" fill="#2f62e6" />
    </svg>
  );
}
