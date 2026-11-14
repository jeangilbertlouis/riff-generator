import * as Tone from 'tone';
import type { DrumPiece } from '../engine/drums.ts';
import { DUPLICATE_WINDOW, effectiveTime } from './guitar.ts';

/** Every drum setting in one place, so the kit can be tuned by ear. */
export const KIT = {
  kick: {
    note: 'C1',
    pitchDecay: 0.035,
    octaves: 6,
    decay: 0.28,
    levelDb: 3,
    /** Beater click: a short, bright noise tick so the kick cuts through distorted guitars. */
    clickHighpass: 2500,
    clickLevelDb: -4,
  },
  /** Snare: a tuned body plus a wide, lower noise band (the "crack"), with a slightly longer tail. */
  snare: { bodyNote: 'G3', bodyDecay: 0.12, bodyLevelDb: 0, noiseDecay: 0.2, bandpass: 1800, bandQ: 0.6, noiseLevelDb: 4 },
  /** Closed hi-hat: bright noise, high-passed, very short. (A MetalSynth hat broke under Tone's offline clock.) */
  hat: { decay: 0.04, highpass: 7000, levelDb: -18 },
  crash: { decay: 1.4, highpass: 4500, levelDb: -20 },
  /** Velocity of non-accented hits: kick and snare stay strong; hats and crash recede. */
  ghost: { kick: 0.85, snare: 0.85, hat: 0.55, crash: 0.7 },
  /** Kit output (the per-piece levels above set the balance inside the kit). Keeps the riff on top and peaks under the limiter. */
  outputDb: -14.5,
} as const;

/**
 * A small synthesized kit: kick, snare, closed hi-hat and crash, centered.
 * Accents play at full velocity; the rest a bit softer.
 */
export class DrumKit {
  private readonly kick: Tone.MembraneSynth;
  private readonly click: Tone.NoiseSynth;
  private readonly snareBody: Tone.MembraneSynth;
  private readonly snareNoise: Tone.NoiseSynth;
  private readonly hat: Tone.NoiseSynth;
  private readonly crash: Tone.NoiseSynth;
  private readonly volume: Tone.Volume;
  private readonly gate: Tone.Gain;
  private readonly nodes: Tone.ToneAudioNode[];
  private readonly last = new Map<DrumPiece, number>();

  constructor(destination: Tone.InputNode) {
    const k = KIT.kick;
    const s = KIT.snare;
    this.volume = new Tone.Volume(KIT.outputDb);
    this.gate = new Tone.Gain(1);
    this.volume.connect(this.gate);
    this.gate.connect(destination);

    this.kick = new Tone.MembraneSynth({
      pitchDecay: k.pitchDecay,
      octaves: k.octaves,
      envelope: { attack: 0.001, decay: k.decay, sustain: 0, release: 0.05 },
      volume: k.levelDb,
    });
    this.click = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.0005, decay: 0.008, sustain: 0 }, volume: k.clickLevelDb });
    const clickFilter = new Tone.Filter({ type: 'highpass', frequency: k.clickHighpass });

    this.snareBody = new Tone.MembraneSynth({
      pitchDecay: 0.01,
      octaves: 2,
      envelope: { attack: 0.001, decay: s.bodyDecay, sustain: 0, release: 0.02 },
      volume: s.bodyLevelDb,
    });
    this.snareNoise = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: s.noiseDecay, sustain: 0 }, volume: s.noiseLevelDb });
    const snareFilter = new Tone.Filter({ type: 'bandpass', frequency: s.bandpass, Q: s.bandQ });

    this.hat = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.0005, decay: KIT.hat.decay, sustain: 0 }, volume: KIT.hat.levelDb });
    const hatFilter = new Tone.Filter({ type: 'highpass', frequency: KIT.hat.highpass });

    this.crash = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.002, decay: KIT.crash.decay, sustain: 0 }, volume: KIT.crash.levelDb });
    const crashFilter = new Tone.Filter({ type: 'highpass', frequency: KIT.crash.highpass });

    this.kick.connect(this.volume);
    this.click.chain(clickFilter, this.volume);
    this.snareBody.connect(this.volume);
    this.snareNoise.chain(snareFilter, this.volume);
    this.hat.chain(hatFilter, this.volume);
    this.crash.chain(crashFilter, this.volume);

    this.nodes = [
      this.kick, this.click, clickFilter, this.snareBody, this.snareNoise, snareFilter,
      this.hat, hatFilter, this.crash, crashFilter, this.volume, this.gate,
    ];
  }

  /** Play one drum hit at `time` (AudioContext seconds). */
  play(piece: DrumPiece, accent: boolean, requested: number): void {
    // Guard on the time Tone will actually use: a late event is moved up to "now", so two late
    // hits can land on the same instant, which a still-ringing voice (the hi-hat) refuses.
    const time = effectiveTime(requested, this.volume.context.currentTime);
    if (time <= (this.last.get(piece) ?? -Infinity) + DUPLICATE_WINDOW) return;
    this.last.set(piece, time);
    const v = accent ? 1 : KIT.ghost[piece];
    switch (piece) {
      case 'kick':
        this.kick.triggerAttackRelease(KIT.kick.note, 0.2, time, v);
        this.click.triggerAttackRelease(0.008, time, v);
        break;
      case 'snare':
        this.snareBody.triggerAttackRelease(KIT.snare.bodyNote, KIT.snare.bodyDecay, time, v);
        this.snareNoise.triggerAttackRelease(KIT.snare.noiseDecay, time, v);
        break;
      case 'hat':
        this.hat.triggerAttackRelease(KIT.hat.decay, time, v);
        break;
      case 'crash':
        this.crash.triggerAttackRelease(KIT.crash.decay, time, v);
        break;
    }
  }

  setVolume(db: number, immediate = false): void {
    if (immediate) this.volume.volume.value = db;
    else this.volume.volume.rampTo(db, 0.05);
  }

  setAudible(audible: boolean, immediate = false): void {
    if (immediate) this.gate.gain.value = audible ? 1 : 0;
    else this.gate.gain.rampTo(audible ? 1 : 0, 0.02);
  }

  dispose(): void {
    this.nodes.forEach((n) => n.dispose());
  }
}
