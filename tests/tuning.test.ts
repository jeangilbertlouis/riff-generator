import { describe, expect, it } from 'vitest';
import { chordAt } from '../src/engine/harmony.ts';
import { generateRiff } from '../src/engine/generate.ts';
import { isInScale, pc, pitchClassOf } from '../src/engine/theory.ts';
import { MAX_FRET, TUNINGS, TUNING_IDS, rootFretFor, rootMidi, tuningFor, tuningForKey } from '../src/engine/tuning.ts';
import { COMPLEXITIES, NOTE_NAMES, type SecondGuitarMode, type TuningId } from '../src/engine/types.ts';

describe('tuning catalogue', () => {
  it('has unique names, 6 or 7 strings, ordered from the highest string down', () => {
    const names = TUNING_IDS.map((id) => TUNINGS[id].name);
    expect(new Set(names).size).toBe(names.length);
    for (const id of TUNING_IDS) {
      const s = TUNINGS[id].openStrings;
      expect([6, 7]).toContain(s.length);
      for (let i = 1; i < s.length; i++) expect(s[i]!).toBeLessThan(s[i - 1]!);
    }
  });

  it.each([
    ['dropC', [62, 57, 53, 48, 43, 36]],
    ['dropD', [64, 59, 55, 50, 45, 38]],
    ['bStandard', [59, 54, 50, 45, 40, 35]],
    ['dropA', [59, 54, 50, 45, 40, 33]],
    ['dropA7', [64, 59, 55, 50, 45, 40, 33]],
  ] as const)('%s is tuned right', (id, strings) => {
    expect(TUNINGS[id].openStrings).toEqual(strings);
  });
});

describe('where the root goes', () => {
  it('is the lowest pitch of the key at or above the lowest open string', () => {
    expect(rootFretFor(TUNINGS.eStandard.openStrings, 'A')).toBe(5); // A2 on the low E
    expect(rootFretFor(TUNINGS.dropC.openStrings, 'E')).toBe(4); // E2 on the low C
    expect(rootFretFor(TUNINGS.dropC.openStrings, 'C')).toBe(0);
    expect(rootFretFor(TUNINGS.dropA7.openStrings, 'G#')).toBe(11);
    expect(rootMidi(tuningFor('E', 'dropC'), 'E')).toBe(40);
  });

  it('Auto is the old key-to-tuning map', () => {
    const expected: Record<string, [string, number]> = {
      E: ['E standard', 0], 'D#': ['Eb standard', 0], D: ['Drop D', 0], 'C#': ['C# standard', 0], C: ['Drop C', 0],
      B: ['B standard (7-string)', 0], 'A#': ['Bb standard (7-string)', 0], A: ['Drop A (7-string)', 0],
      F: ['E standard', 1], 'F#': ['E standard', 2], G: ['E standard', 3], 'G#': ['E standard', 4],
    };
    for (const key of NOTE_NAMES) {
      const t = tuningForKey(key);
      expect([t.name, t.rootFret]).toEqual(expected[key]);
      expect(tuningFor(key, 'auto')).toEqual(t);
    }
  });

  it('rejects unknown tunings', () => {
    expect(() => generateRiff({ key: 'E', scale: 'phrygian', bpm: 180, tuning: 'banjo' as TuningId })).toThrow(RangeError);
  });
});

describe('every key in every tuning', () => {
  const MODES: SecondGuitarMode[] = ['harmony', 'counter', 'octave', 'arpeggio'];

  it('produces playable tab in the scale, with the pedal on the chord roots, at every level and Guitar 2 mode', () => {
    let riffs = 0;
    let seed = 1;
    for (const tuning of TUNING_IDS) {
      for (const key of NOTE_NAMES) {
        for (const complexity of COMPLEXITIES) {
          const guitar2Mode = MODES[seed % MODES.length]!;
          const r = generateRiff({ key, scale: 'harmonicMinor', bpm: 180, bars: 4, seed: seed++ * 131, complexity, tuning, guitar2Mode });
          riffs++;
          expect(r.tuning.id).toBe(tuning);
          const root = rootMidi(r.tuning, key);
          expect(pc(root)).toBe(pitchClassOf(key));
          for (const n of [...r.guitar1, ...r.guitar2]) {
            const where = `${tuning} ${key} ${complexity} ${r.guitar2Mode} midi ${n.midi}`;
            expect(n.fret, where).toBeGreaterThanOrEqual(0);
            expect(n.fret, where).toBeLessThanOrEqual(MAX_FRET);
            expect(r.tuning.openStrings[n.string - 1]! + n.fret, where).toBe(n.midi);
            expect(isInScale(n.midi, key, 'harmonicMinor'), where).toBe(true);
          }
          for (const n of r.guitar1) {
            if (n.palmMute) expect(pc(n.midi)).toBe(chordAt(r.progression, n.step).rootPc);
          }
        }
      }
    }
    expect(riffs).toBe(TUNING_IDS.length * 12 * 4);
  });

  it('the octave part stays playable everywhere; past fret 22 it plays a third instead (never unison)', () => {
    // Worst cases: a 6-string with a low top string and a high root (e.g. B standard in A#), at Extreme.
    let guarded = 0;
    for (const tuning of TUNING_IDS) {
      for (const key of NOTE_NAMES) {
        for (let seed = 0; seed < 6; seed++) {
          const r = generateRiff({ key, scale: 'phrygian', bpm: 200, bars: 4, seed, complexity: 'extreme', tuning, guitar2Mode: 'octave' });
          r.guitar2.forEach((n, i) => {
            expect(n.fret).toBeLessThanOrEqual(MAX_FRET);
            const interval = n.midi - r.guitar1[i]!.midi;
            expect([3, 4, 12]).toContain(interval); // an octave, or a diatonic third where the octave won't fit
            if (interval !== 12) guarded++;
          });
        }
      }
    }
    expect(guarded).toBeGreaterThan(0); // the guard really is exercised
  });
});
