import * as Tone from 'tone';
import { midiToFrequency } from './schedule.ts';

export type GuitarVoiceOptions = {
  /** −1 (left) … 1 (right). */
  pan: number;
  detuneCents: number;
  /** Fixed lateness in seconds, so two guitars don't sound machine-locked. */
  delaySeconds: number;
};

export type PlayableNote = { midi: number; palmMute: boolean; accent: boolean };

/** Seconds within which a repeated attack is treated as the same event. */
export const DUPLICATE_WINDOW = 1e-4;

const OPEN_CUTOFF = 3500;
const PALM_MUTE_CUTOFF = 700;

/**
 * One distorted rhythm guitar:
 * fat saw synth → pre-filter (palm mute) → distortion → high-pass → mid scoop → cab low-pass → pan → volume → mute gain.
 */
export class GuitarVoice {
  private readonly synth: Tone.Synth;
  private readonly preFilter: Tone.Filter;
  private readonly volume: Tone.Volume;
  private readonly gate: Tone.Gain;
  private readonly nodes: Tone.ToneAudioNode[];
  private readonly delaySeconds: number;
  private lastAttack = -Infinity;

  constructor(options: GuitarVoiceOptions, destination: Tone.InputNode) {
    this.delaySeconds = options.delaySeconds;
    this.synth = new Tone.Synth({
      oscillator: { type: 'fatsawtooth', count: 2, spread: 12 },
      envelope: { attack: 0.002, decay: 0.08, sustain: 0.85, release: 0.05 },
    });
    this.synth.detune.value = options.detuneCents;
    this.preFilter = new Tone.Filter({ type: 'lowpass', frequency: OPEN_CUTOFF, rolloff: -12, Q: 0.7 });
    const distortion = new Tone.Distortion({ distortion: 0.9, oversample: '4x' });
    const highPass = new Tone.Filter({ type: 'highpass', frequency: 90, rolloff: -12 });
    const scoop = new Tone.EQ3({ low: 2, mid: -5, high: 0, lowFrequency: 250, highFrequency: 2500 });
    const cab = new Tone.Filter({ type: 'lowpass', frequency: 4500, rolloff: -24, Q: 0.5 });
    const panner = new Tone.Panner(options.pan);
    this.volume = new Tone.Volume(-6);
    this.gate = new Tone.Gain(1);

    this.synth.chain(this.preFilter, distortion, highPass, scoop, cab, panner, this.volume, this.gate);
    this.gate.connect(destination);
    this.nodes = [this.synth, this.preFilter, distortion, highPass, scoop, cab, panner, this.volume, this.gate];
  }

  /** Play one note at `time` (AudioContext seconds) for `duration` seconds. */
  play(note: PlayableNote, duration: number, time: number): void {
    const t = time + this.delaySeconds;
    // Tone's clock can occasionally invoke the same event in two consecutive blocks, with a
    // time that differs only by float drift. A part is monophonic and real notes are ≥ ~58 ms
    // apart (a 16th at 260 BPM), so an attack within 0.1 ms of the previous one is a duplicate.
    if (t <= this.lastAttack + DUPLICATE_WINDOW) return;
    this.lastAttack = t;
    this.preFilter.frequency.setValueAtTime(note.palmMute ? PALM_MUTE_CUTOFF : OPEN_CUTOFF, t);
    // Palm mutes are choked a little earlier; everything is cut before the next 16th starts.
    const length = Math.max(0.02, duration * (note.palmMute ? 0.75 : 0.92));
    const velocity = (note.accent ? 1 : 0.75) * (note.palmMute ? 0.9 : 1);
    this.synth.triggerAttackRelease(midiToFrequency(note.midi), length, t, velocity);
  }

  /** `immediate` skips the de-click ramp (used before playback starts). */
  setVolume(db: number, immediate = false): void {
    if (immediate) this.volume.volume.value = db;
    else this.volume.volume.rampTo(db, 0.05);
  }

  setAudible(audible: boolean, immediate = false): void {
    if (immediate) this.gate.gain.value = audible ? 1 : 0;
    else this.gate.gain.rampTo(audible ? 1 : 0, 0.02);
  }

  silence(): void {
    this.synth.triggerRelease();
  }

  dispose(): void {
    this.nodes.forEach((n) => n.dispose());
  }
}
