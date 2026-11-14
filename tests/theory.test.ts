import { describe, expect, it } from 'vitest';
import { Rng } from '../src/engine/random.ts';
import { SCALES, SCALE_IDS, scalePitchClasses, shiftByScaleSteps } from '../src/engine/theory.ts';
import { assignTabPositions, positionsFor, rootMidi, tuningForKey } from '../src/engine/tuning.ts';
import { NOTE_NAMES } from '../src/engine/types.ts';

describe('scales', () => {
  it('E Phrygian is E F G A B C D', () => {
    expect(scalePitchClasses('E', 'phrygian')).toEqual([4, 5, 7, 9, 11, 0, 2]);
  });

  it.each(SCALE_IDS)('%s starts on the root and ascends within an octave', (id) => {
    const iv = SCALES[id].intervals;
    expect(iv[0]).toBe(0);
    for (let i = 1; i < iv.length; i++) expect(iv[i]).toBeGreaterThan(iv[i - 1] as number);
    expect(iv.at(-1)).toBeLessThan(12);
  });

  it('a diatonic 3rd in Phrygian is minor on the root and major on the b2', () => {
    expect(shiftByScaleSteps(40, 2, 'E', 'phrygian') - 40).toBe(3); // E → G
    expect(shiftByScaleSteps(41, 2, 'E', 'phrygian') - 41).toBe(4); // F → A
  });
});

describe('tuning', () => {
  it.each(NOTE_NAMES)('key %s: the root sits on the lowest string', (key) => {
    const t = tuningForKey(key);
    const root = rootMidi(t, key);
    expect(root).toBe((t.openStrings.at(-1) as number) + t.rootFret);
  });

  it.each(['E', 'D#', 'D', 'C#', 'C', 'B', 'A#', 'A'] as const)('key %s uses an open-string root', (key) => {
    expect(tuningForKey(key).rootFret).toBe(0);
  });

  it('every tab position plays the right pitch', () => {
    const t = tuningForKey('C');
    for (let m = 36; m <= 84; m++) {
      for (const p of positionsFor(m, t)) expect((t.openStrings[p.string - 1] as number) + p.fret).toBe(m);
    }
  });

  it('keeps a phrase in one hand position', () => {
    const t = tuningForKey('E');
    // E F G A on the low strings: open E, then frets 1, 3, then open A.
    const tab = assignTabPositions([40, 41, 43, 45].map((midi) => ({ midi })), t);
    expect(tab.map((n) => [n.string, n.fret])).toEqual([[6, 0], [6, 1], [6, 3], [5, 0]]);
  });
});

describe('random', () => {
  it('is reproducible from a seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const seqA = Array.from({ length: 20 }, () => a.next());
    expect(Array.from({ length: 20 }, () => b.next())).toEqual(seqA);
    const c = new Rng(43);
    expect(Array.from({ length: 20 }, () => c.next())).not.toEqual(seqA);
  });

  it('int() stays within bounds', () => {
    const r = new Rng(1);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
    }
  });
});
