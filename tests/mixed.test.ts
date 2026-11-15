import { describe, expect, it } from 'vitest';
import { generateRiff } from '../src/engine/generate.ts';
import { PROFILES } from '../src/engine/complexity.ts';
import { chordAt, flavourOptions } from '../src/engine/harmony.ts';
import { MIN_SECTION } from '../src/engine/second.ts';
import { isInScale, pc } from '../src/engine/theory.ts';
import { MAX_FRET, rootMidi } from '../src/engine/tuning.ts';
import { COMPLEXITIES, NOTE_NAMES, type Archetype, type Bars, type Riff } from '../src/engine/types.ts';
import { defaultSettings, describeRiff, toGenerateOptions } from '../src/ui/settings.ts';
import { fromQuery } from '../src/ui/share.ts';
import { riffDigest } from './digest.ts';

const STYLES: Archetype[] = ['tremolo', 'gallop', 'chug', 'breakdown'];

/** Mixed riffs across every length, chord-changes option, level, style and key. */
const RIFFS: Riff[] = [];
let seed = 1;
for (const bars of [1, 2, 4, 8] as Bars[]) {
  for (const chordChanges of ['steady', 'longer', 'repeat'] as const) {
    for (const complexity of COMPLEXITIES) {
      for (const key of NOTE_NAMES.slice(0, 6)) {
        const style = STYLES[seed % STYLES.length]!;
        RIFFS.push(generateRiff({ key, scale: 'harmonicMinor', bpm: 180, bars, seed: seed++ * 89, complexity, chordChanges, style, guitar2Mode: 'mixed' }));
      }
    }
  }
}

describe('Guitar 2 Mixed: sections', () => {
  it('sections tile the riff, each at least half a bar and starting where a chord starts', () => {
    for (const r of RIFFS) {
      expect(r.guitar2Mode).toBe('mixed');
      const chordStarts = new Set(r.progression.map((c) => c.step));
      let next = 0;
      for (const s of r.guitar2Sections) {
        expect(s.step).toBe(next);
        expect(s.length).toBeGreaterThanOrEqual(MIN_SECTION);
        expect(chordStarts.has(s.step) || s.step === r.totalSteps / 2).toBe(true);
        next += s.length;
      }
      expect(next).toBe(r.totalSteps);
    }
  });

  it('never plays the same part in two sections in a row, and every riff uses at least two parts', () => {
    for (const r of RIFFS) {
      const parts = r.guitar2Sections.map((s) => s.part);
      for (let i = 1; i < parts.length; i++) expect(parts[i]).not.toBe(parts[i - 1]);
      expect(new Set(parts).size).toBeGreaterThanOrEqual(2);
      for (const p of parts) expect(['harmony', 'counter', 'arpeggio']).toContain(p);
    }
  });

  it('uses all three parts across riffs, and usually all three within one riff of 4 or 8 bars', () => {
    const allParts = new Set(RIFFS.flatMap((r) => r.guitar2Sections.map((s) => s.part)));
    expect(allParts).toEqual(new Set(['harmony', 'counter', 'arpeggio']));
    const share = (bars: Bars) => {
      const of = RIFFS.filter((r) => r.bars === bars);
      return of.filter((r) => new Set(r.guitar2Sections.map((s) => s.part)).size === 3).length / of.length;
    };
    // 1 bar has at most two half-bar sections, so two parts at most.
    expect(share(1)).toBe(0);
    expect(share(2)).toBeGreaterThan(0.3);
    expect(share(4)).toBeGreaterThan(0.8);
    expect(share(8)).toBeGreaterThan(0.8);
  });
});

