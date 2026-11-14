import { describe, expect, it } from 'vitest';
import { generateRiff } from '../src/engine/generate.ts';
import {
  GUITAR2_OPTIONS,
  KEY_OPTIONS,
  MAX_SEED,
  SCALE_OPTIONS,
  STYLE_OPTIONS,
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
  it('defaults to E Phrygian, 180 BPM, 2 bars, auto style and Guitar 2', () => {
    const s = defaultSettings(42);
    expect(s).toEqual({ key: 'E', scale: 'phrygian', bars: 2, style: 'auto', guitar2Mode: 'auto', bpm: 180, seed: 42 });
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
    expect(describeRiff(riff)).toBe('Drop C · Chug riff · Guitar 2: counter-melody · 1 bar');
  });
});
