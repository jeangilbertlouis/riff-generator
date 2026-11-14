import type { Archetype } from './types.ts';

/**
 * What pitch a hit takes:
 * - root:  the pedal tone (open low string)
 * - move:  a new scale note picked by the melody rules
 * - hold:  same pitch as the previous hit (tremolo)
 * - chrom: one semitone from the previous hit (chromatic run, passing tone)
 * - back:  the pitch from two hits ago (trills: A B A B)
 * - leap:  a scale note at least a minor 3rd away, alternating direction (broken arpeggio)
 * - high:  a scale note from the upper part of the range (string skipping against the pedal)
 */
export type PitchRole = 'root' | 'move' | 'hold' | 'chrom' | 'back' | 'leap' | 'high';

export type Hit = {
  offset: number;
  duration: number;
  role: PitchRole;
  palmMute: boolean;
  accent: boolean;
};

export type Cell = {
  id: string;
  /** Length in 16th steps: 4 (one beat) or 8 (two beats); 2, 3, 5 and 6 for odd groupings. */
  length: number;
  hits: Hit[];
};

const h = (offset: number, duration: number, role: PitchRole, palmMute = false, accent = false): Hit => ({
  offset,
  duration,
  role,
  palmMute,
  accent,
});

/** Builds steady 16ths: one pitch role per group of `group` notes, the rest held. */
function tremolo(id: string, length: 4 | 8, group: number): Cell {
  const hits: Hit[] = [];
  for (let i = 0; i < length; i++) {
    hits.push(h(i, 1, i % group === 0 ? 'move' : 'hold', false, i === 0));
  }
  return { id, length, hits };
}

export const CELLS: Record<string, Cell> = {
  // Tremolo picking
  tremoloBeat: tremolo('tremoloBeat', 4, 4),
  tremoloHalf: tremolo('tremoloHalf', 4, 2),
  tremoloLong: tremolo('tremoloLong', 8, 8),
  tremoloRoot: {
    id: 'tremoloRoot',
    length: 4,
    hits: [0, 1, 2, 3].map((i) => h(i, 1, i === 0 ? 'root' : 'hold', true, i === 0)),
  },

  // Gallops
  gallop: { id: 'gallop', length: 4, hits: [h(0, 2, 'root', true, true), h(2, 1, 'root', true), h(3, 1, 'root', true)] },
  gallopReverse: { id: 'gallopReverse', length: 4, hits: [h(0, 1, 'root', true, true), h(1, 1, 'root', true), h(2, 2, 'root', true)] },
  gallopMove: { id: 'gallopMove', length: 4, hits: [h(0, 2, 'move', false, true), h(2, 1, 'root', true), h(3, 1, 'root', true)] },

  // Pedal point
  pedal: { id: 'pedal', length: 4, hits: [h(0, 1, 'root', true), h(1, 1, 'move', false, true), h(2, 1, 'root', true), h(3, 1, 'move', false, true)] },
  pedalLong: {
    id: 'pedalLong',
    length: 8,
    hits: [h(0, 1, 'root', true), h(1, 1, 'root', true), h(2, 1, 'move', false, true), h(3, 1, 'root', true),
      h(4, 1, 'root', true), h(5, 1, 'move', false, true), h(6, 1, 'root', true), h(7, 1, 'move', false, true)],
  },

  // Chugs
  chug8ths: { id: 'chug8ths', length: 4, hits: [h(0, 2, 'root', true, true), h(2, 2, 'root', true)] },
  chug16ths: { id: 'chug16ths', length: 4, hits: [0, 1, 2, 3].map((i) => h(i, 1, 'root', true, i === 0)) },
  chugSync: { id: 'chugSync', length: 4, hits: [h(0, 1, 'root', true, true), h(3, 1, 'root', true, true)] },
  chugDotted: { id: 'chugDotted', length: 8, hits: [h(0, 2, 'root', true, true), h(3, 2, 'root', true, true), h(6, 2, 'root', true, true)] },
  stab: { id: 'stab', length: 4, hits: [h(0, 2, 'move', false, true)] },

  // Breakdown (half-time feel, lots of space)
  breakdownA: { id: 'breakdownA', length: 8, hits: [h(0, 2, 'root', true, true), h(3, 1, 'root', true), h(6, 1, 'root', true, true)] },
  breakdownB: { id: 'breakdownB', length: 8, hits: [h(0, 1, 'root', true, true), h(1, 1, 'root', true), h(4, 3, 'move', false, true)] },
  breakdownC: { id: 'breakdownC', length: 8, hits: [h(0, 3, 'root', true, true), h(5, 1, 'root', true, true)] },
  ring: { id: 'ring', length: 8, hits: [h(0, 6, 'move', false, true)] },
  rest: { id: 'rest', length: 4, hits: [] },

  // Chromatic run
  chromRun: { id: 'chromRun', length: 4, hits: [h(0, 1, 'move', false, true), h(1, 1, 'chrom'), h(2, 1, 'chrom'), h(3, 1, 'chrom')] },

  // Techniques (Complex / Extreme only)
  chromRun8: {
    id: 'chromRun8',
    length: 8,
    hits: [h(0, 1, 'move', false, true), ...[1, 2, 3, 4, 5, 6, 7].map((i) => h(i, 1, 'chrom', false, i === 4))],
  },
  trill: { id: 'trill', length: 4, hits: [h(0, 1, 'move', false, true), h(1, 1, 'move'), h(2, 1, 'back'), h(3, 1, 'back')] },
  arpeggio: { id: 'arpeggio', length: 4, hits: [h(0, 1, 'move', false, true), h(1, 1, 'leap'), h(2, 1, 'leap'), h(3, 1, 'leap')] },
  stringSkip: {
    id: 'stringSkip',
    length: 4,
    hits: [h(0, 1, 'root', true, true), h(1, 1, 'high', false, true), h(2, 1, 'root', true), h(3, 1, 'high', false, true)],
  },

  // Odd-length groups for displaced phrasing; every group starts accented.
  g2Chug: { id: 'g2Chug', length: 2, hits: [h(0, 1, 'root', true, true), h(1, 1, 'root', true)] },
  g2Stab: { id: 'g2Stab', length: 2, hits: [h(0, 2, 'move', false, true)] },
  g2Trem: { id: 'g2Trem', length: 2, hits: [h(0, 1, 'move', false, true), h(1, 1, 'hold')] },
  g3Gallop: { id: 'g3Gallop', length: 3, hits: [h(0, 1, 'root', true, true), h(1, 1, 'root', true), h(2, 1, 'move', false, true)] },
  g3Chug: { id: 'g3Chug', length: 3, hits: [h(0, 2, 'root', true, true), h(2, 1, 'root', true)] },
  g3Stab: { id: 'g3Stab', length: 3, hits: [h(0, 3, 'move', false, true)] },
  g3Trem: { id: 'g3Trem', length: 3, hits: [h(0, 1, 'move', false, true), h(1, 1, 'hold'), h(2, 1, 'hold')] },
  g5Chug: {
    id: 'g5Chug',
    length: 5,
    hits: [h(0, 1, 'root', true, true), h(1, 1, 'root', true), h(2, 1, 'move', false, true), h(3, 1, 'root', true), h(4, 1, 'root', true)],
  },
  g5Stab: { id: 'g5Stab', length: 5, hits: [h(0, 2, 'move', false, true), h(2, 1, 'root', true), h(3, 2, 'root', true)] },
  g5Trem: { id: 'g5Trem', length: 5, hits: [0, 1, 2, 3, 4].map((i) => h(i, 1, i === 0 || i === 3 ? 'move' : 'hold', false, i === 0)) },
  g6Dotted: { id: 'g6Dotted', length: 6, hits: [h(0, 2, 'root', true, true), h(3, 2, 'root', true, true)] },
  g6Gallop: {
    id: 'g6Gallop',
    length: 6,
    hits: [h(0, 2, 'root', true, true), h(2, 1, 'root', true), h(3, 2, 'move', false, true), h(5, 1, 'root', true)],
  },
  g6Trem: { id: 'g6Trem', length: 6, hits: [0, 1, 2, 3, 4, 5].map((i) => h(i, 1, i % 3 === 0 ? 'move' : 'hold', false, i % 3 === 0)) },
};

