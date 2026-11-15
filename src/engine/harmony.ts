import type { ComplexityProfile } from './complexity.ts';
import { Rng as RngClass, type Rng } from './random.ts';
import { SCALES, pc, pitchClassOf } from './theory.ts';
import { NOTE_NAMES, type Bars, type ChordChanges, type ChordSlot, type NoteName, type ScaleId } from './types.ts';

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
  // Harmonic minor mode 2. i° ♭II+ ♭iii IV ♭V vi° ♭vii
  locrianNat6: { two: [[0, 1], [0, 4]], four: [[0, 1, 4, 0], [0, 4, 1, 0], [0, 6, 4, 1], [0, 3, 1, 0]] },
  // Mode 3. I+ ii III IV ♭vi° vi vii°
  ionianSharp5: { two: [[0, 2], [0, 5]], four: [[0, 5, 2, 0], [0, 3, 2, 0], [0, 5, 3, 2]] },
  // Mode 4 (Ukrainian Dorian). i II ♭III ♭v° v vi° ♭VII+
  dorianSharp4: { two: [[0, 1], [0, 3]], four: [[0, 1, 4, 0], [0, 2, 1, 0], [0, 3, 1, 0], [0, 1, 6, 1]] },
  // Mode 6. I ♭iii° iii ♭v° V+ vi VII
  lydianSharp2: { two: [[0, 1], [0, 6]], four: [[0, 6, 5, 0], [0, 1, 6, 0], [0, 5, 4, 1]] },
  // Mode 7. i° ♭ii ♭iii° III+ ♭v ♭VI VI
  ultralocrian: { two: [[0, 1], [0, 5]], four: [[0, 5, 1, 0], [0, 1, 6, 0], [0, 3, 1, 0], [0, 6, 5, 1]] },
  // diminished triads; degrees 0/2/4/6 are the minor-third axis
  diminished: { two: [[0, 2], [0, 4]], four: [[0, 2, 4, 2], [0, 6, 4, 2], [0, 4, 2, 6]] },
  // minor triads; ♭II and tritone moves
  chromatic: { two: [[0, 1], [0, 6]], four: [[0, 1, 6, 0], [0, 8, 1, 0], [0, 3, 6, 1], [0, 6, 5, 1]] },
};

/** How many chords per half of the riff (the progression repeats in A′). */
export function chordsPerHalf(bars: Bars, profile: ComplexityProfile, rng: Rng): 2 | 4 {
  if (bars === 1 || profile.maxChordsPerHalf === 2) return 2;
  if (bars === 4 || bars === 8) return 4; // 8 bars: one chord per bar
  return profile.fourChordChance > 0 && rng.chance(profile.fourChordChance) ? 4 : 2;
}

/** Auto's odds for the chord-changes option (Simple keeps it plainer). */
const AUTO_CHANGES: Record<'simple' | 'other', [ChordChanges, number][]> = {
  simple: [['steady', 50], ['longer', 25], ['repeat', 25]],
  other: [['steady', 40], ['longer', 30], ['repeat', 30]],
};

/**
 * Resolve "Auto" for chord changes. It uses its own random stream derived from the seed, so the
 * riff's main stream is untouched: when Auto picks Steady, the riff is identical to an explicit Steady.
 */
export function autoChordChanges(seed: number, simple: boolean): ChordChanges {
  const own = new RngClass((seed ^ 0x9e3779b9) >>> 0);
  return own.weighted(AUTO_CHANGES[simple ? 'simple' : 'other'], ([, w]) => w)[0];
}

/** Lay chords (degree, length in steps) end to end from step 0. */
function lay(key: NoteName, scale: ScaleId, chords: [degree: number, length: number][]): ChordSlot[] {
  const slots: ChordSlot[] = [];
  let step = 0;
  for (const [degree, length] of chords) {
    slots.push({ ...chordOnDegree(key, scale, degree), step, length });
    step += length;
  }
  return slots;
}

