import type { ComplexityProfile } from './complexity.ts';
import type { Rng } from './random.ts';
import { SCALES, pc, pitchClassOf } from './theory.ts';
import { NOTE_NAMES, type Bars, type ChordSlot, type NoteName, type ScaleId } from './types.ts';

export type { ChordSlot };
export type ChordQuality = ChordSlot['quality'];

/**
 * A triad. `degree` is the scale degree index (for the Chromatic scale, semitones above the key
 * root); `tones` are pitch classes root, third, fifth; `roman` is relative to the key ("i", "♭II",
 * "V", "♭III+", "vii°"); `name` is the letter name ("Em", "F", "G#°").
 */
export type Chord = Omit<ChordSlot, 'step' | 'length'>;

const NUMERALS: [string, string][] = [
  ['', 'I'], ['♭', 'II'], ['', 'II'], ['♭', 'III'], ['', 'III'], ['', 'IV'],
  ['♭', 'V'], ['', 'V'], ['♭', 'VI'], ['', 'VI'], ['♭', 'VII'], ['', 'VII'],
];

function qualityOf(third: number, fifth: number): ChordQuality {
  if (third === 3) return fifth === 6 ? 'diminished' : 'minor';
  return fifth === 8 ? 'augmented' : 'major';
}

function describe(degree: number, rootPc: number, tones: number[], keyPc: number): Chord {
  const third = pc(tones[1]! - rootPc);
  const fifth = pc(tones[2]! - rootPc);
  const quality = qualityOf(third, fifth);
  const [accidental, numeral] = NUMERALS[pc(rootPc - keyPc)]!;
  const lower = quality === 'minor' || quality === 'diminished';
  const suffix = quality === 'diminished' ? '°' : quality === 'augmented' ? '+' : '';
  const nameSuffix = quality === 'minor' ? 'm' : suffix;
  return {
    degree,
    rootPc,
    tones,
    quality,
    roman: `${accidental}${lower ? numeral.toLowerCase() : numeral}${suffix}`,
    name: `${NOTE_NAMES[rootPc]}${nameSuffix}`,
  };
}

/**
 * The triad on a scale degree: the scale's own thirds stacked (degree, +2, +4 scale steps),
 * so the quality is always right for the scale. The Chromatic scale has no diatonic thirds:
 * there `degree` is a semitone offset and the chord is a minor triad.
 */
export function chordOnDegree(key: NoteName, scale: ScaleId, degree: number): Chord {
  const keyPc = pitchClassOf(key);
  if (scale === 'chromatic') {
    const rootPc = pc(keyPc + degree);
    return describe(degree, rootPc, [rootPc, pc(rootPc + 3), pc(rootPc + 7)], keyPc);
  }
  const iv = SCALES[scale].intervals;
  const n = iv.length;
  const at = (step: number) => pc(keyPc + iv[(degree + step) % n]!);
  return describe(degree, at(0), [at(0), at(2), at(4)], keyPc);
}

/** Idiomatic progressions per scale (scale degrees; semitone offsets for Chromatic). All start on the tonic. */
export const PROGRESSIONS: Record<ScaleId, { two: number[][]; four: number[][] }> = {
  // i ♭II ♭III iv v° ♭VI ♭vii
  phrygian: { two: [[0, 1], [0, 5], [0, 6]], four: [[0, 5, 1, 0], [0, 3, 1, 0], [0, 1, 0, 6], [0, 5, 6, 1]] },
  // I ♭II iii° iv v° ♭VI ♭vii
  phrygianDominant: { two: [[0, 1], [0, 3]], four: [[0, 3, 1, 0], [0, 5, 1, 0], [0, 1, 5, 1]] },
  // i° ♭II ♭iii iv ♭V ♭VI ♭vii
  locrian: { two: [[0, 1], [0, 4]], four: [[0, 4, 1, 0], [0, 1, 4, 0], [0, 5, 4, 1]] },
  // i ii° ♭III iv v ♭VI ♭VII
  naturalMinor: { two: [[0, 5], [0, 6], [0, 3]], four: [[0, 5, 6, 0], [0, 3, 5, 6], [0, 6, 5, 4], [0, 5, 3, 4]] },
  // i ii° ♭III+ iv V ♭VI vii°
  harmonicMinor: { two: [[0, 4], [0, 5]], four: [[0, 3, 4, 0], [0, 5, 4, 0], [0, 6, 0, 4], [0, 5, 3, 4]] },
  // diminished triads; degrees 0/2/4/6 are the minor-third axis
  diminished: { two: [[0, 2], [0, 4]], four: [[0, 2, 4, 2], [0, 6, 4, 2], [0, 4, 2, 6]] },
  // minor triads; ♭II and tritone moves
  chromatic: { two: [[0, 1], [0, 6]], four: [[0, 1, 6, 0], [0, 8, 1, 0], [0, 3, 6, 1], [0, 6, 5, 1]] },
};

/** How many chords per half of the riff (the progression repeats in A′). */
export function chordsPerHalf(bars: Bars, profile: ComplexityProfile, rng: Rng): 2 | 4 {
  if (bars === 1 || profile.maxChordsPerHalf === 2) return 2;
  if (bars === 4) return 4;
  return profile.fourChordChance > 0 && rng.chance(profile.fourChordChance) ? 4 : 2;
}

/**
 * Pick a progression and lay it over the riff: it spans the first half (A) and repeats
 * in the second half (A′), so the A/A′ repetition stays true to the harmony.
 */
export function chooseProgression(
  key: NoteName,
  scale: ScaleId,
  bars: Bars,
  profile: ComplexityProfile,
  rng: Rng,
): ChordSlot[] {
  const count = chordsPerHalf(bars, profile, rng);
  const degrees = rng.pick(count === 4 ? PROGRESSIONS[scale].four : PROGRESSIONS[scale].two);
  const half = (bars * 16) / 2;
  const length = half / count;
  const slots: ChordSlot[] = [];
  for (const offset of [0, half]) {
    degrees.forEach((degree, i) => slots.push({ ...chordOnDegree(key, scale, degree), step: offset + i * length, length }));
  }
  return slots;
}

export function chordAt(slots: ChordSlot[], step: number): ChordSlot {
  return slots.find((s) => step >= s.step && step < s.step + s.length) ?? (slots.at(-1) as ChordSlot);
}

/** The progression of one half, as Roman numerals ("i – ♭VI – ♭II – i"). */
export function romanProgression(slots: ChordSlot[]): string {
  return slots.slice(0, slots.length / 2).map((s) => s.roman).join(' – ');
}
