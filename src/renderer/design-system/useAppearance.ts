import { useEffect } from 'react';
import type { RendererMaterial } from '../../shared/contracts/windows';

/**
 * Sets `<html data-material>` from the page's `?material=` (passed by main's
 * `loadPage`). Call it before the first render, so a reload never paints the
 * wrong material first.
 */
export function applyMaterialFromLocation(): RendererMaterial {
  const material: RendererMaterial = new URLSearchParams(window.location.search).get('material') === 'vibrancy' ? 'vibrancy' : 'css';
  document.documentElement.dataset.material = material;
  return material;
}

/**
 * Mirrors the app's appearance settings onto `<html>`. The OS preferences
 * (`prefers-reduced-transparency`, `prefers-contrast`) are read by CSS media
 * queries directly; either source turns a mode on.
 */
export function useAppearance(reduceTransparency: boolean, increaseContrast: boolean): void {
  useEffect(() => {
    const root = document.documentElement;
    if (reduceTransparency) root.dataset.reduceTransparency = 'on';
    else delete root.dataset.reduceTransparency;
    if (increaseContrast) root.dataset.contrast = 'more';
    else delete root.dataset.contrast;
  }, [reduceTransparency, increaseContrast]);
}
