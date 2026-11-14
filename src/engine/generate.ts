import { PROFILES } from './complexity.ts';
import { Rng, randomSeed } from './random.ts';
import { chooseArchetype, generateGuitar1, makeMelodyContext } from './riff.ts';
import { autoSecondGuitarMode, deriveGuitar2 } from './second.ts';
import { SCALES } from './theory.ts';
import { assignTabPositions, highestPlayable, rootMidi, tuningForKey } from './tuning.ts';
import { COMPLEXITIES, NOTE_NAMES, type GenerateOptions, type Riff } from './types.ts';

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
  const tuning = tuningForKey(key);
  const root = rootMidi(tuning, key);

  const archetype = !options.style || options.style === 'auto' ? chooseArchetype(bpm, rng) : options.style;
  const chromaticPassing = options.chromaticPassing ?? false;
  const ctx = makeMelodyContext(key, scale, root, highestPlayable(tuning), rng, profile, chromaticPassing);
  const g1 = generateGuitar1(ctx, archetype, bars);

  const requested = options.guitar2Mode ?? 'auto';
  const guitar2Mode = requested === 'auto' ? autoSecondGuitarMode(archetype, rng) : requested;
  const g2 = deriveGuitar2(g1, guitar2Mode, { key, scale, rng, root, bars, profile });

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
    tuning,
    guitar1: assignTabPositions(g1, tuning),
    guitar2: assignTabPositions(g2, tuning),
    guitar2Mode,
  };
}
