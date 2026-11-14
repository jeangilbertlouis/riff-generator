import { PROFILES, type ArpRhythm, type ComplexityProfile, type CounterRhythm } from './complexity.ts';
import { chordAt, type ChordSlot } from './harmony.ts';
import type { Rng } from './random.ts';
import { arpeggioNote, chordLadder, pedalRoot, type RawNote } from './riff.ts';
import { isInScale, pc, scaleNotesInRange, shiftByScaleSteps } from './theory.ts';
import type { Archetype, Bars, NoteName, ScaleId, SecondGuitarMode } from './types.ts';

export type SecondGuitarContext = {
  key: NoteName;
  scale: ScaleId;
  rng: Rng;
  root: number;
  bars: Bars;
  profile?: ComplexityProfile;
  /** The riff's chord progression; without it, the part works against the tonic only. */
  chords?: ChordSlot[];
  /** Highest playable pitch (top string, fret 22); parts must stay at or below it. */
  high?: number;
};

/** Auto's choice per style, as weights. Never unison: Guitar 2 always plays its own part. */
export const AUTO_GUITAR2: Record<Archetype, [SecondGuitarMode, number][]> = {
  tremolo: [['harmony', 60], ['octave', 25], ['arpeggio', 15]],
  gallop: [['counter', 40], ['harmony', 30], ['arpeggio', 30]],
  chug: [['arpeggio', 40], ['counter', 35], ['harmony', 25]],
  breakdown: [['arpeggio', 45], ['counter', 35], ['octave', 20]],
};

/** What "Auto" resolves to for each archetype. */
export function autoSecondGuitarMode(archetype: Archetype, rng: Rng): SecondGuitarMode {
  return rng.weighted(AUTO_GUITAR2[archetype], ([, w]) => w)[0];
}

export function deriveGuitar2(g1: RawNote[], mode: SecondGuitarMode, ctx: SecondGuitarContext): RawNote[] {
  switch (mode) {
    case 'octave':
      return g1.map((n) => {
        // In a low tuning with a high root, an octave up can pass fret 22: play a diatonic 3rd there instead.
        if (ctx.high === undefined || n.midi + 12 <= ctx.high) return { ...n, midi: n.midi + 12 };
        const third = isInScale(n.midi, ctx.key, ctx.scale) ? shiftByScaleSteps(n.midi, 2, ctx.key, ctx.scale) : n.midi + 3;
        return { ...n, midi: third, passing: !isInScale(third, ctx.key, ctx.scale) };
      });
    case 'harmony':
      return harmonize(g1, ctx);
    case 'counter':
      return counterMelody(ctx);
    case 'arpeggio':
      return arpeggioPart(ctx);
  }
}

