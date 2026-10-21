import { EventEmitter } from 'node:events';
import { BrowserWindow } from 'electron';
import { eventsChannel } from '../shared/contracts/events.channels';
import {
  forwardedEvents,
  type AppEventName,
  type AppEventPayloads,
  type ForwardedEventName,
  type RendererEventMessage,
} from '../shared/contracts/events';

type AppEventArgs = { [K in AppEventName]: [AppEventPayloads[K]] };

/** The main-process event bus. Event names and payloads come from the domain contracts. */
export const appEvents = new EventEmitter<AppEventArgs>();

/** Pushes an event to every renderer window on the single `xbot:event` channel. */
export function broadcast<K extends ForwardedEventName>(name: K, payload: AppEventPayloads[K]): void {
  const message: RendererEventMessage<K> = { name, payload };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(eventsChannel, message);
  }
}

/** Forwards the contract's renderer-visible events from the bus to every window. */
export function forwardEventsToRenderers(): void {
  for (const name of forwardedEvents) {
    appEvents.on(name, (payload: AppEventPayloads[typeof name]) => broadcast(name, payload));
  }
}
