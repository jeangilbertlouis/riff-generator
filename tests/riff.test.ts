import { describe, expect, it } from 'vitest';
import { generateRiff } from '../src/engine/generate.ts';
import { variationLength } from '../src/engine/riff.ts';
import { SCALE_IDS, hasFlatTwo, isInScale, pc, pitchClassOf } from '../src/engine/theory.ts';
import { MAX_FRET, rootMidi } from '../src/engine/tuning.ts';
import {
  COMPLEXITIES,
  NOTE_NAMES,
  type Archetype,
  type Bars,
  type NoteEvent,
  type Riff,
  type SecondGuitarMode,
} from '../src/engine/types.ts';

const ARCHETYPES: Archetype[] = ['tremolo', 'gallop', 'chug', 'breakdown'];
const MODES: SecondGuitarMode[] = ['unison', 'harmony', 'counter', 'octave'];
const BARS: Bars[] = [1, 2, 4];

/** A broad sweep of riffs: every key × scale × bars × complexity, across styles, modes and seeds. */
function sweep(): Riff[] {
  const riffs: Riff[] = [];
  let seed = 1;
  for (const complexity of COMPLEXITIES) {
    for (const key of NOTE_NAMES) {
      for (const scale of SCALE_IDS) {
        for (const bars of BARS) {
          const style = ARCHETYPES[seed % ARCHETYPES.length] as Archetype;
          const mode = seed % 5 === 0 ? 'auto' : (MODES[seed % MODES.length] as SecondGuitarMode);
          const bpm = 60 + ((seed * 37) % 200);
          riffs.push(generateRiff({ key, scale, bpm, bars, seed, style, guitar2Mode: mode, complexity }));
          riffs.push(generateRiff({ key, scale, bpm: 180, bars, seed: seed * 7919, complexity }));
          seed++;
        }
      }
    }
  }
  return riffs;
}

const RIFFS = sweep();
const parts = (r: Riff): [string, NoteEvent[]][] => [['guitar1', r.guitar1], ['guitar2', r.guitar2]];

describe('generateRiff', () => {
  it('is deterministic for a given seed', () => {
    const opts = { key: 'E', scale: 'phrygian', bpm: 200, bars: 2, seed: 1234 } as const;
    expect(generateRiff(opts)).toEqual(generateRiff(opts));
  });

  it('gives different riffs for different seeds', () => {
    const a = generateRiff({ key: 'E', scale: 'phrygian', bpm: 200, seed: 1 });
    const b = generateRiff({ key: 'E', scale: 'phrygian', bpm: 200, seed: 2 });
    expect(a.guitar1).not.toEqual(b.guitar1);
  });

  it('rejects bad input', () => {
    expect(() => generateRiff({ key: 'E', scale: 'phrygian', bpm: 30 })).toThrow(RangeError);
    expect(() => generateRiff({ key: 'E', scale: 'phrygian', bpm: 300 })).toThrow(RangeError);
    expect(() => generateRiff({ key: 'E', scale: 'phrygian', bpm: 180, bars: 3 as Bars })).toThrow(RangeError);
    expect(() => generateRiff({ key: 'H' as 'E', scale: 'phrygian', bpm: 180 })).toThrow(RangeError);
  });

  it('resolves auto to a concrete archetype and Guitar 2 mode', () => {
    for (const r of RIFFS) {
      expect(ARCHETYPES).toContain(r.archetype);
      expect(MODES).toContain(r.guitar2Mode);
    }
  });

  it('every bar has notes in both guitars', () => {
    for (const r of RIFFS) {
      for (const [, notes] of parts(r)) {
        for (let bar = 0; bar < r.bars; bar++) {
          expect(notes.some((n) => n.step >= bar * 16 && n.step < (bar + 1) * 16)).toBe(true);
        }
      }
    }
  });

  it('each part is monophonic and fits inside the riff', () => {
    for (const r of RIFFS) {
      for (const [, notes] of parts(r)) {
        let end = 0;
        for (const n of notes) {
          expect(n.duration).toBeGreaterThan(0);
          expect(n.step).toBeGreaterThanOrEqual(end);
          end = n.step + n.duration;
        }
        expect(end).toBeLessThanOrEqual(r.totalSteps);
      }
    }
  });

  it('keeps every non-passing note inside the scale', () => {
    for (const r of RIFFS) {
      for (const [, notes] of parts(r)) {
        for (const n of notes) {
          if (!n.passing) expect(isInScale(n.midi, r.key, r.scale)).toBe(true);
        }
      }
    }
  });

  it('only marks real chromatic passing tones as passing', () => {
    for (const r of RIFFS) {
      for (const [, notes] of parts(r)) {
        for (const n of notes) if (n.passing) expect(isInScale(n.midi, r.key, r.scale)).toBe(false);
      }
    }
  });

  it('never goes below the root and every note is playable', () => {
    for (const r of RIFFS) {
      const root = rootMidi(r.tuning, r.key);
      for (const [, notes] of parts(r)) {
        for (const n of notes) {
          expect(n.midi).toBeGreaterThanOrEqual(root);
          expect(n.string).toBeGreaterThanOrEqual(1);
          expect(n.string).toBeLessThanOrEqual(r.tuning.openStrings.length);
          expect(n.fret).toBeGreaterThanOrEqual(0);
          expect(n.fret).toBeLessThanOrEqual(MAX_FRET);
          expect((r.tuning.openStrings[n.string - 1] as number) + n.fret).toBe(n.midi);
        }
      }
    }
  });

  it('frets notes up the neck: almost no open string where a fretted position existed', () => {
    let choosable = 0;
    let openAnyway = 0;
    let inZone = 0;
    for (const r of RIFFS) {
      for (const [, notes] of parts(r)) {
        for (const n of notes) {
          const fretted = r.tuning.openStrings.filter((o) => n.midi - o >= 1 && n.midi - o <= MAX_FRET).length;
          if (fretted === 0) continue;
          choosable++;
          if (n.fret === 0) openAnyway++;
          // Could this note sit in the 5–12 zone? Then count whether it does.
          if (r.tuning.openStrings.some((o) => n.midi - o >= 5 && n.midi - o <= 12) && n.fret >= 5 && n.fret <= 12) inZone++;
        }
      }
    }
    expect(openAnyway / choosable).toBeLessThan(0.03);
    expect(inZone / choosable).toBeGreaterThan(0.5);
  });

  it('ends Guitar 1 on the root, or the b2 when the scale has one', () => {
    for (const r of RIFFS) {
      const last = r.guitar1.at(-1) as NoteEvent;
      const degree = pc(last.midi - pitchClassOf(r.key));
      expect(hasFlatTwo(r.scale) ? [0, 1] : [0]).toContain(degree);
    }
  });

  it('repeats phrase A in A′ up to the variation', () => {
    for (const r of RIFFS) {
      const half = r.totalSteps / 2;
      const headLen = half - variationLength(r.bars, r.complexity);
      const strip = ({ step, duration, midi, palmMute, accent }: NoteEvent) => ({ step, duration, midi, palmMute, accent });
      const a = r.guitar1.filter((n) => n.step < headLen).map(strip);
      const aPrime = r.guitar1
        .filter((n) => n.step >= half && n.step < half + headLen)
        .map((n) => strip({ ...n, step: n.step - half }));
      expect(aPrime).toEqual(a);
    }
  });
});

