import { VOLUME_MAX, type AudioSettings } from '../../../shared/composition/model';
import { MicIcon, Slider, SpeakerIcon, Toggle } from '../../design-system';
import { Section, SliderRow, type TabProps } from './parts';

const percent = (volume: number) => `${Math.round(volume * 100)}%`;

/** Cap's audio inspector: mute, and for a recording the system and microphone volumes apart. */
export function AudioTab({
  composition,
  onChange,
  onCommit,
  hasAudio,
  tracks,
}: TabProps & {
  hasAudio: boolean;
  /** Which separate tracks a recording has; null for other videos. */
  tracks: { system: boolean; microphone: boolean } | null;
}) {
  const video = composition.video!;
  const audio = composition.audio;
  const set = (patch: Partial<AudioSettings>, gesture: string) => audio && onChange({ ...composition, audio: { ...audio, ...patch } }, gesture);
  const anySound = hasAudio || (tracks !== null && (tracks.system || tracks.microphone));
  return (
    <>
      <Section title="Audio" icon={<SpeakerIcon size={18} />}>
        <Toggle
          label="Mute audio"
          description={anySound ? undefined : 'This video has no sound'}
          checked={video.muted || !anySound}
          disabled={!anySound}
          onChange={(muted) => onChange({ ...composition, video: { ...video, muted } })}
        />
      </Section>
      {audio && tracks?.microphone && (
        <Section title="Microphone" icon={<MicIcon size={18} />} action={<span className="sidebar-value">{percent(audio.micVolume)}</span>}>
          <SliderRow label="Volume">
            <Slider label="Microphone volume" min={0} max={VOLUME_MAX} step={0.01} value={audio.micVolume} onChange={(micVolume) => set({ micVolume }, 'mic-volume')} onCommit={onCommit} testId="mic-volume" />
          </SliderRow>
        </Section>
      )}
      {audio && tracks?.system && (
        <Section title="System audio" icon={<SpeakerIcon size={18} />} action={<span className="sidebar-value">{percent(audio.systemVolume)}</span>}>
          <SliderRow label="Volume">
            <Slider label="System audio volume" min={0} max={VOLUME_MAX} step={0.01} value={audio.systemVolume} onChange={(systemVolume) => set({ systemVolume }, 'system-volume')} onCommit={onCommit} testId="system-volume" />
          </SliderRow>
        </Section>
      )}
    </>
  );
}
