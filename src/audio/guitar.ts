import * as Tone from 'tone';
import { midiToFrequency, noteVelocity, soundingFraction } from './schedule.ts';

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

/** Every tone setting in one place, so it can be tuned by ear. */
export const TONE = {
  oscillator: { type: 'fatsawtooth', count: 2, spread: 12 },
  envelope: { attack: 0.002, decay: 0.08, sustain: 0.85, release: 0.05 },
  /** Low-pass before the amp: open notes vs palm mutes. */
  openCutoff: 3500,
  palmMuteCutoff: 700,
  /** "Tight" boost in front of the distortion, like an overdrive pedal: cut lows, push the mids. */
  tightHighpass: 110,
  midHump: { frequency: 900, gain: 6, Q: 0.8 },
  distortion: 0.9,
  /** Pick attack: a very short, bright noise burst into the distortion. */
  pick: { decay: 0.012, highpass: 2000, levelDb: -12 },
  /** Cab-style EQ after the distortion. */
  postHighpass: 80,
  scoop: { frequency: 450, gain: -4, Q: 0.9 },
  presence: { frequency: 2800, gain: 3, Q: 1 },
  cabLowpass: 5500,
  /** −3.5 rather than −6: the tighter, brighter chain measures ~3 dB quieter at the same peak. */
  outputDb: -3.5,
} as const;

/**
 * One distorted rhythm guitar:
 * synth → palm-mute low-pass → tight high-pass → mid hump → distortion (+ pick noise)
 * → high-pass → mid scoop → presence → cab low-pass → pan → volume → mute gain.
 */
export class GuitarVoice {
  private readonly synth: Tone.Synth;
  private readonly pick: Tone.NoiseSynth;
  private readonly preFilter: Tone.Filter;
  private readonly volume: Tone.Volume;
  private readonly gate: Tone.Gain;
  private readonly nodes: Tone.ToneAudioNode[];
  private readonly delaySeconds: number;
  private lastAttack = -Infinity;

  constructor(options: GuitarVoiceOptions, destination: Tone.InputNode) {
    this.delaySeconds = options.delaySeconds;
    this.synth = new Tone.Synth({ oscillator: { ...TONE.oscillator }, envelope: { ...TONE.envelope } });
    this.synth.detune.value = options.detuneCents;

    this.preFilter = new Tone.Filter({ type: 'lowpass', frequency: TONE.openCutoff, rolloff: -12, Q: 0.7 });
    const tight = new Tone.Filter({ type: 'highpass', frequency: TONE.tightHighpass, rolloff: -12 });
    const hump = new Tone.Filter({ type: 'peaking', ...TONE.midHump });
    const distortion = new Tone.Distortion({ distortion: TONE.distortion, oversample: '4x' });
    const highPass = new Tone.Filter({ type: 'highpass', frequency: TONE.postHighpass, rolloff: -12 });
    const scoop = new Tone.Filter({ type: 'peaking', ...TONE.scoop });
    const presence = new Tone.Filter({ type: 'peaking', ...TONE.presence });
    const cab = new Tone.Filter({ type: 'lowpass', frequency: TONE.cabLowpass, rolloff: -24, Q: 0.5 });
    const panner = new Tone.Panner(options.pan);
    this.volume = new Tone.Volume(TONE.outputDb);
    this.gate = new Tone.Gain(1);

    this.pick = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.0005, decay: TONE.pick.decay, sustain: 0, release: 0.005 },
    });
    const pickFilter = new Tone.Filter({ type: 'highpass', frequency: TONE.pick.highpass });
    const pickLevel = new Tone.Volume(TONE.pick.levelDb);
    this.pick.chain(pickFilter, pickLevel, tight);

    this.synth.chain(this.preFilter, tight, hump, distortion, highPass, scoop, presence, cab, panner, this.volume, this.gate);
    this.gate.connect(destination);
    this.nodes = [
      this.synth, this.pick, pickFilter, pickLevel, this.preFilter, tight, hump, distortion,
      highPass, scoop, presence, cab, panner, this.volume, this.gate,
    ];
  }

  /** Play one note at `time` (AudioContext seconds) for `duration` seconds. */
  play(note: PlayableNote, duration: number, time: number): void {
    const t = time + this.delaySeconds;
    // Tone's clock can occasionally invoke the same event in two consecutive blocks, with a
    // time that differs only by float drift. A part is monophonic and real notes are ≥ ~58 ms
    // apart (a 16th at 260 BPM), so an attack within 0.1 ms of the previous one is a duplicate.
    if (t <= this.lastAttack + DUPLICATE_WINDOW) return;
    this.lastAttack = t;
    this.preFilter.frequency.setValueAtTime(note.palmMute ? TONE.palmMuteCutoff : TONE.openCutoff, t);
    const length = Math.max(0.02, duration * soundingFraction(note.palmMute));
    const velocity = noteVelocity(note.accent, note.palmMute);
    this.synth.triggerAttackRelease(midiToFrequency(note.midi), length, t, velocity);
    this.pick.triggerAttackRelease(TONE.pick.decay, t, velocity);
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
