import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

// Content-Security-Policy for both renderer pages. Dev differs only in what the
// Vite dev server needs: its origin + websocket, the React refresh preamble
// (inline script) and injected <style> tags.
const PROD_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob: xbot-media:",
  "media-src 'self' blob: xbot-media:",
  "font-src 'self' data:",
  "connect-src 'self' xbot-media:",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const DEV_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: xbot-media:",
  "media-src 'self' blob: xbot-media:",
  "font-src 'self' data:",
  "connect-src 'self' xbot-media: ws://localhost:* http://localhost:*",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'xbot-csp',
    transformIndexHtml(html, ctx) {
      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: ctx.server ? DEV_CSP : PROD_CSP },
            injectTo: 'head-prepend',
          },
        ],
      };
    },
  };
}

export default defineConfig({
  main: {},
  preload: {
    // A sandboxed preload cannot require() packages, so bundle everything it
    // imports into one CJS file.
    build: { externalizeDeps: false },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), cspPlugin()],
    build: {
      rolldownOptions: {
        input: {
          composer: resolve(__dirname, 'src/renderer/composer/index.html'),
          studio: resolve(__dirname, 'src/renderer/studio/index.html'),
        },
      },
    },
  },
});
