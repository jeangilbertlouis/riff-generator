import type { Archetype } from './types.ts';

/**
 * What pitch a hit takes:
 * - root:  the pedal: the current chord's root in the low register
 * - move:  a new scale note picked by the melody rules (favouring the current chord's tones)
 * - hold:  same pitch as the previous hit (tremolo)
 * - chrom: a run step: the next scale note in the run's direction (or the next semitone,
 *          a chromatic passing tone, when chromatic passing is switched on)
 * - back:  the pitch from two hits ago (trills: A B A B)
 * - arp:   chord tone number `tone` above the arpeggio's base (0 = root, 1 = 3rd, 2 = 5th,
 *          3 = octave …; negative goes below). The base is set by the first arp hit in a row.
 * - high:  a chord tone from the upper part of the range (string skipping against the pedal)
 */
export type PitchRole = 'root' | 'move' | 'hold' | 'chrom' | 'back' | 'arp' | 'high';

export type Hit = {
  offset: number;
  duration: number;
  role: PitchRole;
  palmMute: boolean;
  accent: boolean;
  /** Chord tone index for `arp` hits. */
  tone?: number;
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

/** An arpeggio hit: chord tone `tone` (0 root, 1 third, 2 fifth, 3 octave …). */
const a = (offset: number, duration: number, tone: number, accent = false, palmMute = false): Hit => ({
  offset,
  duration,
  role: 'arp',
  palmMute,
  accent,
  tone,
});

/** 16th-note arpeggio over the given chord tones, accent on the first. */
function arp16(id: string, tones: number[]): Cell {
  return { id, length: tones.length, hits: tones.map((t, i) => a(i, 1, t, i === 0)) };
}

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
  // Arpeggios over the current chord
  arpeggio: arp16('arpeggio', [0, 1, 2, 1]), // 1-3-5-3
  arpUp: arp16('arpUp', [0, 1, 2, 3]),
  arpDown: arp16('arpDown', [3, 2, 1, 0]),
  arpBroken: arp16('arpBroken', [0, 2, 1, 2]), // 1-5-3-5
  arpRoll: arp16('arpRoll', [0, 1, 2, 3, 4, 3, 2, 1]), // up-and-down sweep
  tremArp: { id: 'tremArp', length: 8, hits: [0, 0, 1, 1, 2, 2, 1, 1].map((t, i) => a(i, 1, t, i % 2 === 0)) },
  tremArpBeat: { id: 'tremArpBeat', length: 8, hits: [0, 0, 0, 0, 2, 2, 2, 2].map((t, i) => a(i, 1, t, i % 4 === 0)) },
  pedalArp: {
    id: 'pedalArp',
    length: 8,
    hits: [h(0, 1, 'root', true, true), a(1, 1, 1, true), h(2, 1, 'root', true), a(3, 1, 2, true),
      h(4, 1, 'root', true), a(5, 1, 3, true), h(6, 1, 'root', true), a(7, 1, 2)],
  },
  ringArp: { id: 'ringArp', length: 8, hits: [a(0, 2, 0, true), a(2, 2, 1), a(4, 4, 2, true)] },
  g3Arp: arp16('g3Arp', [0, 1, 2]),
  g5Arp: arp16('g5Arp', [0, 1, 2, 3, 2]),
  g6Arp: arp16('g6Arp', [0, 1, 2, 3, 2, 1]),
  // Extreme only: wide shapes. With a 4-note chord (a flavour tone), tone 3 is the flavour and 4 the octave.
  arpSweep: arp16('arpSweep', [0, 1, 2, 3, 4, 5, 6, 7]), // two-octave sweep up
  arpSweepDown: arp16('arpSweepDown', [7, 6, 5, 4, 3, 2, 1, 0]),
  arpSkip: arp16('arpSkip', [0, 2, 1, 3, 2, 4, 3, 1]), // broken thirds: skips every other chord tone
  arpTopPedal: arp16('arpTopPedal', [4, 0, 4, 1, 4, 2, 4, 3]), // pedal on the top note, the chord climbing under it
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
    3: [['g3Trem', 4], ['g3Arp', 3], ['g3Stab', 1]],
    5: [['g5Trem', 3], ['g5Arp', 2], ['g5Stab', 1]],
    6: [['g6Trem', 4], ['g6Arp', 3], ['g6Gallop', 1]],
  },
  gallop: {
    2: [['g2Chug', 3], ['g2Stab', 1]],
    3: [['g3Gallop', 4], ['g3Arp', 2], ['g3Chug', 2], ['g3Stab', 1]],
    5: [['g5Chug', 3], ['g5Arp', 2], ['g5Stab', 2]],
    6: [['g6Gallop', 3], ['g6Arp', 2], ['g6Dotted', 2]],
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
  tremolo: [
    ['tremoloBeat', 4], ['tremoloHalf', 3], ['tremoloLong', 2], ['tremoloRoot', 2], ['chromRun', 1],
    ['tremArp', 4], ['tremArpBeat', 3], ['arpUp', 2], ['arpDown', 1],
  ],
  gallop: [
    ['gallop', 5], ['gallopReverse', 2], ['gallopMove', 4], ['pedal', 2], ['pedalLong', 2], ['chromRun', 1],
    ['pedalArp', 4], ['arpUp', 2], ['arpDown', 1],
  ],
  chug: [
    ['chug8ths', 3], ['chug16ths', 3], ['chugSync', 4], ['chugDotted', 3], ['stab', 2], ['pedal', 2], ['chromRun', 1],
    ['pedalArp', 3], ['arpUp', 1],
  ],
  breakdown: [['breakdownA', 4], ['breakdownB', 3], ['breakdownC', 3], ['ring', 1], ['chugSync', 2], ['rest', 1], ['ringArp', 3]],
};

/** Archetype weights by tempo: fast songs lean on tremolo, slow ones on breakdowns. */
export function archetypeWeights(bpm: number): Record<Archetype, number> {
  if (bpm >= 200) return { tremolo: 6, gallop: 3, chug: 1, breakdown: 0 };
  if (bpm >= 150) return { tremolo: 3, gallop: 4, chug: 3, breakdown: 1 };
  if (bpm >= 110) return { tremolo: 1, gallop: 2, chug: 4, breakdown: 3 };
  return { tremolo: 1, gallop: 1, chug: 3, breakdown: 5 };
}
