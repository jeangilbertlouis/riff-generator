import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GROUPINGS, PROFILES } from '../src/engine/complexity.ts';
import { generateRiff } from '../src/engine/generate.ts';
import { CELLS, GROUP_CELLS } from '../src/engine/rhythm.ts';
import { variationLength } from '../src/engine/riff.ts';
import { COMPLEXITIES, type Bars, type Complexity, type GenerateOptions, type Riff } from '../src/engine/types.ts';
import { riffDigest } from './digest.ts';

type GoldenCase = Omit<GenerateOptions, 'bars'> & { bars: Bars; seed: number; hash: string };
const golden = JSON.parse(readFileSync(new URL('./fixtures/golden-riffs.json', import.meta.url), 'utf8')) as {
  cases: GoldenCase[];
};

describe('regression guard (golden riffs)', () => {
  it('the engine still produces the 84 recorded riffs; run `npm run golden` after a deliberate change', () => {
    expect(golden.cases).toHaveLength(84);
    for (const { hash, ...opts } of golden.cases) {
      expect(riffDigest(generateRiff(opts)), `${opts.key} ${opts.scale} seed ${opts.seed}`).toBe(hash);
    }
  });

  it('the engine defaults to normal', () => {
    expect(generateRiff({ key: 'E', scale: 'phrygian', bpm: 180, seed: 1 }).complexity).toBe('normal');
  });

  it('rejects unknown complexities', () => {
    expect(() => generateRiff({ key: 'E', scale: 'phrygian', bpm: 180, complexity: 'insane' as Complexity })).toThrow(
      RangeError,
    );
  });
});

describe('cells and groupings', () => {
  it('every grouping adds up to its span', () => {
    for (const [span, list] of Object.entries(GROUPINGS)) {
      for (const g of list) expect(g.reduce((a, b) => a + b, 0)).toBe(Number(span));
    }
  });

  it('every group cell has the length it is filed under, starts accented and fits inside itself', () => {
    for (const byLength of Object.values(GROUP_CELLS)) {
      for (const [len, options] of Object.entries(byLength)) {
        for (const [id] of options) {
          const cell = CELLS[id]!;
          expect(cell.length).toBe(Number(len));
          expect(cell.hits[0]!.offset).toBe(0);
          expect(cell.hits[0]!.accent).toBe(true);
          for (const h of cell.hits) expect(h.offset + h.duration).toBeLessThanOrEqual(cell.length);
        }
      }
    }
  });

  it('every cell a profile adds exists', () => {
    for (const p of Object.values(PROFILES)) {
      for (const list of Object.values(p.extraCells)) for (const [id] of list) expect(CELLS[id]).toBeDefined();
      for (const id of p.removeCells) expect(CELLS[id]).toBeDefined();
    }
  });

  it('variation length grows with complexity and never exceeds half the riff', () => {
    for (const bars of [1, 2, 4, 8] as Bars[]) {
      const lengths = COMPLEXITIES.map((c) => variationLength(bars, c));
      for (let i = 1; i < lengths.length; i++) expect(lengths[i]!).toBeGreaterThanOrEqual(lengths[i - 1]!);
      for (const l of lengths) {
        expect(l).toBeGreaterThan(0);
        expect(l).toBeLessThan(bars * 8);
        expect(l % 4).toBe(0);
      }
    }
    expect(variationLength(4, 'extreme')).toBe(28);
  });
});

// ---- Complexity has to be audible: averaged measurements over many seeds ----

const SEEDS = Array.from({ length: 200 }, (_, i) => i * 104729 + 17);
const KEYS = ['E', 'C', 'A', 'D'] as const;

function riffsAt(complexity: Complexity): Riff[] {
  return SEEDS.map((seed, i) =>
    generateRiff({ key: KEYS[i % 4]!, scale: 'phrygian', bpm: 150 + (i % 5) * 20, bars: 2, seed, complexity }),
  );
}

const BY_LEVEL = Object.fromEntries(COMPLEXITIES.map((c) => [c, riffsAt(c)])) as Record<Complexity, Riff[]>;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Distinct pitches in Guitar 1. */
const pitchVariety = (r: Riff) => new Set(r.guitar1.map((n) => n.midi)).size;
/** Share of accented notes that land off the beat (displacement). */
const offBeatAccents = (r: Riff) => {
  const accents = r.guitar1.filter((n) => n.accent);
  return accents.length ? accents.filter((n) => n.step % 4 !== 0).length / accents.length : 0;
};
/** Share of the second half that is an exact copy of the first. */
const repetition = (r: Riff) => {
  const half = r.totalSteps / 2;
  const key = (n: { step: number; midi: number; duration: number }) => `${n.step % half}:${n.midi}:${n.duration}`;
  const first = new Set(r.guitar1.filter((n) => n.step < half).map(key));
  const second = r.guitar1.filter((n) => n.step >= half);
  return second.length ? second.filter((n) => first.has(key(n))).length / second.length : 0;
};
/** Widest pitch span in Guitar 1, in semitones. */
const span = (r: Riff) => Math.max(...r.guitar1.map((n) => n.midi)) - Math.min(...r.guitar1.map((n) => n.midi));

describe('complexity is audible (averages over 200 seeds)', () => {
  const avg = (f: (r: Riff) => number) =>
    Object.fromEntries(COMPLEXITIES.map((c) => [c, mean(BY_LEVEL[c].map(f))])) as Record<Complexity, number>;

  it('pitch variety rises with each level', () => {
    const v = avg(pitchVariety);
    expect(v.normal).toBeGreaterThan(v.simple);
    expect(v.complex).toBeGreaterThan(v.normal);
    expect(v.extreme).toBeGreaterThan(v.complex);
  });

  it('melodic span widens', () => {
    const s = avg(span);
    expect(s.simple).toBeLessThanOrEqual(12);
    expect(s.complex).toBeGreaterThan(s.normal);
    expect(s.extreme).toBeGreaterThan(s.normal);
  });

  it('accents move off the beat at complex and extreme', () => {
    const o = avg(offBeatAccents);
    expect(o.complex).toBeGreaterThan(o.normal + 0.1);
    expect(o.extreme).toBeGreaterThan(o.complex);
  });

  it('extreme repeats much less of the riff', () => {
    const r = avg(repetition);
    expect(r.extreme).toBeLessThan(r.normal - 0.2);
  });

  it('simple has no chromatic passing tones', () => {
    for (const r of BY_LEVEL.simple) expect(r.guitar1.some((n) => n.passing)).toBe(false);
  });

  it('complex and extreme use the new techniques', () => {
    for (const c of ['complex', 'extreme'] as const) {
      const anyLeaps = BY_LEVEL[c].some((r) => r.guitar1.some((n, i) => i > 0 && Math.abs(n.midi - r.guitar1[i - 1]!.midi) >= 7));
      expect(anyLeaps).toBe(true);
    }
  });
});
