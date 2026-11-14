import * as Tone from 'tone';
import { DUPLICATE_WINDOW, effectiveTime } from './guitar.ts';

/** Muted-string scratch for the count-in: a short noise burst, band-passed and distorted, centered. */
export class CountInVoice {
  private readonly noise: Tone.NoiseSynth;
  private readonly nodes: Tone.ToneAudioNode[];
  private lastClick = -Infinity;

  constructor(destination: Tone.InputNode) {
    this.noise = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.045, sustain: 0, release: 0.01 },
    });
    const band = new Tone.Filter({ type: 'bandpass', frequency: 1800, Q: 1.2 });
    const distortion = new Tone.Distortion(0.6);
    const tone = new Tone.Filter({ type: 'lowpass', frequency: 5000 });
    const volume = new Tone.Volume(-10);
    this.noise.chain(band, distortion, tone, volume);
    volume.connect(destination);
    this.nodes = [this.noise, band, distortion, tone, volume];
  }

  /** The first beat of the count-in is accented. */
  click(requested: number, accent: boolean): void {
    const time = effectiveTime(requested, this.noise.context.currentTime);
    if (time <= this.lastClick + DUPLICATE_WINDOW) return; // duplicate (or late, clamped) event from Tone's clock
    this.lastClick = time;
    this.noise.triggerAttackRelease(0.05, time, accent ? 1 : 0.65);
  }

  dispose(): void {
    this.nodes.forEach((n) => n.dispose());
  }
}
