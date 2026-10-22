import { useEffect, useRef, useState } from 'react';
import type { CameraCommand } from '../../shared/contracts/recordings';

// The round camera bubble: a mirrored live preview the user can drag
// anywhere. While recording it records the camera (no sound; the microphone
// is in the screen recording) and streams the file to main in order. The
// bubble itself is never in the screen recording: the editor places the camera.

const MIME_TYPES = ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];

export function CameraBubble() {
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const recorder = useRef<{ id: string; media: MediaRecorder; queue: Promise<unknown>; discard: boolean } | null>(null);

  useEffect(() => {
    let current: MediaStream | null = null;
    const show = async (deviceId: string | null) => {
      for (const track of current?.getTracks() ?? []) track.stop();
      current = null;
      setStream(null);
      setFailed(null);
      if (!deviceId) return;
      try {
        current = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false });
        setStream(current);
      } catch {
        setFailed('Camera unavailable');
      }
    };
    const off = window.xbot.events.on('recording:camera-device', ({ deviceId }) => void show(deviceId));
    return () => {
      off();
      for (const track of current?.getTracks() ?? []) track.stop();
    };
  }, []);

  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
  }, [stream]);

  useEffect(
    () =>
      window.xbot.events.on('recording:camera', ({ id, command }: { id: string; command: CameraCommand }) => {
        const active = recorder.current;
        if (command === 'record') {
          if (!stream || active) return;
          const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
          const media = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
          const entry = { id, media, queue: Promise.resolve() as Promise<unknown>, discard: false };
          recorder.current = entry;
          media.onstart = () => void window.xbot.recordings.cameraStarted(id, Date.now(), media.mimeType || mimeType);
          media.ondataavailable = (event) => {
            if (entry.discard || event.data.size === 0) return;
            entry.queue = entry.queue.then(async () => window.xbot.recordings.cameraChunk(id, new Uint8Array(await event.data.arrayBuffer())));
          };
          media.onstop = () => {
            void entry.queue.then(() => {
              if (!entry.discard) void window.xbot.recordings.cameraDone(id);
            });
            if (recorder.current === entry) recorder.current = null;
          };
          media.start(1000);
          return;
        }
        if (!active || active.id !== id) return;
        if (command === 'pause' && active.media.state === 'recording') active.media.pause();
        else if (command === 'resume' && active.media.state === 'paused') active.media.resume();
        else if (command === 'stop' || command === 'discard') {
          active.discard = command === 'discard';
          if (active.media.state !== 'inactive') active.media.stop();
        }
      }),
    [stream],
  );

  return (
    <div className="camera-bubble" data-testid="camera-bubble">
      {stream ? <video ref={video} className="camera-video" autoPlay muted playsInline /> : <span className="camera-empty">{failed ?? ''}</span>}
    </div>
  );
}
