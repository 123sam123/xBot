import { useEffect } from 'react';
import type { RendererMaterial } from '../../shared/contracts/windows';

/**
 * Sets `<html data-material>` from the page's `?material=` (passed by main's
 * `loadPage`), plus the native glass's `data-glass`, `data-fullscreen` and
 * `--glass-clarity` from `?glass=`, `?fullscreen=` and `?clarity=`. Call it
 * before the first render, so a reload never paints the wrong material first.
 */
export function applyMaterialFromLocation(): RendererMaterial {
  const params = new URLSearchParams(window.location.search);
  const root = document.documentElement;
  const material: RendererMaterial = params.get('material') === 'vibrancy' ? 'vibrancy' : 'css';
  root.dataset.material = material;
  const glass = params.get('glass');
  if (glass === 'native' || glass === 'square') root.dataset.glass = glass;
  if (glass === 'native') {
    root.toggleAttribute('data-fullscreen', params.get('fullscreen') === '1');
    setClarity(Number(params.get('clarity')));
  }
  return material;
}

/** Whether the window has the native glass (macOS, addon loaded): Glass clarity applies. */
export function hasNativeGlass(): boolean {
  return document.documentElement.dataset.glass === 'native';
}

function setClarity(clarity: number): void {
  if (Number.isFinite(clarity)) document.documentElement.style.setProperty('--glass-clarity', String(Math.min(1, Math.max(0, clarity))));
}

/**
 * Mirrors the app's appearance settings onto `<html>`. The OS preferences
 * (`prefers-reduced-transparency`, `prefers-contrast`) are read by CSS media
 * queries directly; either source turns a mode on. Glass clarity drives the
 * legibility layers (`--glass-clarity`) only under the native glass.
 */
export function useAppearance(reduceTransparency: boolean, increaseContrast: boolean, glassClarity?: number): void {
  useEffect(() => {
    const root = document.documentElement;
    if (reduceTransparency) root.dataset.reduceTransparency = 'on';
    else delete root.dataset.reduceTransparency;
    if (increaseContrast) root.dataset.contrast = 'more';
    else delete root.dataset.contrast;
  }, [reduceTransparency, increaseContrast]);
  useEffect(() => {
    if (glassClarity !== undefined && hasNativeGlass()) setClarity(glassClarity);
  }, [glassClarity]);
}
