import type { XbotBridge } from '../shared/contracts/bridge';

declare global {
  interface Window {
    /** The preload bridge — the renderer's only way to reach the main process. */
    readonly xbot: XbotBridge;
  }
}

export {};
