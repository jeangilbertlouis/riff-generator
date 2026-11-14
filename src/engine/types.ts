export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
export type NoteName = (typeof NOTE_NAMES)[number];

export type ScaleId =
  | 'phrygian'
  | 'phrygianDominant'
  | 'locrian'
  | 'naturalMinor'
  | 'harmonicMinor'
  | 'diminished'
  | 'chromatic';

/** Riff archetype: decides which rhythm cells are used and the Guitar 2 default. */
export type Archetype = 'tremolo' | 'gallop' | 'chug' | 'breakdown';

/** What Guitar 2 plays. There is deliberately no unison: Guitar 2 always has its own part. */
export type SecondGuitarMode = 'harmony' | 'counter' | 'octave' | 'arpeggio';

/** A chord over a span of the riff (see harmony.ts). */
export type ChordSlot = {
  step: number;
  length: number;
  degree: number;
  rootPc: number;
  tones: number[];
  quality: 'minor' | 'major' | 'diminished' | 'augmented';
  roman: string;
  name: string;
};

export type Bars = 1 | 2 | 4;

export const COMPLEXITIES = ['simple', 'normal', 'complex', 'extreme'] as const;
export type Complexity = (typeof COMPLEXITIES)[number];

export type Tuning = {
  name: string;
  /** Open-string MIDI pitches, index 0 = string 1 (highest) … last = lowest string. */
  openStrings: number[];
  /** Fret on the lowest string where the key's root sits (0 = open string). */
  rootFret: number;
};

export type NoteEvent = {
  /** Start position on the 16th-note grid, from 0. */
  step: number;
  /** Length in 16th notes. Gaps between events are rests. */
  duration: number;
  midi: number;
  palmMute: boolean;
  accent: boolean;
  /** Chromatic passing tone, outside the scale. Only when `chromaticPassing` is on. */
  passing: boolean;
  /** Tab string, 1 = highest string. */
  string: number;
  fret: number;
};

export type GenerateOptions = {
  key: NoteName;
  scale: ScaleId;
  bpm: number;
  bars?: Bars;
  seed?: number;
  style?: Archetype | 'auto';
  guitar2Mode?: SecondGuitarMode | 'auto';
  /** Defaults to 'normal', which reproduces riffs from before complexity existed. */
  complexity?: Complexity;
  /**
   * Let runs step by semitones, outside the scale (flagged `passing`). Default false: every
   * note stays in the chosen scale.
   */
  chromaticPassing?: boolean;
};

export type Riff = {
  key: NoteName;
  scale: ScaleId;
  bpm: number;
  seed: number;
  bars: Bars;
  timeSignature: [number, number];
  /** Number of 16th steps in the whole riff. */
  totalSteps: number;
  archetype: Archetype;
  complexity: Complexity;
  chromaticPassing: boolean;
  /** The chord progression under the riff: one half's chords, repeated in the second half. */
  progression: ChordSlot[];
  /** A simple drum beat for playback, derived from the style and Guitar 1 (see drums.ts). */
  drums: { step: number; piece: 'kick' | 'snare' | 'hat' | 'crash'; accent: boolean }[];
  tuning: Tuning;
  guitar1: NoteEvent[];
  guitar2: NoteEvent[];
  guitar2Mode: SecondGuitarMode;
};