describe('Guitar 2 Mixed: notes', () => {
  it('each section plays its part: arpeggio and counter notes fit their rules, harmony follows Guitar 1’s rhythm', () => {
    for (const r of RIFFS) {
      const root = rootMidi(r.tuning, r.key);
      for (const s of r.guitar2Sections) {
        const end = s.step + s.length;
        const notes = r.guitar2.filter((n) => n.step >= s.step && n.step < end);
        for (const n of notes) {
          if (s.part === 'arpeggio') {
            const chord = chordAt(r.progression, n.step);
            const flavour = PROFILES[r.complexity].arpFlavour > 0 ? flavourOptions(r.key, r.scale, chord).map((o) => o.pc) : [];
            expect([...chord.tones, ...flavour]).toContain(pc(n.midi));
          }
          if (s.part !== 'harmony') {
            expect(n.midi).toBeGreaterThanOrEqual(root + 12);
            expect(n.midi).toBeLessThanOrEqual(root + 12 + (s.part === 'arpeggio' ? PROFILES[r.complexity].arpRange : 12));
          }
        }
        if (s.part === 'harmony') {
          const g1Steps = new Set(r.guitar1.filter((n) => n.step >= s.step && n.step < end).map((n) => n.step));
          for (const n of notes) expect(g1Steps.has(n.step)).toBe(true);
        }
      }
    }
  });

  it('stays monophonic (nothing rings past its section), in the scale and playable', () => {
    for (const r of RIFFS) {
      let busyUntil = 0;
      for (const n of r.guitar2) {
        expect(n.step).toBeGreaterThanOrEqual(busyUntil);
        busyUntil = n.step + n.duration;
        const section = r.guitar2Sections.find((s) => n.step >= s.step && n.step < s.step + s.length)!;
        expect(n.step + n.duration).toBeLessThanOrEqual(section.step + section.length);
        expect(isInScale(n.midi, r.key, r.scale)).toBe(true);
        expect(n.fret).toBeGreaterThanOrEqual(0);
        expect(n.fret).toBeLessThanOrEqual(MAX_FRET);
        expect(r.tuning.openStrings[n.string - 1]! + n.fret).toBe(n.midi);
      }
      expect(busyUntil).toBeLessThanOrEqual(r.totalSteps);
    }
  });

  it('is deterministic per seed, and leaves Guitar 1 untouched', () => {
    const opts = { key: 'E', scale: 'harmonicMinor', bpm: 180, bars: 4, seed: 42, complexity: 'extreme' } as const;
    const mixed = generateRiff({ ...opts, guitar2Mode: 'mixed' });
    expect(generateRiff({ ...opts, guitar2Mode: 'mixed' })).toEqual(mixed);
    expect(mixed.guitar1).toEqual(generateRiff({ ...opts, guitar2Mode: 'harmony' }).guitar1);
  });
});

describe('Guitar 2 Mixed: defaults and links', () => {
  it('is the UI default, and the summary lists the parts in order', () => {
    expect(defaultSettings(1).guitar2Mode).toBe('mixed');
    const r = generateRiff(toGenerateOptions({ ...defaultSettings(4242), bars: 2 }));
    expect(describeRiff(r)).toMatch(/Guitar 2: mixed \((harmony|counter|arpeggio)(, (harmony|counter|arpeggio))+\)/);
  });

  it('single modes keep one section covering the riff', () => {
    for (const mode of ['harmony', 'counter', 'octave', 'arpeggio'] as const) {
      const r = generateRiff({ key: 'E', scale: 'phrygian', bpm: 180, bars: 2, seed: 7, guitar2Mode: mode });
      expect(r.guitar2Sections).toEqual([{ step: 0, length: 32, part: mode }]);
    }
  });

  it('old links keep their Guitar 2: g2=auto stays Auto, and a seed without a valid g2 opens as Auto', () => {
    const d = defaultSettings(1);
    expect(fromQuery('?seed=5&g2=auto', d).settings.guitar2Mode).toBe('auto');
    expect(fromQuery('?seed=5&g2=unison', d).settings.guitar2Mode).toBe('auto');
    expect(fromQuery('?seed=5', d).settings.guitar2Mode).toBe('auto');
    expect(fromQuery('?g2=mixed&seed=5', d).settings.guitar2Mode).toBe('mixed');
    expect(fromQuery('', d).settings.guitar2Mode).toBe('mixed');
  });

  it('the engine default (Auto) is unchanged, so default riffs are exactly as before', () => {
    const r = generateRiff({ key: 'E', scale: 'phrygian', bpm: 180, seed: 11 });
    expect(r.guitar2Mode).not.toBe('mixed');
    expect(riffDigest(r)).toBe(riffDigest(generateRiff({ key: 'E', scale: 'phrygian', bpm: 180, seed: 11, guitar2Mode: 'auto' })));
  });
});
