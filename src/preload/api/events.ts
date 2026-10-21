import { ipcRenderer, type IpcRendererEvent } from 'electron';
import type { EventsApi, RendererEventMessage } from '../../shared/contracts/events';
import { eventsChannel } from '../../shared/contracts/events.channels';

export const events: EventsApi = {
  on(name, listener) {
    // The page gets the payload only, never the IpcRendererEvent (it exposes `sender`).
    const handler = (_event: IpcRendererEvent, message: RendererEventMessage) => {
      if (message.name === name) listener(message.payload as Parameters<typeof listener>[0]);
    };
    ipcRenderer.on(eventsChannel, handler);
    return () => {
      ipcRenderer.removeListener(eventsChannel, handler);
    };
  },
};
