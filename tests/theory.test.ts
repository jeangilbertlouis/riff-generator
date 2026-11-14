import { describe, expect, it } from 'vitest';
import { Rng } from '../src/engine/random.ts';
import { SCALES, SCALE_IDS, scalePitchClasses, shiftByScaleSteps } from '../src/engine/theory.ts';
import { assignTabPositions, fretCost, positionsFor, rootMidi, tuningForKey } from '../src/engine/tuning.ts';
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

  it('keeps a phrase in one hand position, fretting rather than using an open string', () => {
    const t = tuningForKey('E');
    // E F G A: the open low E and frets 1 and 3 are forced; A goes to fret 5 on the same string, not open A.
    const tab = assignTabPositions([40, 41, 43, 45].map((midi) => ({ midi })), t);
    expect(tab.map((n) => [n.string, n.fret])).toEqual([[6, 0], [6, 1], [6, 3], [6, 5]]);
  });
});

describe('fingering: higher up the fretboard', () => {
  const t = tuningForKey('E');
  const tab = (midis: number[]) => assignTabPositions(midis.map((midi) => ({ midi })), t);

  it('costs: frets 5–12 are free, open strings and the first frets cost more, very high frets cost most', () => {
    expect(fretCost(0)).toBeGreaterThan(fretCost(1));
    expect(fretCost(1)).toBeGreaterThan(fretCost(4));
    for (let f = 5; f <= 12; f++) expect(fretCost(f)).toBe(0);
    expect(fretCost(15)).toBeGreaterThan(0);
    expect(fretCost(20)).toBeGreaterThan(fretCost(15) + 3);
  });

  it('plays a lone note fretted up the neck instead of open', () => {
    expect(tab([45]).map((n) => [n.string, n.fret])).toEqual([[6, 5]]); // A on the low E string, fret 5
    expect(tab([50])[0]!.fret).toBeGreaterThanOrEqual(5); // D: A string 5 (or E 10), not the open D
  });

  it('keeps a melody in the 5–12 zone when every note can be there', () => {
    // E3 F3 G3 A3 B3 C4: each has a position between frets 5 and 12.
    for (const n of tab([52, 53, 55, 57, 59, 60])) {
      expect(n.fret).toBeGreaterThanOrEqual(5);
      expect(n.fret).toBeLessThanOrEqual(12);
    }
  });

  it('an open-string pedal does not reset the hand', () => {
    // Pedal on open low E between notes on the A string: the fretted notes stay together.
    const fretted = tab([40, 50, 40, 52, 40, 53, 40, 52]).filter((n) => n.fret > 0).map((n) => n.fret);
    expect(Math.max(...fretted) - Math.min(...fretted)).toBeLessThanOrEqual(4);
  });

  it('the lowest root stays on the open low string (it has no other position)', () => {
    expect(tab([40, 40, 40]).every((n) => n.string === 6 && n.fret === 0)).toBe(true);
  });

  it('avoids big jumps between neighbours', () => {
    const notes = tab([45, 47, 48, 50, 52, 53, 55, 57, 55, 53, 52, 50]);
    for (let i = 1; i < notes.length; i++) {
      if (notes[i]!.fret > 0 && notes[i - 1]!.fret > 0) {
        expect(Math.abs(notes[i]!.fret - notes[i - 1]!.fret)).toBeLessThanOrEqual(5);
      }
    }
  });

  it('works on 7-string tunings and when there is nothing to choose', () => {
    expect(assignTabPositions([], t)).toEqual([]);
    const seven = tuningForKey('B');
    const out = assignTabPositions([35, 40, 45].map((midi) => ({ midi })), seven);
    expect(out[0]).toMatchObject({ string: 7, fret: 0 }); // low B, open: only position
    expect(out[1]!.fret).toBeGreaterThan(0); // E: fretted on the B string (5), not the open E
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
