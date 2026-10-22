// xBot's single shared design system. Import components from here; the CSS
// (tokens, glass, components) is loaded once per page by common/base.css.
export { FrostedButton, GhostButton, IconButton, type ButtonProps, type IconButtonProps } from './Buttons';
export {
  ColorField,
  NumberField,
  Segmented,
  Slider,
  Swatch,
  SwatchGroup,
  TextField,
  Toggle,
  type SegmentedOption,
  type SliderProps,
  type SwatchOption,
} from './Controls';
export { useEscapeLayer } from './escapeLayers';
export * from './icons';
export { Menu, type MenuItem, type MenuProps } from './Menu';
export { Popover, placeFloating, useFloatingPosition, type Placement, type PopoverProps } from './Popover';
export { createPopoverManager, popovers, type PopoverId, type PopoverManager } from './popoverManager';
export { Sheet } from './Sheet';
export { cx, Divider, GlassCard, GlassPanel, StatusChip } from './Surfaces';
export { Tooltip } from './Tooltip';
export { applyMaterialFromLocation, hasNativeGlass, useAppearance } from './useAppearance';
export { useGlassShadow } from './useGlassShadow';
export { useAnyPopoverOpen, usePopoverOpen } from './usePopover';
