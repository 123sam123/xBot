// xBot's single shared design system. Import components from here; the CSS
// (tokens, glass, components) is loaded once per page by common/base.css.
export { FrostedButton, GhostButton, IconButton, type ButtonProps, type IconButtonProps } from './Buttons';
export { Segmented, Slider, Swatch, SwatchGroup, Toggle, type SliderProps, type SwatchOption } from './Controls';
export { useEscapeLayer } from './escapeLayers';
export * from './icons';
export { Menu, type MenuItem, type MenuProps } from './Menu';
export { Popover, placeFloating, useFloatingPosition, type Placement, type PopoverProps } from './Popover';
export { createPopoverManager, popovers, type PopoverId, type PopoverManager } from './popoverManager';
export { Sheet } from './Sheet';
export { TextField, type TextFieldProps } from './TextField';
export { cx, Divider, GlassCard, GlassPanel, StatusChip } from './Surfaces';
export { Tooltip } from './Tooltip';
export { applyMaterialFromLocation, useAppearance } from './useAppearance';
export { useAnyPopoverOpen, usePopoverOpen } from './usePopover';
