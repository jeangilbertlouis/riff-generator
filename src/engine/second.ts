import { PROFILES, type ComplexityProfile, type CounterRhythm } from './complexity.ts';
import type { Rng } from './random.ts';
import type { RawNote } from './riff.ts';
import { hasFlatTwo, isInScale, scaleNotesInRange, shiftByScaleSteps } from './theory.ts';
import type { Archetype, Bars, NoteName, ScaleId, SecondGuitarMode } from './types.ts';

export type SecondGuitarContext = {
  key: NoteName;
  scale: ScaleId;
  rng: Rng;
  root: number;
  bars: Bars;
  profile?: ComplexityProfile;
};

/** What "Auto" resolves to for each archetype. Never unison: Guitar 2 always plays its own part. */
export function autoSecondGuitarMode(archetype: Archetype, rng: Rng): SecondGuitarMode {
  switch (archetype) {
    case 'tremolo':
      return rng.chance(0.7) ? 'harmony' : 'octave';
    case 'gallop':
      return rng.chance(0.6) ? 'counter' : 'harmony';
    case 'chug':
      // A lead line over the chugs, or the chugs harmonized.
      return rng.chance(0.6) ? 'counter' : 'harmony';
    case 'breakdown':
      return rng.chance(0.6) ? 'counter' : 'octave';
  }
}

export function deriveGuitar2(g1: RawNote[], mode: SecondGuitarMode, ctx: SecondGuitarContext): RawNote[] {
  switch (mode) {
    case 'octave':
      return g1.map((n) => ({ ...n, midi: n.midi + 12 }));
    case 'harmony':
      return harmonize(g1, ctx);
    case 'counter':
      return counterMelody(ctx);
  }
}

/**
 * Same rhythm, each note moved up by scale degrees (a diatonic 3rd, sometimes a 5th),
 * so the harmony interval changes with the scale. Passing tones keep the last interval.
 */
function harmonize(g1: RawNote[], ctx: SecondGuitarContext): RawNote[] {
  const steps = ctx.scale === 'chromatic' ? 7 : ctx.rng.chance(0.75) ? 2 : 4;
  let lastInterval = ctx.scale === 'chromatic' ? 7 : steps === 2 ? 3 : 7;

  // At higher complexity the interval changes per beat (3rds, 4ths, 5ths). The pattern is chosen
  // for one half of the riff and reused for the other, so the harmony repeats with the riff.
  let beatSteps: number[] | null = null;
  const beatsPerHalf = (ctx.bars * 16) / 2 / 4;
  if (ctx.profile?.harmonyVaries && ctx.scale !== 'chromatic') {
    beatSteps = Array.from({ length: beatsPerHalf }, (_, i) =>
      i === 0 ? steps : ctx.rng.weighted([2, 3, 4], (s) => (s === 2 ? 3 : 1.5)),
    );
  }

  return g1.map((n) => {
    let midi: number;
    if (isInScale(n.midi, ctx.key, ctx.scale)) {
      const s = beatSteps ? (beatSteps[Math.floor(n.step / 4) % beatsPerHalf] as number) : steps;
      midi = shiftByScaleSteps(n.midi, s, ctx.key, ctx.scale);
      lastInterval = midi - n.midi;
    } else {
      midi = n.midi + lastInterval;
    }
    return { ...n, midi, passing: !isInScale(midi, ctx.key, ctx.scale) };
  });
}

/**
 * A higher line over Guitar 1, one window per half bar. It repeats like Guitar 1
 * does (A then A′): for 2+ bars the second half copies the first, except its last window.
 */
function counterMelody(ctx: SecondGuitarContext): RawNote[] {
  const { rng } = ctx;
  const pool = scaleNotesInRange(ctx.key, ctx.scale, ctx.root + 12, ctx.root + 24);
  const rhythm = rng.pick<CounterRhythm>((ctx.profile ?? PROFILES.normal).counterRhythms);
  const totalWindows = (ctx.bars * 16) / 8;
  let current = rng.pick(pool.filter((n) => n >= ctx.root + 15 && n <= ctx.root + 19).concat(ctx.root + 12));

  const nextPitch = (): number => {
    current = rng.weighted(pool, (n) => {
      const d = Math.abs(n - current);
      if (d === 0) return 0.4;
      return d <= 2 ? 5 : d <= 4 ? 3 : d <= 7 ? 1.5 : 0.3;
    });
    return current;
  };

  const renderWindow = (w: number): RawNote[] => {
    const start = w * 8;
    const note = (offset: number, duration: number, midi: number, accent: boolean): RawNote => ({
      step: start + offset,
      duration,
      midi,
      palmMute: false,
      accent,
      passing: false,
    });
    switch (rhythm) {
      case 'sustain':
        return [note(0, 8, nextPitch(), true)];
      case 'halves':
        return [note(0, 4, nextPitch(), true), note(4, 4, nextPitch(), false)];
      case 'tremolo': {
        const out: RawNote[] = [];
        for (let i = 0; i < 8; i++) out.push(note(i, 1, i % 4 === 0 ? nextPitch() : current, i === 0));
        return out;
      }
      case 'eighths':
        return [0, 2, 4, 6].map((o) => note(o, 2, nextPitch(), o === 0));
      case 'threeThreeTwo':
        return [note(0, 3, nextPitch(), true), note(3, 3, nextPitch(), true), note(6, 2, nextPitch(), false)];
    }
  };

  let notes: RawNote[];
  if (ctx.bars === 1) {
    notes = [renderWindow(0), renderWindow(1)].flat();
  } else {
    const half = totalWindows / 2;
    const first: RawNote[] = [];
    for (let w = 0; w < half; w++) first.push(...renderWindow(w));
    const repeat = first
      .filter((n) => n.step < (totalWindows - 1) * 8 - half * 8)
      .map((n) => ({ ...n, step: n.step + half * 8 }));
    current = repeat.at(-1)?.midi ?? current;
    notes = [...first, ...repeat, ...renderWindow(totalWindows - 1)];
  }

  // Resolve to the root (an octave above Guitar 1) or the ♭2.
  const target = hasFlatTwo(ctx.scale) && rng.chance(0.3) ? ctx.root + 13 : ctx.root + 12;
  const lastWindowStart = (totalWindows - 1) * 8;
  const tailPitch = notes.at(-1)?.midi;
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i] as RawNote;
    if (n.step < lastWindowStart || n.midi !== tailPitch) break;
    n.midi = target;
  }
  return notes;
}
