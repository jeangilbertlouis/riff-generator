import type { Weighted } from './rhythm.ts';
import type { Archetype, Bars, Complexity } from './types.ts';

export type CounterRhythm = 'sustain' | 'halves' | 'tremolo' | 'eighths' | 'threeThreeTwo';

/**
 * Everything the complexity level changes. Values of "no effect" (0, 1, empty) must not
 * consume randomness, so Normal draws exactly the same random numbers as the original engine.
 */
export type ComplexityProfile = {
  /** Highest Guitar 1 note, in semitones above the root. */
  range: number;
  /** Weight multiplier for melodic leaps wider than a major 3rd. */
  leapBoost: number;
  /** Extra weight multiplier for the ♭2 and the tritone. */
  dissonanceBoost: number;
  /** Weight multiplier for notes above the octave (lower = stay low and heavy). */
  highRegister: number;
  /** Chance a melodic note returns to the pedal root instead (more pedal tone). */
  rootStay: number;
  /** Cells removed from every pool. */
  removeCells: readonly string[];
  /** Cells added to each archetype's pool. */
  extraCells: Partial<Record<Archetype, readonly Weighted[]>>;
  /** Chance, per fill decision with ≥ 8 steps left, to split a span (8, 12 or 16 steps) into odd groupings. */
  groupingChance: number;
  /** Chance each segment (head, tail, variation) switches to a different style. */
  styleSwitchChance: number;
  /** Steps of A′ that are new material (the rest repeats A). */
  variation: (bars: Bars) => number;
  /** Guitar 2 harmony picks its interval per beat instead of staying parallel. */
  harmonyVaries: boolean;
  /** Rhythms the counter-melody can use (Normal keeps the original three, in order). */
  counterRhythms: readonly CounterRhythm[];
};

const ORIGINAL_VARIATION = (bars: Bars) => (bars === 1 ? 4 : 8);
const ORIGINAL_COUNTER: readonly CounterRhythm[] = ['sustain', 'halves', 'tremolo'];

/** Technique cells for Complex and Extreme, flavored per style. */
const TECH_CELLS: Record<Archetype, readonly Weighted[]> = {
  tremolo: [['trill', 3], ['arpeggio', 3], ['chromRun8', 2], ['tremoloHalf', 2]],
  gallop: [['stringSkip', 3], ['arpeggio', 2], ['trill', 1], ['chromRun8', 1]],
  chug: [['stringSkip', 3], ['trill', 1], ['arpeggio', 1], ['chromRun', 1]],
  breakdown: [['stringSkip', 2], ['arpeggio', 1], ['chromRun', 1]],
};

const EXTREME_CELLS: Record<Archetype, readonly Weighted[]> = {
  tremolo: [['trill', 4], ['arpeggio', 4], ['chromRun8', 3], ['tremoloHalf', 3]],
  gallop: [['stringSkip', 4], ['arpeggio', 3], ['trill', 2], ['chromRun8', 2]],
  chug: [['stringSkip', 4], ['trill', 2], ['arpeggio', 2], ['chromRun8', 1]],
  breakdown: [['stringSkip', 3], ['arpeggio', 2], ['trill', 1], ['chromRun', 1]],
};

export const PROFILES: Record<Complexity, ComplexityProfile> = {
  simple: {
    range: 12,
    leapBoost: 0.4,
    dissonanceBoost: 1,
    highRegister: 0.6,
    rootStay: 0.3,
    removeCells: ['chromRun', 'chugDotted', 'gallopReverse'],
    extraCells: {},
    groupingChance: 0,
    styleSwitchChance: 0,
    variation: ORIGINAL_VARIATION,
    harmonyVaries: false,
    counterRhythms: ['sustain', 'halves'],
  },
  normal: {
    range: 19,
    leapBoost: 1,
    dissonanceBoost: 1,
    highRegister: 0.6,
    rootStay: 0,
    removeCells: [],
    extraCells: {},
    groupingChance: 0,
    styleSwitchChance: 0,
    variation: ORIGINAL_VARIATION,
    harmonyVaries: false,
    counterRhythms: ORIGINAL_COUNTER,
  },
  complex: {
    range: 22,
    leapBoost: 1.6,
    dissonanceBoost: 1.5,
    highRegister: 0.85,
    rootStay: 0,
    removeCells: [],
    extraCells: TECH_CELLS,
    groupingChance: 0.45,
    styleSwitchChance: 0.35,
    variation: (bars) => (bars === 4 ? 16 : ORIGINAL_VARIATION(bars)),
    harmonyVaries: true,
    counterRhythms: [...ORIGINAL_COUNTER, 'eighths', 'threeThreeTwo'],
  },
  extreme: {
    range: 24,
    leapBoost: 2.2,
    dissonanceBoost: 2,
    highRegister: 1,
    rootStay: 0,
    removeCells: [],
    extraCells: EXTREME_CELLS,
    groupingChance: 0.85,
    styleSwitchChance: 0.6,
    // Only the opening beat of A repeats in A′.
    variation: (bars) => (bars === 1 ? 4 : (bars * 16) / 2 - 4),
    harmonyVaries: true,
    counterRhythms: ['halves', 'tremolo', 'eighths', 'threeThreeTwo'],
  },
};

/**
 * Odd groupings: ways to split 8 or 16 steps so accents fall off the beat (the riff stays in 4/4).
 * 4s use the style's normal one-beat cells; other lengths use GROUP_CELLS.
 */
export const GROUPINGS: Record<8 | 12 | 16, readonly (readonly number[])[]> = {
  8: [[3, 3, 2], [3, 5], [5, 3], [2, 3, 3], [3, 2, 3]],
  12: [[3, 3, 3, 3], [5, 5, 2], [6, 6], [3, 3, 2, 4]],
  16: [[3, 3, 3, 3, 4], [3, 3, 2, 3, 3, 2], [5, 5, 6], [6, 6, 4], [3, 3, 3, 3, 2, 2], [5, 5, 3, 3]],
};
