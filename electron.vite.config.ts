import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin, ViteDevServer } from 'vite';

// Content-Security-Policy for both renderer pages. Dev differs only in what the
// Vite dev server needs: its own origin ('self') and HMR websocket, the React
// refresh preamble (inline script) and injected <style> tags. Neither policy
// lets the renderer reach anything else on localhost, such as Ollama: all AI
// calls go through the main process (docs/OLLAMA.md).
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

function devCsp(port: number): string {
  return [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: xbot-media:",
    "media-src 'self' blob: xbot-media:",
    "font-src 'self' data:",
    `connect-src 'self' xbot-media: ws://localhost:${port}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/** The port the dev server actually listens on (Vite moves on when 5173 is taken). */
function devServerPort(server: ViteDevServer): number {
  const address = server.httpServer?.address();
  if (address && typeof address === 'object') return address.port;
  return server.config.server.port ?? 5173;
}

function cspPlugin(): Plugin {
  return {
    name: 'xbot-csp',
    transformIndexHtml(html, ctx) {
      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: ctx.server ? devCsp(devServerPort(ctx.server)) : PROD_CSP },
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
