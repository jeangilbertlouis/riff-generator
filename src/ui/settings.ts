import { BPM_MAX, BPM_MIN, DEFAULT_BARS, DEFAULT_BPM } from '../engine/generate.ts';
import { randomSeed } from '../engine/random.ts';
import { SCALES, SCALE_IDS } from '../engine/theory.ts';
import {
  NOTE_NAMES,
  type Archetype,
  type Bars,
  type GenerateOptions,
  type NoteName,
  type Riff,
  type ScaleId,
  type SecondGuitarMode,
} from '../engine/types.ts';

export const MAX_SEED = 0xffffffff;

export type Settings = {
  key: NoteName;
  scale: ScaleId;
  bars: Bars;
  style: Archetype | 'auto';
  guitar2Mode: SecondGuitarMode | 'auto';
  bpm: number;
  seed: number;
};

export const STYLE_LABELS: Record<Archetype | 'auto', string> = {
  auto: 'Auto',
  tremolo: 'Tremolo',
  gallop: 'Gallop',
  chug: 'Chug',
  breakdown: 'Breakdown',
};

export const GUITAR2_LABELS: Record<SecondGuitarMode | 'auto', string> = {
  auto: 'Auto',
  unison: 'Unison',
  harmony: 'Harmony',
  counter: 'Counter-melody',
  octave: 'Octave',
};

export const BARS_OPTIONS: Bars[] = [1, 2, 4];

export function defaultSettings(seed = randomSeed()): Settings {
  return { key: 'E', scale: 'phrygian', bars: DEFAULT_BARS, style: 'auto', guitar2Mode: 'auto', bpm: DEFAULT_BPM, seed };
}

/** Whole number, clamped to the supported range; falls back when the input isn't a number. */
export function parseBpm(input: string, fallback: number): number {
  const trimmed = input.trim();
  const n = Number(trimmed);
  if (trimmed === '' || !Number.isFinite(n)) return fallback;
  return Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(n)));
}

/** A seed is a whole number 0…4294967295; anything else is rejected (null). */
export function parseSeed(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) && n <= MAX_SEED ? n : null;
}

export function toGenerateOptions(s: Settings): GenerateOptions {
  return { key: s.key, scale: s.scale, bpm: s.bpm, bars: s.bars, seed: s.seed, style: s.style, guitar2Mode: s.guitar2Mode };
}

/** One-line summary of what was generated, including what "Auto" resolved to. */
export function describeRiff(riff: Riff): string {
  return [
    riff.tuning.name,
    `${STYLE_LABELS[riff.archetype]} riff`,
    `Guitar 2: ${GUITAR2_LABELS[riff.guitar2Mode].toLowerCase()}`,
    `${riff.bars} bar${riff.bars === 1 ? '' : 's'}`,
  ].join(' · ');
}

export type Option = { value: string; label: string };

export const KEY_OPTIONS: Option[] = NOTE_NAMES.map((k) => ({ value: k, label: k }));
export const SCALE_OPTIONS: Option[] = SCALE_IDS.map((s) => ({ value: s, label: SCALES[s].name }));
export const STYLE_OPTIONS: Option[] = Object.entries(STYLE_LABELS).map(([value, label]) => ({ value, label }));
export const GUITAR2_OPTIONS: Option[] = Object.entries(GUITAR2_LABELS).map(([value, label]) => ({ value, label }));

/** Narrow a string from a <select> back to a typed setting value, rejecting anything unknown. */
export function pickOption<T extends string>(value: string, allowed: readonly T[]): T | null {
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}