/** Degree moved by `by` scale degrees (semitones for the Chromatic scale), wrapping around the scale. */
function shiftDegree(scale: ScaleId, degree: number, by: number): number {
  const n = scale === 'chromatic' ? 12 : SCALES[scale].intervals.length;
  return (degree + by) % n;
}

/**
 * Pick a progression and lay it over the whole riff:
 * - steady: equal lengths; the second half (A′) has the same chords as A;
 * - longer: three chords, one twice as long as the other two (where it sits varies);
 * - repeat: A′ has the same chord rhythm as A, moved to a different chord (Guitar 1 repeats its
 *   notes over it, with the pedal following the new chord).
 */
export function chooseProgression(
  key: NoteName,
  scale: ScaleId,
  bars: Bars,
  profile: ComplexityProfile,
  rng: Rng,
  changes: ChordChanges = 'steady',
): ChordSlot[] {
  const total = bars * 16;
  const half = total / 2;
  const { two, four } = PROGRESSIONS[scale];

  if (changes === 'longer') {
    const unit = total / 4;
    const lengths = rng.pick([[2, 1, 1], [1, 1, 2], [1, 2, 1]]);
    const degrees = rng.pick(four).slice(0, 3);
    return lay(key, scale, degrees.map((d, i) => [d, lengths[i]! * unit]));
  }

  if (changes === 'repeat') {
    // The move for A′ comes from the scale's idiomatic two-chord moves (i → ♭II, i → ♭VI, i → V …).
    const by = rng.pick(two)[1]!;
    const a: number[] = bars >= 4 ? rng.pick(two) : [0];
    const length = half / a.length;
    return lay(key, scale, [
      ...a.map((d): [number, number] => [d, length]),
      ...a.map((d): [number, number] => [shiftDegree(scale, d, by), length]),
    ]);
  }

  const count = chordsPerHalf(bars, profile, rng);
  const degrees = rng.pick(count === 4 ? four : two);
  const length = half / count;
  return lay(key, scale, [...degrees, ...degrees].map((d): [number, number] => [d, length]));
}

/** A flavour tone's kind; weights for picking one (7ths most, 11ths least). */
type FlavourKind = '7' | '9' | '11';
const FLAVOUR_WEIGHTS: Record<FlavourKind, number> = { '7': 3, '9': 2, '11': 1 };
/** Scale steps above the chord root for each kind (stacked thirds), and semitones for the Chromatic scale. */
const FLAVOUR_STEPS: Record<FlavourKind, number> = { '7': 6, '9': 1, '11': 3 };
const CHROMATIC_FLAVOURS: Record<FlavourKind, number> = { '7': 10, '9': 1, '11': 5 };

/** Name and Roman-numeral suffixes for a 7th (semitones above the root) on each triad quality. */
const SEVENTHS: Record<ChordQuality, Record<number, string>> = {
  minor: { 9: 'm6', 10: 'm7', 11: 'm(maj7)' },
  major: { 9: '6', 10: '7', 11: 'maj7' },
  diminished: { 9: '°7', 10: 'ø7', 11: '°(maj7)' },
  augmented: { 9: '+6', 10: '+7', 11: '+(maj7)' },
};
const ADDS: Record<number, string> = { 1: 'add♭9', 2: 'add9', 3: 'add♯9', 5: 'add11', 6: 'add♯11' };

/**
 * The flavour tones a chord can take in this scale: its 7th, 9th or 11th (stacked scale thirds),
 * skipping any that duplicate a chord tone or would blur the 3rd (a ♭11 is a major 3rd).
 */
