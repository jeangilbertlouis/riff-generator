import { COMPLEXITIES, NOTE_NAMES, type Archetype, type Bars, type ScaleId, type SecondGuitarMode } from '../engine/types.ts';
import { SCALE_IDS } from '../engine/theory.ts';
import { GUITAR2_LABELS, STYLE_LABELS, parseBpm, parseSeed, pickOption, type Settings } from './settings.ts';

/**
 * What a link carries. `settings.bpm` is the tempo the riff was generated with (it can
 * influence the Auto style); `tempo` is the playback tempo, only when it differs.
 */
export type ShareState = { settings: Settings; tempo: number | null };

export function toQuery({ settings: s, tempo }: ShareState): string {
  const params = new URLSearchParams({
    key: s.key,
    scale: s.scale,
    bars: String(s.bars),
    style: s.style,
    g2: s.guitar2Mode,
    cx: s.complexity,
    bpm: String(s.bpm),
    seed: String(s.seed),
  });
  if (tempo !== null && tempo !== s.bpm) params.set('tempo', String(tempo));
  return `?${params.toString()}`;
}

/**
 * Read a link. Each value is checked on its own; anything missing or invalid falls
 * back to `defaults`, so a bad link never breaks the page.
 */
export function fromQuery(query: string, defaults: Settings): ShareState {
  const p = new URLSearchParams(query);
  const get = (name: string) => p.get(name) ?? '';
  const settings: Settings = {
    key: pickOption(get('key'), NOTE_NAMES) ?? defaults.key,
    scale: pickOption<ScaleId>(get('scale'), SCALE_IDS) ?? defaults.scale,
    bars: (pickOption(get('bars'), ['1', '2', '4']) ? Number(get('bars')) : defaults.bars) as Bars,
    style: pickOption(get('style'), Object.keys(STYLE_LABELS) as (Archetype | 'auto')[]) ?? defaults.style,
    guitar2Mode: pickOption(get('g2'), Object.keys(GUITAR2_LABELS) as (SecondGuitarMode | 'auto')[]) ?? defaults.guitar2Mode,
    // Links from before complexity existed carry a seed but no `cx`: they were made at Normal,
    // so they open at Normal and still play the same riff.
    complexity: pickOption(get('cx'), COMPLEXITIES) ?? (parseSeed(get('seed')) !== null ? 'normal' : defaults.complexity),
    bpm: p.has('bpm') ? parseBpm(get('bpm'), defaults.bpm) : defaults.bpm,
    seed: parseSeed(get('seed')) ?? defaults.seed,
  };
  const tempo = p.has('tempo') ? parseBpm(get('tempo'), settings.bpm) : null;
  return { settings, tempo: tempo === settings.bpm ? null : tempo };
}
