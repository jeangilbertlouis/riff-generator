import { describe, expect, it } from 'vitest';
import { generateRiff } from '../src/engine/generate.ts';
import { defaultSettings, toGenerateOptions, type Settings } from '../src/ui/settings.ts';
import { fromQuery, toQuery } from '../src/ui/share.ts';

const defaults = defaultSettings(999);
const custom: Settings = {
  key: 'C#',
  scale: 'harmonicMinor',
  bars: 4,
  style: 'gallop',
  guitar2Mode: 'counter',
  complexity: 'extreme',
  bpm: 205,
  seed: 4294967295,
};

describe('share links', () => {
  it('round-trips every setting', () => {
    const query = toQuery({ settings: custom, tempo: null });
    expect(fromQuery(query, defaults)).toEqual({ settings: custom, tempo: null });
  });

  it('encodes sharps safely', () => {
    const query = toQuery({ settings: custom, tempo: null });
    expect(query).toContain('key=C%23');
    expect(query).not.toContain('#');
  });

  it('adds tempo only when playback differs from the generation BPM', () => {
    expect(toQuery({ settings: custom, tempo: 205 })).not.toContain('tempo=');
    const q = toQuery({ settings: custom, tempo: 120 });
    expect(q).toContain('tempo=120');
    expect(fromQuery(q, defaults)).toEqual({ settings: custom, tempo: 120 });
  });

  it('a shared link regenerates exactly the same riff', () => {
    const s: Settings = { ...defaults, key: 'A', scale: 'locrian', seed: 777 };
    const back = fromQuery(toQuery({ settings: s, tempo: 90 }), defaultSettings(1)).settings;
    expect(generateRiff(toGenerateOptions(back))).toEqual(generateRiff(toGenerateOptions(s)));
  });

  it('falls back per value on bad input', () => {
    const state = fromQuery('?key=H&scale=lydian&bars=3&style=djent&g2=x&bpm=fast&seed=-5&tempo=abc', defaults);
    expect(state).toEqual({ settings: defaults, tempo: null });
  });

  it('keeps the good values from a partly bad link', () => {
    const state = fromQuery('?key=G&seed=oops&bpm=999', defaults);
    expect(state.settings).toEqual({ ...defaults, key: 'G', bpm: 260 });
  });

  it('an empty query gives the defaults (Complex)', () => {
    expect(fromQuery('', defaults)).toEqual({ settings: defaults, tempo: null });
    expect(defaults.complexity).toBe('complex');
  });

  it('carries complexity as cx', () => {
    expect(toQuery({ settings: custom, tempo: null })).toContain('cx=extreme');
  });

  it('opens a link from before complexity existed at Normal, so it plays the same riff', () => {
    const old = '?key=A&scale=locrian&bars=2&style=auto&g2=auto&bpm=180&seed=777';
    const state = fromQuery(old, defaults);
    expect(state.settings.complexity).toBe('normal');
    const original = generateRiff({ key: 'A', scale: 'locrian', bars: 2, bpm: 180, seed: 777 }); // engine default = Normal
    expect(generateRiff(toGenerateOptions(state.settings))).toEqual(original);
  });

  it('an invalid cx falls back to Normal when the link has a seed, else to the default', () => {
    expect(fromQuery('?seed=5&cx=insane', defaults).settings.complexity).toBe('normal');
    expect(fromQuery('?key=G&cx=insane', defaults).settings.complexity).toBe('complex');
  });
});
