import { describe, expect, it } from 'vitest';
import { generateRiff } from '../src/engine/generate.ts';
import {
  GUITAR2_OPTIONS,
  KEY_OPTIONS,
  MAX_SEED,
  SCALE_OPTIONS,
  STYLE_OPTIONS,
  TUNING_OPTIONS,
  CHORD_CHANGES_OPTIONS,
  defaultSettings,
  describeRiff,
  parseBpm,
  parseSeed,
  pickOption,
  toGenerateOptions,
} from '../src/ui/settings.ts';

describe('parseBpm', () => {
  it('rounds and clamps to 60–260', () => {
    expect(parseBpm('180', 100)).toBe(180);
    expect(parseBpm(' 199.6 ', 100)).toBe(200);
    expect(parseBpm('10', 100)).toBe(60);
    expect(parseBpm('999', 100)).toBe(260);
  });

  it('falls back on non-numbers', () => {
    expect(parseBpm('', 150)).toBe(150);
    expect(parseBpm('fast', 150)).toBe(150);
    expect(parseBpm('Infinity', 150)).toBe(150);
  });
});

describe('parseSeed', () => {
  it('accepts whole numbers 0 to 2^32-1', () => {
    expect(parseSeed('0')).toBe(0);
    expect(parseSeed(' 48213 ')).toBe(48213);
    expect(parseSeed(String(MAX_SEED))).toBe(MAX_SEED);
  });

  it('rejects everything else', () => {
    for (const bad of ['', '-1', '1.5', '1e3', 'abc', '12a', String(MAX_SEED + 1), '99999999999999999999']) {
      expect(parseSeed(bad)).toBeNull();
    }
  });
});

describe('settings', () => {
  it('defaults to E Harmonic Minor, 180 BPM, 4 bars, auto style, Mixed Guitar 2, Extreme, strict scale', () => {
    const s = defaultSettings(42);
    expect(s).toEqual({
      key: 'E', scale: 'harmonicMinor', bars: 4, style: 'auto', guitar2Mode: 'mixed', complexity: 'extreme',
      tuning: 'auto', chordChanges: 'auto', chromaticPassing: false, bpm: 180, seed: 42,
    });
  });

  it('offers the chord-changes options and shows both halves in the summary when they differ', () => {
    expect(CHORD_CHANGES_OPTIONS.map((o) => o.label)).toEqual(['Auto', 'Steady', 'Longer chords', 'Repeat on new chord']);
    const r = generateRiff(toGenerateOptions({ ...defaultSettings(4242), key: 'E', scale: 'phrygian', bars: 2, chordChanges: 'repeat' }));
    expect(r.chordChanges).toBe('repeat');
    expect(describeRiff(r)).toMatch(/ · i \| [^ ]+ · /);
  });

  it('passes the tuning to the engine independently of the key', () => {
    const r = generateRiff(toGenerateOptions({ ...defaultSettings(9), key: 'A', tuning: 'dropC' }));
    expect(r.key).toBe('A');
    expect(r.tuning.name).toBe('Drop C');
    expect(r.tuning.rootFret).toBe(9); // A on the low C string
    expect(TUNING_OPTIONS[0]).toEqual({ value: 'auto', label: 'Auto (follows key)' });
    expect(TUNING_OPTIONS).toHaveLength(16);
  });

  it('passes the chromatic passing toggle to the engine and names it in the summary', () => {
    const riff = generateRiff(toGenerateOptions({ ...defaultSettings(9), chromaticPassing: true }));
    expect(riff.chromaticPassing).toBe(true);
    expect(describeRiff(riff)).toMatch(/· chromatic passing$/);
    expect(describeRiff(generateRiff(toGenerateOptions(defaultSettings(9))))).not.toContain('chromatic');
  });

  it('passes complexity through to the engine', () => {
    for (const c of ['simple', 'normal', 'complex', 'extreme'] as const) {
      expect(generateRiff(toGenerateOptions({ ...defaultSettings(9), complexity: c })).complexity).toBe(c);
    }
  });

  it('the same settings regenerate the same riff', () => {
    const s = { ...defaultSettings(1234), key: 'C' as const, scale: 'locrian' as const };
    expect(generateRiff(toGenerateOptions(s))).toEqual(generateRiff(toGenerateOptions({ ...s })));
  });

  it('every select option is accepted by the engine', () => {
    for (const k of KEY_OPTIONS) for (const sc of SCALE_OPTIONS) {
      const s = { ...defaultSettings(5), key: k.value as never, scale: sc.value as never };
      expect(() => generateRiff(toGenerateOptions(s))).not.toThrow();
    }
    for (const st of STYLE_OPTIONS) for (const g2 of GUITAR2_OPTIONS) {
      const s = { ...defaultSettings(5), style: st.value as never, guitar2Mode: g2.value as never };
      expect(() => generateRiff(toGenerateOptions(s))).not.toThrow();
    }
  });

  it('pickOption rejects unknown values', () => {
    expect(pickOption('E', ['E', 'F'])).toBe('E');
    expect(pickOption('H', ['E', 'F'])).toBeNull();
  });

  it('describes what Auto resolved to', () => {
    const riff = generateRiff({ key: 'C', scale: 'phrygian', bpm: 180, bars: 1, seed: 3, style: 'chug', guitar2Mode: 'counter' });
    // C Phrygian i – ♭vii: Cm then B♭m (B♭–D♭–F)
    expect(describeRiff(riff)).toBe('Drop C · Normal chug riff · i – ♭vii · Guitar 2: counter-melody · 1 bar');
    const complex = generateRiff({
      key: 'C', scale: 'phrygian', bpm: 180, bars: 1, seed: 3, complexity: 'extreme', style: 'tremolo', guitar2Mode: 'harmony',
    });
    // Extreme: ♭vii gets a 9th (C), which Guitar 1 plays over it, so it is named with it.
    expect(describeRiff(complex)).toBe('Drop C · Extreme tremolo riff · i – ♭vii(add9) · Guitar 2: harmony · 1 bar');
  });
});
