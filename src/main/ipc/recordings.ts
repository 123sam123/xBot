import { z } from 'zod';
import {
  areaPickedSchema,
  cameraChunkSchema,
  cameraDeviceSchema,
  cameraStartedSchema,
  pickAreaSchema,
  recordingIdSchema,
  startRecordingSchema,
  type CaptureRect,
} from '../../shared/contracts/recordings';
import { recordingsChannels } from '../../shared/contracts/recordings.channels';
import { recordings } from '../services/recordings';
import { hideArea, showArea, showPanel } from '../windows/recorder';
import { handle } from './register';

let areaAnswer: ((rect: CaptureRect | null) => void) | null = null;

export function registerRecordingsIpc(): void {
  handle(recordingsChannels.setup, z.undefined(), () => recordings.setup());
  handle(recordingsChannels.openPanel, z.undefined(), () => {
    recordings.openPanel();
    return null;
  });
  handle(recordingsChannels.closePanel, z.undefined(), () => {
    recordings.closePanel();
    return null;
  });
  handle(recordingsChannels.requestPermission, z.undefined(), () => recordings.requestPermission());

  // The overlay covers the display; its answer comes back as `areaPicked`, in points relative to that display.
  handle(recordingsChannels.pickArea, pickAreaSchema, ({ displayId }) => {
    areaAnswer?.(null);
    showArea(displayId);
    return new Promise<CaptureRect | null>((resolve) => {
      areaAnswer = (rect) => {
        areaAnswer = null;
        hideArea();
        showPanel();
        resolve(rect);
      };
    });
  });
  handle(recordingsChannels.areaPicked, areaPickedSchema, ({ rect }) => {
    areaAnswer?.(rect);
    return null;
  });

  handle(recordingsChannels.setCamera, cameraDeviceSchema, ({ deviceId }) => {
    recordings.setCamera(deviceId);
    return null;
  });
  handle(recordingsChannels.start, startRecordingSchema, async (options) => {
    await recordings.start(options);
    return null;
  });
  handle(recordingsChannels.pause, z.undefined(), () => {
    recordings.pause();
    return null;
  });
  handle(recordingsChannels.resume, z.undefined(), () => {
    recordings.resume();
    return null;
  });
  // Not awaited: saving can take a while, and the bar shows "Saving…" from the state events.
  handle(recordingsChannels.stop, z.undefined(), () => {
    void recordings.stop();
    return null;
  });
  handle(recordingsChannels.restart, z.undefined(), async () => {
    await recordings.restart();
    return null;
  });
  handle(recordingsChannels.discard, z.undefined(), async () => {
    await recordings.discard();
    return null;
  });
  handle(recordingsChannels.state, z.undefined(), () => recordings.state());
  handle(recordingsChannels.cameraStarted, cameraStartedSchema, ({ id, startedAt, mime }) => {
    recordings.cameraStarted(id, startedAt, mime);
    return null;
  });
  handle(recordingsChannels.cameraChunk, cameraChunkSchema, async ({ id, bytes }) => {
    await recordings.cameraChunk(id, bytes);
    return null;
  });
  handle(recordingsChannels.list, z.undefined(), () => recordings.list());
  handle(recordingsChannels.open, recordingIdSchema, async ({ id }) => {
    await recordings.open(id);
    return null;
  });
  handle(recordingsChannels.reveal, recordingIdSchema, ({ id }) => {
    recordings.reveal(id);
    return null;
  });
  handle(recordingsChannels.remove, recordingIdSchema, async ({ id }) => {
    await recordings.remove(id);
    return null;
  });
  handle(recordingsChannels.cameraDone, recordingIdSchema, ({ id }) => {
    recordings.cameraDone(id);
    return null;
  });
}
