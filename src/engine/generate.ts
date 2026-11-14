import { PROFILES } from './complexity.ts';
import { generateDrums } from './drums.ts';
import { autoChordChanges, chooseProgression } from './harmony.ts';
import { voicePad } from './pad.ts';
import { Rng, randomSeed } from './random.ts';
import { chooseArchetype, generateGuitar1, makeMelodyContext } from './riff.ts';
import { autoSecondGuitarMode, deriveGuitar2 } from './second.ts';
import { SCALES } from './theory.ts';
import { TUNING_IDS, assignTabPositions, highestPlayable, rootMidi, tuningFor } from './tuning.ts';
import { CHORD_CHANGES, COMPLEXITIES, NOTE_NAMES, type GenerateOptions, type Riff } from './types.ts';

export const BPM_MIN = 60;
export const BPM_MAX = 260;
export const DEFAULT_BPM = 180;
export const DEFAULT_BARS = 2;

/** Turn (key, scale, bpm, seed, …) into a two-guitar riff with tab positions. Same options + seed → same riff. */
export function generateRiff(options: GenerateOptions): Riff {
  const { key, scale, bpm } = options;
  const bars = options.bars ?? DEFAULT_BARS;
  const seed = options.seed ?? randomSeed();

  if (!NOTE_NAMES.includes(key)) throw new RangeError(`Unknown key: ${key}`);
  if (!(scale in SCALES)) throw new RangeError(`Unknown scale: ${scale}`);
  if (!Number.isFinite(bpm) || bpm < BPM_MIN || bpm > BPM_MAX) {
    throw new RangeError(`BPM must be between ${BPM_MIN} and ${BPM_MAX}`);
  }
  if (![1, 2, 4].includes(bars)) throw new RangeError('Bars must be 1, 2 or 4');
  const complexity = options.complexity ?? 'normal';
  if (!COMPLEXITIES.includes(complexity)) throw new RangeError(`Unknown complexity: ${complexity}`);
  const profile = PROFILES[complexity];

  const rng = new Rng(seed);
  const tuningChoice = options.tuning ?? 'auto';
  if (tuningChoice !== 'auto' && !TUNING_IDS.includes(tuningChoice)) throw new RangeError(`Unknown tuning: ${tuningChoice}`);
  const tuning = tuningFor(key, tuningChoice);
  const root = rootMidi(tuning, key);

  const archetype = !options.style || options.style === 'auto' ? chooseArchetype(bpm, rng) : options.style;
  const chromaticPassing = options.chromaticPassing ?? false;
  const changesChoice = options.chordChanges ?? 'steady';
  if (changesChoice !== 'auto' && !CHORD_CHANGES.includes(changesChoice)) {
    throw new RangeError(`Unknown chord changes: ${changesChoice}`);
  }
  const chordChanges = changesChoice === 'auto' ? autoChordChanges(seed, complexity === 'simple') : changesChoice;
  const progression = chooseProgression(key, scale, bars, profile, rng, chordChanges);
  const ctx = makeMelodyContext(key, scale, root, highestPlayable(tuning), rng, profile, chromaticPassing, progression);
  const g1 = generateGuitar1(ctx, archetype, bars);

  const requested = options.guitar2Mode ?? 'auto';
  const guitar2Mode = requested === 'auto' ? autoSecondGuitarMode(archetype, rng) : requested;
  const g2 = deriveGuitar2(g1, guitar2Mode, {
    key, scale, rng, root, bars, profile, chords: progression, high: highestPlayable(tuning),
  });

  return {
    key,
    scale,
    bpm,
    seed,
    bars,
    timeSignature: [4, 4],
    totalSteps: bars * 16,
    archetype,
    complexity,
    chromaticPassing,
    progression,
    chordChanges,
    // Derived from the progression without randomness, so the riff itself is unchanged.
    pad: voicePad(progression, root),
    // Derived after both guitars and without randomness, so the riff itself is unchanged.
    drums: generateDrums({ archetype, totalSteps: bars * 16, guitar1: g1 }),
    tuning,
    // `pedal` is internal bookkeeping for the repeat; it isn't part of a note.
    guitar1: assignTabPositions(g1.map(({ pedal: _pedal, ...n }) => n), tuning),
    guitar2: assignTabPositions(g2.map(({ pedal: _pedal, ...n }) => n), tuning),
    guitar2Mode,
  };
}