/** Cells for each odd group length, per style (tremolo riffs group tremolo notes; others group chugs). */
export const GROUP_CELLS: Record<Archetype, Record<2 | 3 | 5 | 6, Weighted[]>> = {
  tremolo: {
    2: [['g2Trem', 3], ['g2Stab', 1]],
    3: [['g3Trem', 4], ['g3Stab', 1]],
    5: [['g5Trem', 3], ['g5Stab', 1]],
    6: [['g6Trem', 4], ['g6Gallop', 1]],
  },
  gallop: {
    2: [['g2Chug', 3], ['g2Stab', 1]],
    3: [['g3Gallop', 4], ['g3Chug', 2], ['g3Stab', 1]],
    5: [['g5Chug', 3], ['g5Stab', 2]],
    6: [['g6Gallop', 3], ['g6Dotted', 2]],
  },
  chug: {
    2: [['g2Chug', 3], ['g2Stab', 1]],
    3: [['g3Chug', 4], ['g3Gallop', 2], ['g3Stab', 2]],
    5: [['g5Chug', 3], ['g5Stab', 2]],
    6: [['g6Dotted', 3], ['g6Gallop', 2]],
  },
  breakdown: {
    2: [['g2Chug', 2], ['g2Stab', 2]],
    3: [['g3Chug', 4], ['g3Stab', 3]],
    5: [['g5Stab', 3], ['g5Chug', 1]],
    6: [['g6Dotted', 4], ['g6Gallop', 1]],
  },
};

export type Weighted = [cellId: string, weight: number];

/** Which cells each archetype uses, with relative weights. Each pool has 4-step cells. */
export const ARCHETYPE_CELLS: Record<Archetype, Weighted[]> = {
  tremolo: [['tremoloBeat', 5], ['tremoloHalf', 4], ['tremoloLong', 3], ['tremoloRoot', 2], ['chromRun', 1]],
  gallop: [['gallop', 5], ['gallopReverse', 2], ['gallopMove', 4], ['pedal', 3], ['pedalLong', 2], ['chromRun', 1]],
  chug: [['chug8ths', 3], ['chug16ths', 3], ['chugSync', 4], ['chugDotted', 3], ['stab', 3], ['pedal', 2], ['chromRun', 1]],
  breakdown: [['breakdownA', 4], ['breakdownB', 3], ['breakdownC', 3], ['ring', 2], ['chugSync', 2], ['rest', 1]],
};

/** Archetype weights by tempo: fast songs lean on tremolo, slow ones on breakdowns. */
export function archetypeWeights(bpm: number): Record<Archetype, number> {
  if (bpm >= 200) return { tremolo: 6, gallop: 3, chug: 1, breakdown: 0 };
  if (bpm >= 150) return { tremolo: 3, gallop: 4, chug: 3, breakdown: 1 };
  if (bpm >= 110) return { tremolo: 1, gallop: 2, chug: 4, breakdown: 3 };
  return { tremolo: 1, gallop: 1, chug: 3, breakdown: 5 };
}
