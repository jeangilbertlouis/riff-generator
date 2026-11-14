import * as Tone from 'tone';
import { DUPLICATE_WINDOW, effectiveTime } from './guitar.ts';
import { midiToFrequency } from './schedule.ts';

/** Every pad setting in one place, so the sound can be tuned by ear. */
export const PAD = {
  oscillator: { type: 'fatsawtooth', count: 3, spread: 18 },
  envelope: { attack: 0.08, decay: 0.4, sustain: 0.75, release: 0.9 },
  /** Low-pass so the pad fills the space without fighting the distorted guitars. */
  lowpass: 2000,
  highpass: 120,
  /** Pad output; set so it sits under the guitars (measured, see readme §6.16). */
  outputDb: -20,
} as const;

/** A soft polyphonic synth pad playing the backing chords, centered. */
export class PadSynth {
  private readonly synth: Tone.PolySynth;
  private readonly volume: Tone.Volume;
  private readonly gate: Tone.Gain;
  private readonly nodes: Tone.ToneAudioNode[];
  private lastChord = -Infinity;

  constructor(destination: Tone.InputNode) {
    this.synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { ...PAD.oscillator },
      envelope: { ...PAD.envelope },
    });
    const lowpass = new Tone.Filter({ type: 'lowpass', frequency: PAD.lowpass, rolloff: -24 });
    const highpass = new Tone.Filter({ type: 'highpass', frequency: PAD.highpass });
    this.volume = new Tone.Volume(PAD.outputDb);
    this.gate = new Tone.Gain(1);
    this.synth.chain(highpass, lowpass, this.volume, this.gate);
    this.gate.connect(destination);
    this.nodes = [this.synth, highpass, lowpass, this.volume, this.gate];
  }

  /** Play a chord (MIDI pitches) at `time` for `duration` seconds. */
  play(midis: number[], duration: number, requested: number): void {
    const time = effectiveTime(requested, this.synth.context.currentTime);
    if (time <= this.lastChord + DUPLICATE_WINDOW) return;
    this.lastChord = time;
    this.synth.triggerAttackRelease(midis.map(midiToFrequency), duration, time, 0.8);
  }

  setVolume(db: number, immediate = false): void {
    if (immediate) this.volume.volume.value = db;
    else this.volume.volume.rampTo(db, 0.05);
  }

  setAudible(audible: boolean, immediate = false): void {
    if (immediate) this.gate.gain.value = audible ? 1 : 0;
    else this.gate.gain.rampTo(audible ? 1 : 0, 0.02);
  }

  silence(): void {
    this.synth.releaseAll();
  }

  dispose(): void {
    this.nodes.forEach((n) => n.dispose());
  }
}