describe('Guitar 2 modes', () => {
  const rhythm = (notes: NoteEvent[]) => notes.map((n) => [n.step, n.duration, n.palmMute]);
  const of = (mode: SecondGuitarMode) => RIFFS.filter((r) => r.guitar2Mode === mode);

  it('every mode is covered by the sweep', () => {
    for (const m of MODES) expect(of(m).length).toBeGreaterThan(10);
  });

  it('unison copies Guitar 1', () => {
    for (const r of of('unison')) {
      expect(r.guitar2.map((n) => n.midi)).toEqual(r.guitar1.map((n) => n.midi));
      expect(rhythm(r.guitar2)).toEqual(rhythm(r.guitar1));
    }
  });

  it('octave plays Guitar 1 twelve semitones up', () => {
    for (const r of of('octave')) {
      expect(r.guitar2.map((n) => n.midi - 12)).toEqual(r.guitar1.map((n) => n.midi));
      expect(rhythm(r.guitar2)).toEqual(rhythm(r.guitar1));
    }
  });

  it('harmony keeps the rhythm and stays above Guitar 1 by a 3rd–5th', () => {
    for (const r of of('harmony')) {
      expect(rhythm(r.guitar2)).toEqual(rhythm(r.guitar1));
      r.guitar2.forEach((n, i) => {
        const interval = n.midi - (r.guitar1[i] as NoteEvent).midi;
        expect(interval).toBeGreaterThanOrEqual(3);
        expect(interval).toBeLessThanOrEqual(8);
      });
    }
  });

  it('counter-melody stays an octave or more above the root and ends on root or b2', () => {
    for (const r of of('counter')) {
      const root = rootMidi(r.tuning, r.key);
      for (const n of r.guitar2) {
        expect(n.midi).toBeGreaterThanOrEqual(root + 12);
        expect(n.midi).toBeLessThanOrEqual(root + 24);
        expect(n.passing).toBe(false);
      }
      expect([root + 12, root + 13]).toContain((r.guitar2.at(-1) as NoteEvent).midi);
    }
  });
});
