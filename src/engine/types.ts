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

export type SecondGuitarMode = 'unison' | 'harmony' | 'counter' | 'octave';

export type Bars = 1 | 2 | 4;

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
  /** Chromatic passing tone: allowed to sit outside the scale. */
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
  tuning: Tuning;
  guitar1: NoteEvent[];
  guitar2: NoteEvent[];
  guitar2Mode: SecondGuitarMode;
};
