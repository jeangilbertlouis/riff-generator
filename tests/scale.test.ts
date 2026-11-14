import { describe, expect, it } from 'vitest';
import { generateRiff } from '../src/engine/generate.ts';
import { scaleRunStep } from '../src/engine/riff.ts';
import { SCALES, SCALE_IDS, isInScale, scaleNotesInRange } from '../src/engine/theory.ts';
import { COMPLEXITIES, NOTE_NAMES, type Bars, type GenerateOptions, type NoteEvent, type Riff } from '../src/engine/types.ts';

describe('scale definitions match music theory', () => {
  it.each([
    ['phrygian', [0, 1, 3, 5, 7, 8, 10]],
    ['phrygianDominant', [0, 1, 4, 5, 7, 8, 10]],
    ['locrian', [0, 1, 3, 5, 6, 8, 10]],
    ['naturalMinor', [0, 2, 3, 5, 7, 8, 10]],
    ['harmonicMinor', [0, 2, 3, 5, 7, 8, 11]],
    ['locrianNat6', [0, 1, 3, 5, 6, 9, 10]],
    ['ionianSharp5', [0, 2, 4, 5, 8, 9, 11]],
    ['dorianSharp4', [0, 2, 3, 6, 7, 9, 10]],
    ['lydianSharp2', [0, 3, 4, 6, 7, 9, 11]],
    ['ultralocrian', [0, 1, 3, 4, 6, 8, 9]],
    ['diminished', [0, 1, 3, 4, 6, 7, 9, 10]],
    ['chromatic', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]],
  ] as const)('%s', (id, intervals) => {
    expect(SCALES[id].intervals).toEqual(intervals);
  });
});

/** Riffs with runs: chromRun cells appear in tremolo/gallop/chug pools and more at higher complexity. */
function sweep(extra: Partial<GenerateOptions>): Riff[] {
  const out: Riff[] = [];
  let seed = 5;
  for (const complexity of COMPLEXITIES) {
    for (const key of NOTE_NAMES) {
      for (const scale of SCALE_IDS) {
        const bars = ([1, 2, 4] as Bars[])[seed % 3]!;
        out.push(generateRiff({ key, scale, bpm: 200, bars, seed: seed * 2654435761 >>> 0, complexity, ...extra }));
        seed++;
      }
    }
  }
  return out;
}

const STRICT = sweep({});
const CHROMATIC = sweep({ chromaticPassing: true });
const notesOf = (r: Riff): NoteEvent[] => [...r.guitar1, ...r.guitar2];

describe('strict scales (the default)', () => {
  it('every note of both guitars is in the chosen scale, for every key, scale, length and complexity', () => {
    for (const r of STRICT) {
      expect(r.chromaticPassing).toBe(false);
      for (const n of notesOf(r)) {
        expect(isInScale(n.midi, r.key, r.scale), `${r.key} ${r.scale} seed ${r.seed}: midi ${n.midi}`).toBe(true);
        expect(n.passing).toBe(false);
      }
    }
  });

  it('harmonic minor never uses the ♭7 or ♭2', () => {
    for (const r of STRICT.filter((x) => x.scale === 'harmonicMinor')) {
      for (const n of notesOf(r)) {
        const degree = (((n.midi - NOTE_NAMES.indexOf(r.key)) % 12) + 12) % 12;
        expect([1, 10]).not.toContain(degree);
      }
    }
  });

  it('a run step goes to the adjacent scale note, and turns around at either end', () => {
    // A harmonic minor, from A2: A B C D E F G# A
    const pool = scaleNotesInRange('A', 'harmonicMinor', 45, 57);
    expect(pool).toEqual([45, 47, 48, 50, 52, 53, 56, 57]);
    expect(scaleRunStep(pool, 53, 1)).toEqual({ midi: 56, dir: 1 }); // F → G#: the augmented 2nd, not G
    expect(scaleRunStep(pool, 56, -1)).toEqual({ midi: 53, dir: -1 });
    expect(scaleRunStep(pool, 48, -1)).toEqual({ midi: 47, dir: -1 }); // C → B, not B♭
    expect(scaleRunStep(pool, 45, -1)).toEqual({ midi: 47, dir: 1 }); // at the bottom: turn around
    expect(scaleRunStep(pool, 57, 1)).toEqual({ midi: 56, dir: -1 }); // at the top: turn around
  });

  it('a run step from outside the scale lands on the nearest scale note in its direction', () => {
    const pool = scaleNotesInRange('A', 'harmonicMinor', 45, 57);
    expect(scaleRunStep(pool, 49, 1).midi).toBe(50); // C# → D
    expect(scaleRunStep(pool, 49, -1).midi).toBe(48); // C# → C
  });
});

describe('chromatic passing toggle', () => {
  it('lets runs leave the scale, always flagged as passing', () => {
    let passing = 0;
    for (const r of CHROMATIC) {
      expect(r.chromaticPassing).toBe(true);
      for (const n of notesOf(r)) {
        if (n.passing) passing++;
        else expect(isInScale(n.midi, r.key, r.scale)).toBe(true);
      }
    }
    expect(passing).toBeGreaterThan(0);
  });

  it('changes only the pitches inside runs: rhythm, style and Guitar 2 mode are identical', () => {
    STRICT.forEach((strict, i) => {
      const chromatic = CHROMATIC[i]!;
      expect(chromatic.archetype).toBe(strict.archetype);
      expect(chromatic.guitar2Mode).toBe(strict.guitar2Mode);
      const rhythm = (notes: NoteEvent[]) => notes.map((n) => [n.step, n.duration, n.palmMute, n.accent]);
      expect(rhythm(chromatic.guitar1)).toEqual(rhythm(strict.guitar1));
    });
  });

  it('the Chromatic scale is the same either way (a scale step is a semitone)', () => {
    const strict = STRICT.filter((r) => r.scale === 'chromatic');
    const chromatic = CHROMATIC.filter((r) => r.scale === 'chromatic');
    strict.forEach((r, i) => expect(r.guitar1.map((n) => n.midi)).toEqual(chromatic[i]!.guitar1.map((n) => n.midi)));
  });
});
