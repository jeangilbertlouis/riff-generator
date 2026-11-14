import { NOTE_NAMES, type NoteName, type ScaleId } from './types.ts';

export type ScaleInfo = { name: string; intervals: readonly number[] };

export const SCALES: Record<ScaleId, ScaleInfo> = {
  phrygian: { name: 'Phrygian', intervals: [0, 1, 3, 5, 7, 8, 10] },
  phrygianDominant: { name: 'Phrygian dominant (harm. minor mode 5)', intervals: [0, 1, 4, 5, 7, 8, 10] },
  locrian: { name: 'Locrian', intervals: [0, 1, 3, 5, 6, 8, 10] },
  naturalMinor: { name: 'Natural minor', intervals: [0, 2, 3, 5, 7, 8, 10] },
  harmonicMinor: { name: 'Harmonic minor', intervals: [0, 2, 3, 5, 7, 8, 11] },
  // The other modes of harmonic minor (mode 5 is Phrygian dominant, above).
  locrianNat6: { name: 'Locrian ♮6 (harm. minor mode 2)', intervals: [0, 1, 3, 5, 6, 9, 10] },
  ionianSharp5: { name: 'Ionian ♯5 (harm. minor mode 3)', intervals: [0, 2, 4, 5, 8, 9, 11] },
  dorianSharp4: { name: 'Ukrainian Dorian (harm. minor mode 4)', intervals: [0, 2, 3, 6, 7, 9, 10] },
  lydianSharp2: { name: 'Lydian ♯2 (harm. minor mode 6)', intervals: [0, 3, 4, 6, 7, 9, 11] },
  ultralocrian: { name: 'Ultralocrian (harm. minor mode 7)', intervals: [0, 1, 3, 4, 6, 8, 9] },
  diminished: { name: 'Diminished (half-whole)', intervals: [0, 1, 3, 4, 6, 7, 9, 10] },
  chromatic: { name: 'Chromatic', intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
};

export const SCALE_IDS = Object.keys(SCALES) as ScaleId[];

export function pitchClassOf(name: NoteName): number {
  return NOTE_NAMES.indexOf(name);
}

export function pc(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

export function midiToName(midi: number): string {
  return `${NOTE_NAMES[pc(midi)]}${Math.floor(midi / 12) - 1}`;
}

export function scalePitchClasses(key: NoteName, scale: ScaleId): number[] {
  const root = pitchClassOf(key);
  return SCALES[scale].intervals.map((i) => (root + i) % 12);
}

export function isInScale(midi: number, key: NoteName, scale: ScaleId): boolean {
  return scalePitchClasses(key, scale).includes(pc(midi));
}

/** Semitone distance of a pitch above the key's root, 0–11. */
export function degreeOf(midi: number, key: NoteName): number {
  return pc(midi - pitchClassOf(key));
}

/** All scale pitches in [low, high], ascending. */
export function scaleNotesInRange(key: NoteName, scale: ScaleId, low: number, high: number): number[] {
  const pcs = scalePitchClasses(key, scale);
  const out: number[] = [];
  for (let m = low; m <= high; m++) if (pcs.includes(pc(m))) out.push(m);
  return out;
}

/**
 * Move a scale note by `steps` scale degrees (positive = up).
 * The note must be in the scale.
 */
export function shiftByScaleSteps(midi: number, steps: number, key: NoteName, scale: ScaleId): number {
  const notes = scaleNotesInRange(key, scale, 0, 127);
  const i = notes.indexOf(midi);
  if (i < 0) throw new Error(`${midiToName(midi)} is not in ${key} ${scale}`);
  const target = notes[i + steps];
  if (target === undefined) throw new Error('Scale step out of MIDI range');
  return target;
}

/** True when the scale contains the ♭2 (one semitone above the root). */
export function hasFlatTwo(scale: ScaleId): boolean {
  return SCALES[scale].intervals.includes(1);
}
