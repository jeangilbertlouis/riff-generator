import { pc, pitchClassOf } from './theory.ts';
import { TUNING_IDS, type NoteName, type Tuning, type TuningId } from './types.ts';

export { TUNING_IDS, type TuningId };

export const MAX_FRET = 22;

// Open strings listed high → low (string 1 first).
const E_STANDARD = [64, 59, 55, 50, 45, 40];
const shift = (strings: number[], semis: number) => strings.map((s) => s + semis);
const drop = (strings: number[]) => [...strings.slice(0, -1), (strings.at(-1) as number) - 2];
const SEVEN_B_STANDARD = [...E_STANDARD, 35];

/** The tunings you can pick (independent of the key). */
export const TUNINGS: Record<TuningId, { name: string; openStrings: number[] }> = {
  eStandard: { name: 'E standard', openStrings: E_STANDARD },
  ebStandard: { name: 'Eb standard', openStrings: shift(E_STANDARD, -1) },
  dStandard: { name: 'D standard', openStrings: shift(E_STANDARD, -2) },
  dropD: { name: 'Drop D', openStrings: drop(E_STANDARD) },
  csStandard: { name: 'C# standard', openStrings: shift(E_STANDARD, -3) },
  dropCs: { name: 'Drop C#', openStrings: drop(shift(E_STANDARD, -1)) },
  cStandard: { name: 'C standard', openStrings: shift(E_STANDARD, -4) },
  dropC: { name: 'Drop C', openStrings: drop(shift(E_STANDARD, -2)) },
  bStandard: { name: 'B standard', openStrings: shift(E_STANDARD, -5) },
  dropB: { name: 'Drop B', openStrings: drop(shift(E_STANDARD, -3)) },
  dropA: { name: 'Drop A', openStrings: drop(shift(E_STANDARD, -5)) },
  bStandard7: { name: 'B standard (7-string)', openStrings: SEVEN_B_STANDARD },
  bbStandard7: { name: 'Bb standard (7-string)', openStrings: shift(SEVEN_B_STANDARD, -1) },
  aStandard7: { name: 'A standard (7-string)', openStrings: shift(SEVEN_B_STANDARD, -2) },
  dropA7: { name: 'Drop A (7-string)', openStrings: drop(SEVEN_B_STANDARD) },
};

/**
 * "Auto": the tuning follows the key, with the root on the open lowest string where an
 * idiomatic tuning exists. F–G# stay in E standard with the root fretted on the low string.
 */
const AUTO: Record<NoteName, TuningId> = {
  E: 'eStandard',
  'D#': 'ebStandard',
  D: 'dropD',
  'C#': 'csStandard',
  C: 'dropC',
  B: 'bStandard7',
  'A#': 'bbStandard7',
  A: 'dropA7',
  F: 'eStandard',
  'F#': 'eStandard',
  G: 'eStandard',
  'G#': 'eStandard',
};

/** A tuning for a key: the chosen one, or the key's Auto tuning. The root is placed per `rootFretFor`. */
export function tuningFor(key: NoteName, choice: TuningId | 'auto' = 'auto'): Tuning {
  const id = choice === 'auto' ? AUTO[key] : choice;
  const t = TUNINGS[id];
  return { id, name: t.name, openStrings: [...t.openStrings], rootFret: rootFretFor(t.openStrings, key) };
}

/** The key's Auto tuning (kept for callers that only know the key). */
export function tuningForKey(key: NoteName): Tuning {
  return tuningFor(key, 'auto');
}

/** Fret of the key's root on the lowest string: the lowest root at or above the open string (0–11). */
export function rootFretFor(openStrings: number[], key: NoteName): number {
  return pc(pitchClassOf(key) - (openStrings.at(-1) as number));
}

export function lowestString(t: Tuning): number {
  return t.openStrings.at(-1) as number;
}

/** MIDI pitch of the riff's root: the lowest root note on the guitar. */
export function rootMidi(t: Tuning, key: NoteName): number {
  const root = lowestString(t) + t.rootFret;
  if (pc(root) !== pitchClassOf(key)) throw new Error(`Tuning ${t.name} does not match key ${key}`);
  return root;
}

export function highestPlayable(t: Tuning): number {
  return (t.openStrings[0] as number) + MAX_FRET;
}

export type TabPosition = { string: number; fret: number };

