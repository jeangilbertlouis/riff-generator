import type { Archetype } from './types.ts';

/**
 * What pitch a hit takes:
 * - root:  the pedal tone (open low string)
 * - move:  a new scale note picked by the melody rules
 * - hold:  same pitch as the previous hit (tremolo)
 * - chrom: one semitone from the previous hit (chromatic run, passing tone)
 */
export type PitchRole = 'root' | 'move' | 'hold' | 'chrom';

export type Hit = {
  offset: number;
  duration: number;
  role: PitchRole;
  palmMute: boolean;
  accent: boolean;
};

export type Cell = {
  id: string;
  /** Length in 16th steps: 4 (one beat) or 8 (two beats). */
  length: 4 | 8;
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
};

type Weighted = [cellId: string, weight: number];

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
