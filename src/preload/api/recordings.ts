import type { RecordingsApi } from '../../shared/contracts/recordings';
import { recordingsChannels } from '../../shared/contracts/recordings.channels';
import { invoke } from '../invoke';

export const recordings: RecordingsApi = {
  setup: () => invoke(recordingsChannels.setup),
  openPanel: () => invoke(recordingsChannels.openPanel),
  closePanel: () => invoke(recordingsChannels.closePanel),
  requestPermission: () => invoke(recordingsChannels.requestPermission),
  pickArea: (displayId) => invoke(recordingsChannels.pickArea, { displayId }),
  areaPicked: (rect) => invoke(recordingsChannels.areaPicked, { rect }),
  setCamera: (deviceId) => invoke(recordingsChannels.setCamera, { deviceId }),
  start: (options) => invoke(recordingsChannels.start, options),
  pause: () => invoke(recordingsChannels.pause),
  resume: () => invoke(recordingsChannels.resume),
  stop: () => invoke(recordingsChannels.stop),
  restart: () => invoke(recordingsChannels.restart),
  discard: () => invoke(recordingsChannels.discard),
  state: () => invoke(recordingsChannels.state),
  cameraStarted: (id, startedAt, mime) => invoke(recordingsChannels.cameraStarted, { id, startedAt, mime }),
  cameraChunk: (id, bytes) => invoke(recordingsChannels.cameraChunk, { id, bytes }),
  cameraDone: (id) => invoke(recordingsChannels.cameraDone, { id }),
  list: () => invoke(recordingsChannels.list),
  open: (id) => invoke(recordingsChannels.open, { id }),
  reveal: (id) => invoke(recordingsChannels.reveal, { id }),
  remove: (id) => invoke(recordingsChannels.remove, { id }),
};
