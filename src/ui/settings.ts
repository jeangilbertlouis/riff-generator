import { BPM_MAX, BPM_MIN, DEFAULT_BPM } from '../engine/generate.ts';
import { romanProgression } from '../engine/harmony.ts';
import { randomSeed } from '../engine/random.ts';
import { SCALES, SCALE_IDS } from '../engine/theory.ts';
import { TUNINGS, TUNING_IDS } from '../engine/tuning.ts';
import {
  COMPLEXITIES,
  NOTE_NAMES,
  type Archetype,
  type Bars,
  type ChordChanges,
  type Complexity,
  type GenerateOptions,
  type NoteName,
  type Riff,
  type ScaleId,
  type TuningId,
  type SecondGuitarMode,
} from '../engine/types.ts';

export const MAX_SEED = 0xffffffff;

export type Settings = {
  key: NoteName;
  scale: ScaleId;
  bars: Bars;
  style: Archetype | 'auto';
  guitar2Mode: SecondGuitarMode | 'auto';
  complexity: Complexity;
  /** Guitar tuning, or 'auto' to follow the key. */
  tuning: TuningId | 'auto';
  /** How the chords move, or 'auto' to pick per riff. */
  chordChanges: ChordChanges | 'auto';
  /** Runs may leave the scale by semitones. Off: every note stays in the chosen scale. */
  chromaticPassing: boolean;
  bpm: number;
  seed: number;
};

export const COMPLEXITY_LABELS: Record<Complexity, string> = {
  simple: 'Simple',
  normal: 'Normal',
  complex: 'Complex',
  extreme: 'Extreme',
};

/** The UI starts at Extreme; the engine (and old share links) default to Normal. */
export const DEFAULT_COMPLEXITY: Complexity = 'extreme';

export const STYLE_LABELS: Record<Archetype | 'auto', string> = {
  auto: 'Auto',
  tremolo: 'Tremolo',
  gallop: 'Gallop',
  chug: 'Chug',
  breakdown: 'Breakdown',
};

export const GUITAR2_LABELS: Record<SecondGuitarMode | 'auto', string> = {
  auto: 'Auto',
  harmony: 'Harmony',
  counter: 'Counter-melody',
  octave: 'Octave',
  arpeggio: 'Arpeggio',
};

export const BARS_OPTIONS: Bars[] = [1, 2, 4];

export function defaultSettings(seed = randomSeed()): Settings {
  return {
    key: 'E',
    scale: 'harmonicMinor',
    bars: 4,
    style: 'auto',
    guitar2Mode: 'auto',
    complexity: DEFAULT_COMPLEXITY,
    tuning: 'auto',
    chordChanges: 'auto',
    chromaticPassing: false,
    bpm: DEFAULT_BPM,
    seed,
  };
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
  return {
    key: s.key,
    scale: s.scale,
    bpm: s.bpm,
    bars: s.bars,
    seed: s.seed,
    style: s.style,
    guitar2Mode: s.guitar2Mode,
    complexity: s.complexity,
    tuning: s.tuning,
    chordChanges: s.chordChanges,
    chromaticPassing: s.chromaticPassing,
  };
}

/** One-line summary of what was generated, including what "Auto" resolved to. */
export function describeRiff(riff: Riff): string {
  return [
    riff.tuning.name,
    `${COMPLEXITY_LABELS[riff.complexity]} ${STYLE_LABELS[riff.archetype].toLowerCase()} riff`,
    romanProgression(riff.progression),
    `Guitar 2: ${GUITAR2_LABELS[riff.guitar2Mode].toLowerCase()}`,
    `${riff.bars} bar${riff.bars === 1 ? '' : 's'}`,
    ...(riff.chromaticPassing ? ['chromatic passing'] : []),
  ].join(' · ');
}

export type Option = { value: string; label: string };

export const KEY_OPTIONS: Option[] = NOTE_NAMES.map((k) => ({ value: k, label: k }));
export const SCALE_OPTIONS: Option[] = SCALE_IDS.map((s) => ({ value: s, label: SCALES[s].name }));
export const STYLE_OPTIONS: Option[] = Object.entries(STYLE_LABELS).map(([value, label]) => ({ value, label }));
export const GUITAR2_OPTIONS: Option[] = Object.entries(GUITAR2_LABELS).map(([value, label]) => ({ value, label }));
export const TUNING_OPTIONS: Option[] = [
  { value: 'auto', label: 'Auto (follows key)' },
  ...TUNING_IDS.map((id) => ({ value: id, label: TUNINGS[id].name })),
];
export const CHORD_CHANGES_LABELS: Record<ChordChanges | 'auto', string> = {
  auto: 'Auto',
  steady: 'Steady',
  longer: 'Longer chords',
  repeat: 'Repeat on new chord',
};
export const CHORD_CHANGES_OPTIONS: Option[] = Object.entries(CHORD_CHANGES_LABELS).map(([value, label]) => ({ value, label }));
export const COMPLEXITY_OPTIONS: Option[] = COMPLEXITIES.map((c) => ({ value: c, label: COMPLEXITY_LABELS[c] }));

/** Narrow a string from a <select> back to a typed setting value, rejecting anything unknown. */
export function pickOption<T extends string>(value: string, allowed: readonly T[]): T | null {
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}
