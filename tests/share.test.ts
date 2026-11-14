import { describe, expect, it } from 'vitest';
import { generateRiff } from '../src/engine/generate.ts';
import { GUITAR2_OPTIONS, defaultSettings, toGenerateOptions, type Settings } from '../src/ui/settings.ts';
import { fromQuery, toQuery } from '../src/ui/share.ts';

const defaults = defaultSettings(999);
const custom: Settings = {
  key: 'C#',
  scale: 'harmonicMinor',
  bars: 4,
  style: 'gallop',
  guitar2Mode: 'counter',
  complexity: 'extreme',
  tuning: 'dropB',
  chromaticPassing: true,
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

  it('an empty query gives the defaults (Extreme)', () => {
    expect(fromQuery('', defaults)).toEqual({ settings: defaults, tempo: null });
    expect(defaults.complexity).toBe('extreme');
  });

  it('adds chr=1 only when chromatic passing is on; anything else means off', () => {
    expect(toQuery({ settings: custom, tempo: null })).toContain('chr=1');
    expect(toQuery({ settings: { ...custom, chromaticPassing: false }, tempo: null })).not.toContain('chr');
    expect(fromQuery('?seed=5&chr=1', defaults).settings.chromaticPassing).toBe(true);
    for (const q of ['?seed=5', '?seed=5&chr=0', '?seed=5&chr=yes', '']) {
      expect(fromQuery(q, defaults).settings.chromaticPassing).toBe(false);
    }
  });

  it('an old link with g2=unison falls back to Auto (unison no longer exists)', () => {
    expect(fromQuery('?seed=5&g2=unison', defaults).settings.guitar2Mode).toBe('auto');
    expect(GUITAR2_OPTIONS.map((o) => o.value)).toEqual(['auto', 'harmony', 'counter', 'octave', 'arpeggio']);
  });

  it('adds tun only for a chosen tuning; no tun, an unknown one, or an old link means Auto', () => {
    expect(toQuery({ settings: custom, tempo: null })).toContain('tun=dropB');
    expect(toQuery({ settings: { ...custom, tuning: 'auto' }, tempo: null })).not.toContain('tun=');
    expect(fromQuery('?seed=5&tun=dropC', defaults).settings.tuning).toBe('dropC');
    for (const q of ['?seed=5', '?seed=5&tun=banjo', '']) expect(fromQuery(q, defaults).settings.tuning).toBe('auto');
  });

  it('a link with a tuning regenerates the same riff in that tuning', () => {
    const s: Settings = { ...defaults, key: 'E', tuning: 'dropC', seed: 31 };
    const back = fromQuery(toQuery({ settings: s, tempo: null }), defaultSettings(1)).settings;
    const r = generateRiff(toGenerateOptions(back));
    expect(r.tuning.name).toBe('Drop C');
    expect(r).toEqual(generateRiff(toGenerateOptions(s)));
  });

  it('carries complexity as cx', () => {
    expect(toQuery({ settings: custom, tempo: null })).toContain('cx=extreme');
  });

  it('opens a link from before complexity existed at Normal, so it plays the same riff', () => {
    const old = '?key=A&scale=locrian&bars=2&style=auto&g2=auto&bpm=180&seed=777';
    const state = fromQuery(old, defaults);
    expect(state.settings.complexity).toBe('normal');
    expect(state.settings.chromaticPassing).toBe(false); // old links open with the corrected, in-scale runs
    const original = generateRiff({ key: 'A', scale: 'locrian', bars: 2, bpm: 180, seed: 777 }); // engine defaults
    expect(generateRiff(toGenerateOptions(state.settings))).toEqual(original);
  });

  it('an invalid cx falls back to Normal when the link has a seed, else to the default', () => {
    expect(fromQuery('?seed=5&cx=insane', defaults).settings.complexity).toBe('normal');
    expect(fromQuery('?key=G&cx=insane', defaults).settings.complexity).toBe('extreme');
  });
});
