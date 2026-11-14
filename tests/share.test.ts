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

  it('an empty query gives the defaults', () => {
    expect(fromQuery('', defaults)).toEqual({ settings: defaults, tempo: null });
  });
});
