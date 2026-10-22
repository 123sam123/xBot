import { describe, expect, it } from 'vitest';
import { cameraOffsetMs, cursorTrack, recordingTime } from '../../src/shared/recording/track';

// The cursor the capture leaves out is redrawn from these: host times become
// recording time (pauses removed), positions become fractions of the
// captured area, and the camera's start lands on the same clock.

const capture = { firstHost: 100, endHost: 110, pauses: [[103, 105]] as [number, number][], bounds: { x: 200, y: 100, width: 1000, height: 500 } };

describe('recording time', () => {
  it('counts from the first frame and skips pauses', () => {
    expect(recordingTime(100, 100, capture.pauses)).toBe(0);
    expect(recordingTime(102, 100, capture.pauses)).toBe(2000);
    expect(recordingTime(104, 100, capture.pauses)).toBeNull();
    expect(recordingTime(106, 100, capture.pauses)).toBe(4000);
  });
});

describe('cursor track', () => {
  it('maps events into the captured area, drops paused and late ones, and starts from the last position before the first frame', () => {
    const events = [
      { t: 99, x: 700, y: 350, type: 0, cursor: 0 },
      { t: 101, x: 1200, y: 600, type: 1, cursor: 1 },
      { t: 104, x: 200, y: 100, type: 0, cursor: 0 },
      { t: 106, x: 450, y: 225, type: 2, cursor: 0 },
      { t: 111, x: 0, y: 0, type: 1, cursor: 0 },
    ];
    const track = cursorTrack(events, [{ id: 0, hotX: 4, hotY: 4, width: 20, height: 30 }], capture);
    expect(track.samples).toEqual([
      { t: 0, x: 0.5, y: 0.5, type: 0, cursor: 0 },
      { t: 1000, x: 1, y: 1, type: 1, cursor: 1 },
      { t: 4000, x: 0.25, y: 0.25, type: 2, cursor: 0 },
    ]);
    expect(track.cursors[0]).toEqual({ id: 0, file: 'cursors/0.png', hotX: 0.004, hotY: 0.004, width: 0.02, height: 0.03 });
  });

  it('places the camera on the recording clock, before the first frame too', () => {
    expect(cameraOffsetMs(100.2, 100, capture.pauses)).toBeCloseTo(200, 6);
    expect(cameraOffsetMs(99.9, 100, capture.pauses)).toBeCloseTo(-100, 6);
  });
});