export function flavourOptions(key: NoteName, scale: ScaleId, chord: Chord): { kind: FlavourKind; pc: number }[] {
  const keyPc = pitchClassOf(key);
  const out: { kind: FlavourKind; pc: number }[] = [];
  for (const kind of Object.keys(FLAVOUR_STEPS) as FlavourKind[]) {
    let tone: number;
    if (scale === 'chromatic') {
      tone = pc(chord.rootPc + CHROMATIC_FLAVOURS[kind]);
    } else {
      const iv = SCALES[scale].intervals;
      tone = pc(keyPc + iv[(chord.degree + FLAVOUR_STEPS[kind]) % iv.length]!);
    }
    const semis = pc(tone - chord.rootPc);
    if (chord.tones.includes(tone)) continue;
    const named = kind === '7' ? SEVENTHS[chord.quality][semis] : ADDS[semis];
    if (named) out.push({ kind, pc: tone });
  }
  return out;
}

/** The chord with a flavour tone added: "Em" → "Em7", "F" → "F(add♭9)"; "i" → "i7", "♭II" → "♭II(add♭9)". */
export function withFlavour<C extends Chord>(chord: C, flavourPc: number): C {
  const semis = pc(flavourPc - chord.rootPc);
  const seventh = SEVENTHS[chord.quality][semis];
  const isSeventh = seventh !== undefined && semis >= 9;
  const triadSuffix = chord.quality === 'diminished' ? '°' : chord.quality === 'augmented' ? '+' : '';
  const letter = NOTE_NAMES[chord.rootPc] as string;
  let name: string;
  let roman: string;
  if (isSeventh) {
    name = letter + seventh;
    // Roman numerals show minor by case, so a minor chord's suffix drops its "m".
    const bareRoman = triadSuffix ? chord.roman.slice(0, -triadSuffix.length) : chord.roman;
    roman = bareRoman + (chord.quality === 'minor' ? seventh.slice(1) : seventh);
  } else {
    name = `${chord.name}(${ADDS[semis]})`;
    roman = `${chord.roman}(${ADDS[semis]})`;
  }
  return { ...chord, flavour: flavourPc, name, roman };
}

/**
 * Give chords a flavour tone (Extreme): each scale degree, at its first appearance, gets one with
 * the given chance, and keeps it wherever it comes back, so repeats sound the same.
 * A chance of 0 draws no random numbers.
 */
export function addFlavours(slots: ChordSlot[], key: NoteName, scale: ScaleId, chance: number, rng: Rng): ChordSlot[] {
  if (chance <= 0) return slots;
  const chosen = new Map<number, number | null>();
  return slots.map((slot) => {
    if (!chosen.has(slot.degree)) {
      const options = flavourOptions(key, scale, slot);
      chosen.set(
        slot.degree,
        options.length > 0 && rng.chance(chance) ? rng.weighted(options, (o) => FLAVOUR_WEIGHTS[o.kind]).pc : null,
      );
    }
    const flavour = chosen.get(slot.degree);
    return flavour === null || flavour === undefined ? slot : withFlavour(slot, flavour);
  });
}

export function chordAt(slots: ChordSlot[], step: number): ChordSlot {
  return slots.find((s) => step >= s.step && step < s.step + s.length) ?? (slots.at(-1) as ChordSlot);
}

/**
 * The progression as Roman numerals. When both halves have the same chords, one half is shown
 * ("i – ♭VI"); otherwise the whole riff, with "|" where A′ starts on a new chord ("i | ♭II").
 */
export function romanProgression(slots: ChordSlot[]): string {
  const total = slots.reduce((sum, s) => sum + s.length, 0);
  const half = total / 2;
  const firstHalf = slots.filter((s) => s.step < half);
  const secondHalf = slots.filter((s) => s.step >= half);
  const sameHalves =
    firstHalf.length === secondHalf.length &&
    firstHalf.every((s, i) => s.roman === secondHalf[i]!.roman && s.step + half === secondHalf[i]!.step);
  if (sameHalves) return firstHalf.map((s) => s.roman).join(' – ');
  return slots.map((s, i) => (i > 0 && s.step === half ? `| ${s.roman}` : s.roman)).join(' – ').replace(/ – \| /g, ' | ');
}