/** The chord at a step (the tonic chord when no progression was given). */
function chordFor(ctx: SecondGuitarContext, step: number): ChordSlot | null {
  return ctx.chords && ctx.chords.length > 0 ? chordAt(ctx.chords, step) : null;
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
 * A higher line over Guitar 1, one window per half bar, favouring tones of the chord under
 * each note. It repeats like Guitar 1 does (A then A′): for 2+ bars the second half copies
 * the first, except its last window. It resolves to the final chord's root.
 */
function counterMelody(ctx: SecondGuitarContext): RawNote[] {
  const { rng } = ctx;
  const pool = scaleNotesInRange(ctx.key, ctx.scale, ctx.root + 12, ctx.root + 24);
  const rhythm = rng.pick<CounterRhythm>((ctx.profile ?? PROFILES.normal).counterRhythms);
  const totalWindows = (ctx.bars * 16) / 8;
  let current = rng.pick(pool.filter((n) => n >= ctx.root + 15 && n <= ctx.root + 19).concat(ctx.root + 12));

  const nextPitch = (step: number): number => {
    const chord = chordFor(ctx, step);
    current = rng.weighted(pool, (n) => {
      const d = Math.abs(n - current);
      const w = d === 0 ? 0.4 : d <= 2 ? 5 : d <= 4 ? 3 : d <= 7 ? 1.5 : 0.3;
      return chord && chord.tones.includes(pc(n)) ? w * 4 : w;
    });
    return current;
  };

  const renderWindow = (w: number): RawNote[] => {
    const start = w * 8;
    const note = (offset: number, duration: number, accent: boolean, hold = false): RawNote => ({
      step: start + offset,
      duration,
      midi: hold ? current : nextPitch(start + offset),
      palmMute: false,
      accent,
      passing: false,
    });
    switch (rhythm) {
      case 'sustain':
        return [note(0, 8, true)];
      case 'halves':
        return [note(0, 4, true), note(4, 4, false)];
      case 'tremolo': {
        const out: RawNote[] = [];
        for (let i = 0; i < 8; i++) out.push(note(i, 1, i === 0, i % 4 !== 0));
        return out;
      }
      case 'eighths':
        return [0, 2, 4, 6].map((o) => note(o, 2, o === 0));
      case 'threeThreeTwo':
        return [note(0, 3, true), note(3, 3, true), note(6, 2, false)];
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

  // Resolve to the root of the chord under the last note's attack, an octave above Guitar 1's pedal.
  const lastChord = chordFor(ctx, notes.at(-1)?.step ?? 0);
  const target = lastChord ? pedalRoot(ctx.root, lastChord) + 12 : ctx.root + 12;
  const lastWindowStart = (totalWindows - 1) * 8;
  const tailPitch = notes.at(-1)?.midi;
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i] as RawNote;
    if (n.step < lastWindowStart || n.midi !== tailPitch) break;
    n.midi = target;
  }
  return notes;
}

/** Tone patterns per arpeggio rhythm (indices into the chord's tones, from its root). */
const ARP_PATTERNS: Record<ArpRhythm, { tones: number[]; duration: number }> = {
  eighths: { tones: [0, 1, 2, 1], duration: 2 },
  sixteenths: { tones: [0, 1, 2, 3, 2, 1], duration: 1 },
  tremoloPairs: { tones: [0, 0, 1, 1, 2, 2, 1, 1], duration: 1 },
};

/**
 * Guitar 2 arpeggiates the progression an octave or more above Guitar 1's pedal: each chord
 * restarts the pattern from its root. The first half is generated and repeated, like the riff.
 */
function arpeggioPart(ctx: SecondGuitarContext): RawNote[] {
  const profile = ctx.profile ?? PROFILES.normal;
  const pattern = ARP_PATTERNS[ctx.rng.pick(profile.arpRhythms)];
  const pool = scaleNotesInRange(ctx.key, ctx.scale, ctx.root + 12, ctx.root + 24);
  const total = ctx.bars * 16;
  const half = total / 2;
  const chords = ctx.chords && ctx.chords.length > 0 ? ctx.chords : null;
  const slots = chords
    ? chords.filter((s) => s.step < half)
    : [{ step: 0, length: half, rootPc: pc(ctx.root), tones: [pc(ctx.root), pc(ctx.root + 3), pc(ctx.root + 7)] }];

  const first: RawNote[] = [];
  for (const slot of slots) {
    const ladder = chordLadder(pool, slot as ChordSlot);
    const base = ladder.find((n) => pc(n) === slot.rootPc) ?? ladder[0] ?? ctx.root + 12;
    let k = 0;
    for (let s = slot.step; s < Math.min(slot.step + slot.length, half); s += pattern.duration, k++) {
      first.push({
        step: s,
        duration: Math.min(pattern.duration, slot.step + slot.length - s),
        midi: arpeggioNote(ladder, base, pattern.tones[k % pattern.tones.length] as number),
        palmMute: false,
        // Accent only where the chord changes: steady accents on every beat pushed peaks into the limiter.
        accent: s === slot.step,
        passing: false,
      });
    }
  }
  return [...first, ...first.map((n) => ({ ...n, step: n.step + half }))];
}