export function positionsFor(midi: number, t: Tuning): TabPosition[] {
  const out: TabPosition[] = [];
  t.openStrings.forEach((open, i) => {
    const fret = midi - open;
    if (fret >= 0 && fret <= MAX_FRET) out.push({ string: i + 1, fret });
  });
  return out;
}

/** Fingering costs (readme §6.7). The zone between `zoneLow` and `zoneHigh` is free; everything else costs. */
export const FINGERING = {
  openString: 2.5,
  /** Frets below the zone cost this much per fret of distance from it (fret 1 → 2.0, fret 4 → 0.5). */
  belowZonePerFret: 0.5,
  zoneLow: 5,
  zoneHigh: 12,
  aboveZonePerFret: 0.5,
  /** Frets above this cost an extra 1 per fret. */
  veryHigh: 17,
  /** A reach within this many frets doesn't count as a position shift. */
  stretch: 3,
  stretchPerFret: 0.3,
  shiftBase: 1,
  shiftPerFret: 0.8,
  stringChange: 0.3,
} as const;

/** How much we'd rather not play a note at this fret, regardless of context. */
export function fretCost(fret: number): number {
  const f = FINGERING;
  if (fret === 0) return f.openString;
  if (fret < f.zoneLow) return (f.zoneLow - fret) * f.belowZonePerFret;
  if (fret <= f.zoneHigh) return 0;
  return (fret - f.zoneHigh) * f.aboveZonePerFret + Math.max(0, fret - f.veryHigh);
}

/** Cost of moving the fretting hand from `hand` (null = not placed yet) to `fret`. */
export function handMoveCost(hand: number | null, fret: number): number {
  if (hand === null) return 0;
  const d = Math.abs(fret - hand);
  const f = FINGERING;
  return d <= f.stretch ? d * f.stretchPerFret : f.shiftBase + d * f.shiftPerFret;
}

type FingerState = {
  pos: TabPosition;
  /** Fret the hand is at: open strings don't move it, so it carries over from the last fretted note. */
  hand: number | null;
  cost: number;
  /** Index of the best previous state (for backtracking). */
  back: number;
};

/**
 * Give each note a (string, fret), choosing the fingering for the whole part at once
 * (a Viterbi search): prefer frets 5–12 over open strings and the first frets, keep the
 * hand in one area, and stay on nearby strings. The search state is (position, hand
 * fret), so an open-string pedal between fretted notes doesn't reset the hand.
 */
export function assignTabPositions<T extends { midi: number }>(notes: T[], t: Tuning): (T & TabPosition)[] {
  if (notes.length === 0) return [];
  const layers: FingerState[][] = [];

  notes.forEach((note, i) => {
    const options = positionsFor(note.midi, t);
    if (options.length === 0) throw new Error(`MIDI ${note.midi} is not playable in ${t.name}`);

    if (i === 0) {
      layers.push(options.map((pos) => ({ pos, hand: pos.fret > 0 ? pos.fret : null, cost: fretCost(pos.fret), back: -1 })));
      return;
    }

    const prev = layers[i - 1] as FingerState[];
    const best = new Map<string, FingerState>();
    for (const pos of options) {
      prev.forEach((p, j) => {
        const hand = pos.fret > 0 ? pos.fret : p.hand;
        const cost =
          p.cost +
          fretCost(pos.fret) +
          Math.abs(pos.string - p.pos.string) * FINGERING.stringChange +
          (pos.fret > 0 ? handMoveCost(p.hand, pos.fret) : 0);
        const key = `${pos.string}:${hand ?? '-'}`;
        const existing = best.get(key);
        if (!existing || cost < existing.cost) best.set(key, { pos, hand, cost, back: j });
      });
    }
    layers.push([...best.values()]);
  });

  // Backtrack from the cheapest final state.
  const last = layers.at(-1) as FingerState[];
  let index = last.reduce((bi, s, si) => (s.cost < (last[bi] as FingerState).cost ? si : bi), 0);
  const chosen: TabPosition[] = new Array(notes.length);
  for (let i = notes.length - 1; i >= 0; i--) {
    const state = (layers[i] as FingerState[])[index] as FingerState;
    chosen[i] = state.pos;
    index = state.back;
  }
  return notes.map((note, i) => ({ ...note, ...(chosen[i] as TabPosition) }));
}
