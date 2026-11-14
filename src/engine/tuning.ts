import { pc, pitchClassOf } from './theory.ts';
import type { NoteName, Tuning } from './types.ts';

export const MAX_FRET = 22;

// Open strings listed high → low (string 1 first).
const E_STANDARD = [64, 59, 55, 50, 45, 40];
const shift = (strings: number[], semis: number) => strings.map((s) => s + semis);
const drop = (strings: number[]) => [...strings.slice(0, -1), (strings.at(-1) as number) - 2];
const SEVEN_B_STANDARD = [...E_STANDARD, 35];

/**
 * Tuning follows the key: the root is the open lowest string where an idiomatic
 * tuning exists. F–G# stay in E standard with the root fretted on the low string.
 */
const TUNINGS: Record<NoteName, Tuning> = {
  E: { name: 'E standard', openStrings: E_STANDARD, rootFret: 0 },
  'D#': { name: 'Eb standard', openStrings: shift(E_STANDARD, -1), rootFret: 0 },
  D: { name: 'Drop D', openStrings: drop(E_STANDARD), rootFret: 0 },
  'C#': { name: 'C# standard', openStrings: shift(E_STANDARD, -3), rootFret: 0 },
  C: { name: 'Drop C', openStrings: drop(shift(E_STANDARD, -2)), rootFret: 0 },
  B: { name: 'B standard (7-string)', openStrings: SEVEN_B_STANDARD, rootFret: 0 },
  'A#': { name: 'Bb standard (7-string)', openStrings: shift(SEVEN_B_STANDARD, -1), rootFret: 0 },
  A: { name: 'Drop A (7-string)', openStrings: drop(SEVEN_B_STANDARD), rootFret: 0 },
  F: { name: 'E standard', openStrings: E_STANDARD, rootFret: 1 },
  'F#': { name: 'E standard', openStrings: E_STANDARD, rootFret: 2 },
  G: { name: 'E standard', openStrings: E_STANDARD, rootFret: 3 },
  'G#': { name: 'E standard', openStrings: E_STANDARD, rootFret: 4 },
};

export function tuningForKey(key: NoteName): Tuning {
  const t = TUNINGS[key];
  return { ...t, openStrings: [...t.openStrings] };
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

/**
 * Give each note a (string, fret), walking the part in order and picking the
 * position that is cheapest to reach from the previous one.
 */
export function assignTabPositions<T extends { midi: number }>(
  notes: T[],
  t: Tuning,
): (T & TabPosition)[] {
  const lowest = t.openStrings.length;
  let prev: TabPosition = { string: lowest, fret: 0 };
  return notes.map((note) => {
    const options = positionsFor(note.midi, t);
    if (options.length === 0) throw new Error(`MIDI ${note.midi} is not playable in ${t.name}`);
    let best = options[0] as TabPosition;
    let bestCost = Infinity;
    for (const o of options) {
      const cost = positionCost(prev, o);
      if (cost < bestCost) {
        best = o;
        bestCost = cost;
      }
    }
    // Open strings don't move the hand, so keep the previous fretting position.
    if (best.fret > 0) prev = best;
    else prev = { string: best.string, fret: prev.fret };
    return { ...note, ...best };
  });
}

function positionCost(prev: TabPosition, next: TabPosition): number {
  // Open strings are free to reach from anywhere.
  const fretMove = next.fret === 0 ? 0 : Math.abs(next.fret - prev.fret);
  const stringMove = Math.abs(next.string - prev.string) * 0.6;
  const highFret = next.fret > 12 ? (next.fret - 12) * 0.8 : 0;
  return fretMove + stringMove + highFret;
}
