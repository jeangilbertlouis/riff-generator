import type { NoteEvent, Riff } from '../engine/types.ts';

/** Tone.js default pulses per quarter note. */
export const DEFAULT_PPQ = 192;

export type ScheduledNote = {
  /** Transport position in ticks. */
  ticks: number;
  durationTicks: number;
  midi: number;
  palmMute: boolean;
  accent: boolean;
  /** Riff step the note starts on (for the cursor/tab). */
  step: number;
};

export type Schedule = {
  ppq: number;
  ticksPerStep: number;
  /** Tick of each count-in beat (empty when the count-in is off). */
  countIn: number[];
  /** Where the riff starts; equals the loop start. */
  riffStart: number;
  /** End of the riff; equals the loop end. */
  riffEnd: number;
  totalSteps: number;
  guitar1: ScheduledNote[];
  guitar2: ScheduledNote[];
  drums: ScheduledDrum[];
};

export type ScheduledDrum = { ticks: number; piece: Riff['drums'][number]['piece']; accent: boolean; step: number };

export type ScheduleOptions = { countIn: boolean; ppq?: number };

/** Turn a riff into transport ticks. With the count-in on, the riff starts one 4/4 bar later. */
export function buildSchedule(riff: Riff, { countIn, ppq = DEFAULT_PPQ }: ScheduleOptions): Schedule {
  if (ppq % 4 !== 0) throw new RangeError('PPQ must be divisible by 4');
  const ticksPerStep = ppq / 4;
  const beats = riff.timeSignature[0];
  const riffStart = countIn ? beats * ppq : 0;

  const toScheduled = (n: NoteEvent): ScheduledNote => ({
    ticks: riffStart + n.step * ticksPerStep,
    durationTicks: n.duration * ticksPerStep,
    midi: n.midi,
    palmMute: n.palmMute,
    accent: n.accent,
    step: n.step,
  });

  return {
    ppq,
    ticksPerStep,
    countIn: countIn ? Array.from({ length: beats }, (_, i) => i * ppq) : [],
    riffStart,
    riffEnd: riffStart + riff.totalSteps * ticksPerStep,
    totalSteps: riff.totalSteps,
    guitar1: riff.guitar1.map(toScheduled),
    guitar2: riff.guitar2.map(toScheduled),
    drums: riff.drums.map((d) => ({ ticks: riffStart + d.step * ticksPerStep, piece: d.piece, accent: d.accent, step: d.step })),
  };
}

export type CursorPosition =
  | { kind: 'countIn'; beat: number }
  | { kind: 'riff'; step: number };

/** Where the playhead is, for a transport position in ticks. */
export function positionAtTicks(s: Schedule, ticks: number): CursorPosition {
  if (ticks < s.riffStart) return { kind: 'countIn', beat: Math.floor(ticks / s.ppq) };
  const step = Math.round((ticks - s.riffStart) / s.ticksPerStep);
  return { kind: 'riff', step: ((step % s.totalSteps) + s.totalSteps) % s.totalSteps };
}

/**
 * How long a note actually sounds, as a fraction of its written length. Palm mutes are
 * choked earlier; every note is cut a little before the next 16th. Shared by audio and MIDI.
 */
export function soundingFraction(palmMute: boolean): number {
  // Short palm mutes and a small gap after open notes keep fast riffs articulated.
  return palmMute ? 0.7 : 0.88;
}

/** Note velocity 0–1: accents loud, palm mutes slightly softer. Shared by audio and MIDI. */
export function noteVelocity(accent: boolean, palmMute: boolean): number {
  return (accent ? 1 : 0.75) * (palmMute ? 0.9 : 1);
}

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}
