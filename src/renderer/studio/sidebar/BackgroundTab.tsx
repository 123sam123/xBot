import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { GRADIENT_PRESETS, GRADIENTS, gradientBackground, type Background, type Composition, type GradientPreset } from '../../../shared/composition/model';
import { CheckerIcon, ColorField, GhostButton, ImageIcon, MonitorIcon, NoImageIcon, Slider, SwatchGroup, Toggle, Tooltip } from '../../design-system';
import { wallpaperThumbUrl } from '../useCompositionAssets';
import { Section, SliderRow, type TabProps } from './parts';

export type BackgroundKind = 'desktop' | 'wallpaper' | 'image' | 'color' | 'gradient' | 'none';

interface WallpaperEntry {
  id: string;
  name: string;
  category: string;
}

const CATEGORIES = ['macOS', 'Dark', 'Blue', 'Purple', 'Warm'] as const;
const SOLID_COLORS = ['#ffffff', '#f2f2f7', '#1c1c1e', '#000000', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#0a84ff', '#5e5ce6', '#bf5af2', '#ff2d55', '#a2845e'];

let manifest: Promise<WallpaperEntry[]> | null = null;
function loadWallpapers(): Promise<WallpaperEntry[]> {
  manifest ??= fetch('xbot-media://wallpapers/manifest.json')
    .then((response) => (response.ok ? (response.json() as Promise<WallpaperEntry[]>) : []))
    .catch(() => {
      manifest = null;
      return [];
    });
  return manifest;
}

function kindOf(background: Background): BackgroundKind {
  switch (background.type) {
    case 'wallpaper':
      return 'wallpaper';
    case 'image':
      return 'image';
    case 'solid':
      return 'color';
    case 'gradient':
      return 'gradient';
    case 'transparent':
      return 'none';
  }
}

const brightnessOf = (background: Background) => (background.type === 'transparent' ? 0.5 : background.brightness);

/** One shadow amount for the slider: none at 0, the soft look scaled up to 1. */
function shadowFromAmount(amount: number, current: Composition['shadow']): Composition['shadow'] {
  if (amount <= 0) return { ...current, style: 'none' };
  return { style: 'soft', blur: 0.02 + 0.14 * amount, distance: 0.008 + 0.05 * amount, opacity: 0.12 + 0.43 * amount };
}

function amountOfShadow(shadow: Composition['shadow']): number {
  if (shadow.style === 'none') return 0;
  return Math.min(1, Math.max(0.01, (shadow.opacity - 0.12) / 0.43));
}

export function BackgroundTab({
  composition,
  onChange,
  onCommit,
  onPickImage,
  pickDisabledReason,
  onDesktop,
}: TabProps & { onPickImage(): void; pickDisabledReason?: string; onDesktop(): void }) {
  const bg = composition.background;
  // A tile can be picked before it changes the background (Image before a file is chosen); otherwise the background says.
  const [picked, setPicked] = useState<{ kind: BackgroundKind; on: Background } | null>(null);
  const kind = picked && picked.on === bg ? picked.kind : kindOf(bg);
  const [wallpapers, setWallpapers] = useState<WallpaperEntry[]>([]);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('macOS');
  const [advanced, setAdvanced] = useState(false);
  const brightness = brightnessOf(bg);
  const isVideo = composition.video !== undefined;

  useEffect(() => {
    let alive = true;
    void loadWallpapers().then((list) => {
      if (!alive) return;
      setWallpapers(list);
      if (bg.type === 'wallpaper') {
        const found = list.find((entry) => entry.id === bg.id);
        if (found && (CATEGORIES as readonly string[]).includes(found.category)) setCategory(found.category as (typeof CATEGORIES)[number]);
      }
    });
    return () => {
      alive = false;
    };
    // Only the first load picks the category of the current wallpaper.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const set = (background: Background, gesture?: string) => onChange({ ...composition, background }, gesture);
  const blurOf = bg.type === 'image' || bg.type === 'wallpaper' ? bg.blur : 0;

  const choose = (next: BackgroundKind) => {
    if (next === 'desktop') return onDesktop();
    setPicked({ kind: next, on: bg });
    if (next === 'gradient' && bg.type !== 'gradient') set(gradientBackground('blue', brightness));
    else if (next === 'color' && bg.type !== 'solid') set({ type: 'solid', color: bg.type === 'gradient' ? bg.from : '#0a84ff', brightness });
    else if (next === 'none') set({ type: 'transparent' });
    else if (next === 'wallpaper' && bg.type !== 'wallpaper') {
      const first = wallpapers.find((entry) => entry.category === category) ?? wallpapers[0];
      if (first) set({ type: 'wallpaper', id: first.id, blur: 0, brightness: 0.5 });
    }
  };

  const tiles: { kind: BackgroundKind; label: string; icon: ReactNode; disabled?: string }[] = [
    { kind: 'desktop', label: 'Desktop', icon: <MonitorIcon size={17} /> },
    { kind: 'wallpaper', label: 'Wallpaper', icon: <span className="bg-tile-dot bg-tile-dot-wallpaper" /> },
    { kind: 'image', label: 'Image', icon: <CheckerIcon size={16} /> },
    { kind: 'color', label: 'Color', icon: <span className="bg-tile-dot bg-tile-dot-color" /> },
    { kind: 'gradient', label: 'Gradient', icon: <span className="bg-tile-dot bg-tile-dot-gradient" /> },
    { kind: 'none', label: 'None', icon: <NoImageIcon size={17} />, disabled: isVideo ? 'A video needs a background' : undefined },
  ];

  return (
    <>
      <Section title="Background Image" icon={<ImageIcon size={18} />}>
        <div className="bg-tiles" role="radiogroup" aria-label="Background type">
          {tiles.map((tile) => {
            const button = (
              <button
                key={tile.kind}
                type="button"
                role="radio"
                aria-checked={kind === tile.kind}
                aria-disabled={tile.disabled !== undefined || undefined}
                className={`bg-tile${kind === tile.kind ? ' bg-tile-active' : ''}`}
                onClick={() => tile.disabled === undefined && choose(tile.kind)}
                data-testid={`bg-kind-${tile.kind}`}
              >
                {tile.icon}
                {tile.label}
              </button>
            );
            return tile.disabled ? (
              <Tooltip key={tile.kind} label={tile.disabled} className="bg-tile-tooltip">
                {button}
              </Tooltip>
            ) : (
              button
            );
          })}
        </div>
        <hr className="sidebar-dashed" />

        {kind === 'wallpaper' && (
          <>
            <div className="wallpaper-categories" role="tablist" aria-label="Wallpaper category">
              {CATEGORIES.map((name) => (
                <button key={name} type="button" role="tab" aria-selected={category === name} className={`wallpaper-category${category === name ? ' wallpaper-category-active' : ''}`} onClick={() => setCategory(name)}>
                  {name}
                </button>
              ))}
            </div>
            <div className="wallpaper-grid" role="radiogroup" aria-label="Wallpaper">
              {wallpapers
                .filter((entry) => entry.category === category)
                .map((entry) => {
                  const selected = bg.type === 'wallpaper' && bg.id === entry.id;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={entry.name}
                      title={entry.name}
                      className={`wallpaper-thumb${selected ? ' wallpaper-thumb-active' : ''}`}
                      style={{ '--thumb': `url("${wallpaperThumbUrl(entry.id)}")` } as CSSProperties}
                      onClick={() => set({ type: 'wallpaper', id: entry.id, blur: blurOf, brightness })}
                      data-testid={`wallpaper-${entry.id}`}
                    />
                  );
                })}
            </div>
          </>
        )}

        {kind === 'image' && (
          <GhostButton className="sidebar-action" disabled={pickDisabledReason !== undefined} onClick={onPickImage} data-testid="bg-choose-image">
            {bg.type === 'image' ? 'Replace image…' : 'Choose image…'}
          </GhostButton>
        )}

        {kind === 'color' && bg.type === 'solid' && (
          <div className="color-swatches">
            {SOLID_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={color}
                className={`color-swatch${bg.color.toLowerCase() === color ? ' color-swatch-active' : ''}`}
                style={{ '--swatch': color } as CSSProperties}
                onClick={() => set({ ...bg, color })}
              />
            ))}
            <ColorField label="Custom colour" value={bg.color} onChange={(color) => set({ ...bg, color }, 'solid-color')} onCommit={onCommit} testId="background-color" />
          </div>
        )}

        {kind === 'gradient' && (
          <>
            <SwatchGroup
              label="Gradient"
              options={GRADIENT_PRESETS.map((id) => ({ id, label: GRADIENTS[id].label, paint: GRADIENTS[id].swatch }))}
              value={bg.type === 'gradient' && bg.preset ? bg.preset : ''}
              onChange={(id) => set(gradientBackground(id as GradientPreset, brightness))}
            />
            {bg.type === 'gradient' && (
              <>
                <SliderRow label="Angle">
                  <Slider label="Gradient angle" min={0} max={360} step={1} value={bg.angle} onChange={(angle) => set({ ...bg, preset: null, angle }, 'gradient-angle')} onCommit={onCommit} />
                </SliderRow>
                <SliderRow label="Colours">
                  <span className="sidebar-colors">
                    <ColorField label="Gradient start colour" value={bg.from} onChange={(from) => set({ ...bg, preset: null, from }, 'gradient-from')} onCommit={onCommit} />
                    <ColorField label="Gradient end colour" value={bg.to} onChange={(to) => set({ ...bg, preset: null, to }, 'gradient-to')} onCommit={onCommit} />
                  </span>
                </SliderRow>
              </>
            )}
          </>
        )}

        {kind === 'none' && <p className="sidebar-note">Exports a transparent PNG.</p>}
      </Section>

      {(bg.type === 'image' || bg.type === 'wallpaper') && (
        <Section title="Background Blur">
          <Slider label="Background blur" min={0} max={0.1} step={0.001} value={bg.blur} onChange={(blur) => set({ ...bg, blur }, 'background-blur')} onCommit={onCommit} testId="background-blur" />
        </Section>
      )}

      {bg.type !== 'transparent' && (
        <Section title="Brightness">
          <Slider label="Background brightness" value={brightness} onChange={(value) => set({ ...bg, brightness: value }, 'background-brightness')} onCommit={onCommit} testId="background-brightness" />
        </Section>
      )}

      <Section title="Padding">
        <Slider
          label="Padding"
          min={0}
          max={0.4}
          step={0.005}
          value={composition.padding.x}
          onChange={(x) => onChange({ ...composition, padding: { ...composition.padding, x, y: x, linked: true } }, 'padding')}
          onCommit={onCommit}
          testId="padding"
        />
      </Section>

      <Section title="Rounded Corners">
        <Slider
          label="Rounded corners"
          min={0}
          max={0.08}
          step={0.001}
          value={composition.frame.radius}
          onChange={(radius) => onChange({ ...composition, frame: { ...composition.frame, radius } }, 'frame-radius')}
          onCommit={onCommit}
          testId="rounded-corners"
        />
      </Section>

      <Section
        title="Shadow"
        action={
          <button type="button" className="sidebar-link" aria-expanded={advanced} onClick={() => setAdvanced((open) => !open)}>
            {advanced ? 'Hide advanced' : 'Advanced'}
          </button>
        }
      >
        <Slider
          label="Shadow"
          value={amountOfShadow(composition.shadow)}
          onChange={(amount) => onChange({ ...composition, shadow: shadowFromAmount(amount, composition.shadow) }, 'shadow')}
          onCommit={onCommit}
          testId="shadow"
        />
        {advanced && composition.shadow.style !== 'none' && (
          <>
            <SliderRow label="Size">
              <Slider label="Shadow blur" min={0} max={0.25} step={0.002} value={composition.shadow.blur} onChange={(blur) => onChange({ ...composition, shadow: { ...composition.shadow, blur } }, 'shadow-blur')} onCommit={onCommit} />
            </SliderRow>
            <SliderRow label="Distance">
              <Slider label="Shadow distance" min={0} max={0.25} step={0.002} value={composition.shadow.distance} onChange={(distance) => onChange({ ...composition, shadow: { ...composition.shadow, distance } }, 'shadow-distance')} onCommit={onCommit} />
            </SliderRow>
            <SliderRow label="Opacity">
              <Slider label="Shadow opacity" min={0} max={1} step={0.01} value={composition.shadow.opacity} onChange={(opacity) => onChange({ ...composition, shadow: { ...composition.shadow, opacity } }, 'shadow-opacity')} onCommit={onCommit} />
            </SliderRow>
          </>
        )}
      </Section>

      <Section title="Border">
        <Toggle label="Fine border" checked={composition.frame.border} onChange={(border) => onChange({ ...composition, frame: { ...composition.frame, border } })} />
      </Section>
    </>
  );
}
