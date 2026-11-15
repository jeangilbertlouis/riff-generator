import { describe, expect, it } from 'vitest';
import { generateRiff } from '../src/engine/generate.ts';
import { PROFILES } from '../src/engine/complexity.ts';
import { chordAt, flavourOptions } from '../src/engine/harmony.ts';
import { variationLength } from '../src/engine/riff.ts';
import { SCALE_IDS, isInScale, pc } from '../src/engine/theory.ts';
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
const MODES: SecondGuitarMode[] = ['harmony', 'counter', 'octave', 'arpeggio'];
const BARS: Bars[] = [1, 2, 4, 8];

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
          riffs.push(generateRiff({ key, scale, bpm: 180, bars, seed: seed * 7919, complexity, chordChanges: 'auto' }));
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

  it("ends Guitar 1 on the final chord's root", () => {
    for (const r of RIFFS) {
      const last = r.guitar1.at(-1) as NoteEvent;
      const chord = chordAt(r.progression, last.step);
      expect(pc(last.midi)).toBe(chord.rootPc);
    }
  });

  it('repeats phrase A in A′ up to the variation (pedals follow the chord when it differs)', () => {
    for (const r of RIFFS) {
      const half = r.totalSteps / 2;
      const headLen = half - variationLength(r.bars, r.complexity);
      // Rhythm and articulation always repeat. Pitches repeat too, except pedal notes (the chord's root,
      // muted or not) over a different chord: those land on the new chord's root.
      const rootAt = (step: number) => chordAt(r.progression, step).rootPc;
      const a = r.guitar1.filter((n) => n.step < headLen);
      const aPrime = r.guitar1.filter((n) => n.step >= half && n.step < half + headLen);
      const rhythm = (n: NoteEvent, offset: number) => [n.step - offset, n.duration, n.palmMute, n.accent];
      expect(aPrime.map((n) => rhythm(n, half))).toEqual(a.map((n) => rhythm(n, 0)));
      aPrime.forEach((n, i) => {
        const original = a[i]!;
        if (n.midi === original.midi) return;
        expect(pc(original.midi)).toBe(rootAt(original.step)); // was a pedal on A's chord
        expect(pc(n.midi)).toBe(rootAt(n.step)); // now the pedal on A′'s chord
      });
    }
  });
});

describe('Guitar 2 modes', () => {
  const rhythm = (notes: NoteEvent[]) => notes.map((n) => [n.step, n.duration, n.palmMute]);
  const of = (mode: SecondGuitarMode) => RIFFS.filter((r) => r.guitar2Mode === mode);

  it('every mode is covered by the sweep', () => {
    for (const m of MODES) expect(of(m).length).toBeGreaterThan(10);
  });

  it('Guitar 2 never doubles Guitar 1 note for note (no unison), whatever the style or level', () => {
    for (const r of RIFFS) {
      expect(MODES).toContain(r.guitar2Mode);
      const same =
        r.guitar2.length === r.guitar1.length &&
        r.guitar2.every((n, i) => n.step === r.guitar1[i]!.step && n.midi === r.guitar1[i]!.midi);
      expect(same, `${r.key} ${r.scale} seed ${r.seed}`).toBe(false);
    }
  });

  it('Auto never picks unison, for any style', () => {
    for (const style of ARCHETYPES) {
      for (let seed = 0; seed < 60; seed++) {
        const r = generateRiff({ key: 'E', scale: 'phrygian', bpm: 180, seed, style });
        expect(['harmony', 'counter', 'octave', 'arpeggio']).toContain(r.guitar2Mode);
      }
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

  it("counter-melody stays an octave or more above the root and ends on the final chord's root", () => {
    for (const r of of('counter')) {
      const root = rootMidi(r.tuning, r.key);
      for (const n of r.guitar2) {
        expect(n.midi).toBeGreaterThanOrEqual(root + 12);
        expect(n.midi).toBeLessThanOrEqual(root + 24);
        expect(n.passing).toBe(false);
      }
      const last = r.guitar2.at(-1) as NoteEvent;
      expect(pc(last.midi)).toBe(chordAt(r.progression, last.step).rootPc);
    }
  });

  it('arpeggio mode plays only tones of the chord under each note, an octave or more up, repeating when the chords repeat', () => {
    expect(of('arpeggio').length).toBeGreaterThan(10);
    for (const r of of('arpeggio')) {
      const root = rootMidi(r.tuning, r.key);
      for (const n of r.guitar2) {
        // Extreme's 4-note chords add their flavour tone; Extreme also climbs higher (arpRange).
        const chord = chordAt(r.progression, n.step);
        const flavour = PROFILES[r.complexity].arpFlavour > 0 ? flavourOptions(r.key, r.scale, chord).map((o) => o.pc) : [];
        expect([...chord.tones, ...flavour]).toContain(pc(n.midi));
        expect(n.midi).toBeGreaterThanOrEqual(root + 12);
        expect(n.midi).toBeLessThanOrEqual(root + 12 + PROFILES[r.complexity].arpRange);
      }
      if (r.chordChanges !== 'steady') continue;
      const half = r.totalSteps / 2;
      const a = r.guitar2.filter((n) => n.step < half).map((n) => [n.step, n.midi]);
      const b = r.guitar2.filter((n) => n.step >= half).map((n) => [n.step - half, n.midi]);
      expect(b).toEqual(a);
    }
  });
});
