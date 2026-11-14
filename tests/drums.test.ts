import { describe, expect, it } from 'vitest';
import { generateDrums, type DrumHit, type DrumPiece } from '../src/engine/drums.ts';
import { generateRiff } from '../src/engine/generate.ts';
import { COMPLEXITIES, NOTE_NAMES, type Archetype, type Bars, type Riff } from '../src/engine/types.ts';
import { riffDigest } from './digest.ts';

const STYLES: Archetype[] = ['tremolo', 'gallop', 'chug', 'breakdown'];
const at = (hits: DrumHit[], piece: DrumPiece) => hits.filter((h) => h.piece === piece).map((h) => h.step);

/** One 1-bar riff per style, with a fixed Guitar 1 so the expected beat is easy to write down. */
const oneBar = (style: Archetype, palmMuted: number[] = []) =>
  generateDrums({ archetype: style, totalSteps: 16, guitar1: palmMuted.map((step) => ({ step, palmMute: true })) });

describe('drum patterns per style (one bar)', () => {
  it('chug: snare on 2 and 4, hats on 8ths, kick on beat 1 and every chug', () => {
    const d = oneBar('chug', [0, 2, 3, 6, 11]);
    expect(at(d, 'snare')).toEqual([4, 12]);
    expect(at(d, 'hat')).toEqual([2, 4, 6, 10, 12, 14]); // 8ths, but none under the crashes on 0 and 8
    expect(at(d, 'kick')).toEqual([0, 2, 3, 6, 11]);
    expect(at(d, 'crash')).toEqual([0, 8]); // beat 1 of each half (a 1-bar riff's halves are 8 steps)
  });

  it('gallop: same backbeat, kick follows the gallop', () => {
    const d = oneBar('gallop', [0, 2, 3, 4, 6, 7]);
    expect(at(d, 'snare')).toEqual([4, 12]);
    expect(at(d, 'kick')).toEqual([0, 2, 3, 4, 6, 7]);
  });

  it('tremolo: a skank beat (kick on the beat, snare on the off-beat 8ths), hats on quarters', () => {
    const d = oneBar('tremolo', [5, 9]); // palm mutes don't drive the kick here
    expect(at(d, 'kick')).toEqual([0, 4, 8, 12]);
    expect(at(d, 'snare')).toEqual([2, 6, 10, 14]);
    expect(at(d, 'hat')).toEqual([4, 12]); // quarters, minus the crashes on 0 and 8
  });

  it('breakdown: half time (snare on beat 3 only), kick with the chugs', () => {
    const d = oneBar('breakdown', [0, 3, 6]);
    expect(at(d, 'snare')).toEqual([8]);
    expect(at(d, 'kick')).toEqual([0, 3, 6]);
    expect(at(d, 'hat')).toEqual([4, 12]);
  });
});

describe('drums on generated riffs', () => {
  const riffs: Riff[] = [];
  let seed = 1;
  for (const complexity of COMPLEXITIES) {
    for (const style of STYLES) {
      for (const bars of [1, 2, 4] as Bars[]) {
        for (const key of NOTE_NAMES.slice(0, 4)) {
          riffs.push(generateRiff({ key, scale: 'harmonicMinor', bpm: 180, bars, seed: seed++ * 97, style, complexity }));
        }
      }
    }
  }

  it('every bar starts with an accented kick; crashes open each half', () => {
    for (const r of riffs) {
      for (let bar = 0; bar < r.totalSteps; bar += 16) {
        expect(r.drums.some((h) => h.step === bar && h.piece === 'kick' && h.accent)).toBe(true);
      }
      expect(at(r.drums, 'crash')).toEqual([0, r.totalSteps / 2]);
    }
  });

  it('the kick lands on every palm-muted Guitar 1 note in chug, gallop and breakdown riffs', () => {
    let checked = 0;
    for (const r of riffs.filter((x) => x.archetype !== 'tremolo')) {
      const kicks = new Set(at(r.drums, 'kick'));
      for (const n of r.guitar1) {
        if (!n.palmMute) continue;
        expect(kicks.has(n.step), `${r.archetype} seed ${r.seed} step ${n.step}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it('stays inside the riff, sorted, with one hit per piece per step, and no hat under a crash', () => {
    for (const r of riffs) {
      const seen = new Set<string>();
      let last = -1;
      for (const h of r.drums) {
        expect(h.step).toBeGreaterThanOrEqual(0);
        expect(h.step).toBeLessThan(r.totalSteps);
        expect(h.step).toBeGreaterThanOrEqual(last);
        last = h.step;
        const key = `${h.step}:${h.piece}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
      for (const c of at(r.drums, 'crash')) expect(seen.has(`${c}:hat`)).toBe(false);
    }
  });

  it('is deterministic and does not change the riff itself', () => {
    const opts = { key: 'E', scale: 'harmonicMinor', bpm: 180, bars: 4, seed: 916465, complexity: 'extreme' } as const;
    const a = generateRiff(opts);
    const b = generateRiff(opts);
    expect(a.drums).toEqual(b.drums);
    // The drums are derived without randomness: the riff's music digest doesn't include or depend on them.
    expect(riffDigest(a)).toBe(riffDigest({ ...a, drums: [] }));
  });
});
