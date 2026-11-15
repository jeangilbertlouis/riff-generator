import { PROFILES, type ArpRhythm, type ComplexityProfile, type CounterRhythm } from './complexity.ts';
import { chordAt, type ChordSlot } from './harmony.ts';
import type { Rng } from './random.ts';
import { arpShape, arpeggioNote, chordLadder, pedalRoot, shapeNote, type RawNote } from './riff.ts';
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

/** The parts Mixed switches between. */
export type MixedPart = 'harmony' | 'counter' | 'arpeggio';
export type Guitar2Section = { step: number; length: number; part: Exclude<SecondGuitarMode, 'mixed'> };

/** Shortest Mixed section: half a bar. */
export const MIN_SECTION = 8;

/** Mixed: how likely each part is for the riff's first section, per style (later sections avoid the previous part). */
const MIXED_WEIGHTS: Record<Archetype, [MixedPart, number][]> = {
  chug: [['arpeggio', 40], ['counter', 40], ['harmony', 20]],
  tremolo: [['harmony', 50], ['arpeggio', 30], ['counter', 20]],
  gallop: [['counter', 45], ['harmony', 30], ['arpeggio', 25]],
  breakdown: [['arpeggio', 50], ['counter', 35], ['harmony', 15]],
};

/**
 * Split one half of the riff [from, to) at its chord changes, merging any piece shorter than
 * MIN_SECTION into its neighbour (the one before, or the next for the first piece).
 */
function splitHalf(chords: ChordSlot[], from: number, to: number): [number, number][] {
  const starts = [...new Set([from, ...chords.map((c) => c.step).filter((s) => s > from && s < to)])].sort((a, b) => a - b);
  let pieces: [number, number][] = starts.map((s, i) => [s, starts[i + 1] ?? to]);
  const merged: [number, number][] = [];
  for (const piece of pieces) {
    const last = merged.at(-1);
    if (last && piece[1] - piece[0] < MIN_SECTION) last[1] = piece[1];
    else merged.push([...piece]);
  }
  pieces = merged;
  if (pieces.length > 1 && pieces[0]![1] - pieces[0]![0] < MIN_SECTION) {
    pieces[1]![0] = pieces[0]![0];
    pieces.shift();
  }
  return pieces;
}

/**
 * Plan Mixed's sections: split each half at chord changes, then give each section a part, never the
 * same part twice in a row. A′ mirrors A's parts when A has 2+ sections (and the seam allows it).
 */
export function mixedSections(chords: ChordSlot[], total: number, archetype: Archetype, rng: Rng): Guitar2Section[] {
  const half = total / 2;
  const a = splitHalf(chords, 0, half);
  const b = splitHalf(chords, half, total);
  const weights = MIXED_WEIGHTS[archetype];
  const used = new Set<MixedPart>();
  // Never the previous section's part; and a part not heard yet in this riff is 3× as likely.
  const pick = (avoid: MixedPart | null): MixedPart => {
    const part = rng.weighted(weights.filter(([p]) => p !== avoid), ([p, w]) => (used.has(p) ? w : w * 3))[0];
    used.add(part);
    return part;
  };

  const partsA: MixedPart[] = [];
  for (let i = 0; i < a.length; i++) partsA.push(pick(partsA[i - 1] ?? null));

  let partsB: MixedPart[];
  const canMirror = a.length >= 2 && b.length === a.length && partsA[0] !== partsA.at(-1);
  if (canMirror) {
    // A′ repeats A's parts, but its last section (where the riff varies anyway) brings in the part
    // not heard yet, so the riff gets all three.
    partsB = [...partsA];
    const unused = (['harmony', 'counter', 'arpeggio'] as MixedPart[]).find((p) => !used.has(p));
    if (unused) partsB[partsB.length - 1] = unused;
  } else {
    partsB = [];
    for (let i = 0; i < b.length; i++) partsB.push(pick(i === 0 ? (partsA.at(-1) as MixedPart) : (partsB[i - 1] as MixedPart)));
  }

  return [
    ...a.map(([s, e], i): Guitar2Section => ({ step: s, length: e - s, part: partsA[i] as MixedPart })),
    ...b.map(([s, e], i): Guitar2Section => ({ step: s, length: e - s, part: partsB[i] as MixedPart })),
  ];
}

/**
 * Mixed Guitar 2: generate each part for the whole riff, then let every section take the notes
 * of its part that start inside it, cut at the section's end so parts never overlap.
 */
export function mixedGuitar2(
  g1: RawNote[],
  ctx: SecondGuitarContext,
  archetype: Archetype,
): { notes: RawNote[]; sections: Guitar2Section[] } {
  const total = ctx.bars * 16;
  const chords = ctx.chords && ctx.chords.length > 0 ? ctx.chords : [];
  const sections = mixedSections(chords, total, archetype, ctx.rng);
  const parts: Record<MixedPart, RawNote[]> = {
    harmony: harmonize(g1, ctx),
    counter: counterMelody(ctx),
    arpeggio: arpeggioPart(ctx),
  };
  const notes: RawNote[] = [];
  for (const sec of sections) {
    const end = sec.step + sec.length;
    for (const n of parts[sec.part as MixedPart]) {
      if (n.step < sec.step || n.step >= end) continue;
      notes.push({ ...n, duration: Math.min(n.duration, end - n.step) });
    }
  }
  return { notes, sections };
}

export function deriveGuitar2(g1: RawNote[], mode: Exclude<SecondGuitarMode, 'mixed'>, ctx: SecondGuitarContext): RawNote[] {
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
      if (!chord) return w;
      // Chord tones ×4; the flavour tone (Extreme) ×2, as colour.
      return chord.tones.includes(pc(n)) ? w * 4 : chord.flavour === pc(n) ? w * 2 : w;
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
  // Extreme only. With a 4-note chord, tone 3 is the flavour tone and 4 the octave.
  roll: { tones: [0, 1, 2, 3, 4, 3, 2, 1], duration: 1 }, // up and back down
  skip: { tones: [0, 2, 1, 3, 2, 4, 3, 1], duration: 1 }, // broken thirds
  sweep: { tones: [0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1], duration: 1 }, // wide sweep, 3 beats long against the 4/4
};

/**
 * Guitar 2 arpeggiates the progression an octave or more above Guitar 1's pedal: each chord
 * restarts the pattern from its root. It follows the chords across the whole riff (when both
 * halves have the same chords, the second half comes out identical to the first).
 */
function arpeggioPart(ctx: SecondGuitarContext): RawNote[] {
  const profile = ctx.profile ?? PROFILES.normal;
  if (profile.arpVaries) return extendedArpeggioPart(ctx, profile);
  const pattern = ARP_PATTERNS[ctx.rng.pick(profile.arpRhythms)];
  const pool = scaleNotesInRange(ctx.key, ctx.scale, ctx.root + 12, ctx.root + 24);
  const total = ctx.bars * 16;
  const chords = ctx.chords && ctx.chords.length > 0 ? ctx.chords : null;
  const slots = chords
    ? chords
    : [{ step: 0, length: total, rootPc: pc(ctx.root), tones: [pc(ctx.root), pc(ctx.root + 3), pc(ctx.root + 7)] }];

  const notes: RawNote[] = [];
  for (const slot of slots) {
    const ladder = chordLadder(pool, slot as ChordSlot);
    const base = ladder.find((n) => pc(n) === slot.rootPc) ?? ladder[0] ?? ctx.root + 12;
    let k = 0;
    for (let s = slot.step; s < Math.min(slot.step + slot.length, total); s += pattern.duration, k++) {
      notes.push({
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
  return notes;
}

/**
 * Extreme's Arpeggio mode: each chord gets its own pattern and inversion (kept wherever that chord
 * comes back, so repeats sound the same), over a wider range, and 4-note chords play their flavour tone.
 */
function extendedArpeggioPart(ctx: SecondGuitarContext, profile: ComplexityProfile): RawNote[] {
  const total = ctx.bars * 16;
  const low = ctx.root + 12;
  const high = Math.min(ctx.high ?? Infinity, low + profile.arpRange);
  const slots: Pick<ChordSlot, 'step' | 'length' | 'rootPc' | 'tones' | 'flavour' | 'degree'>[] =
    ctx.chords && ctx.chords.length > 0
      ? ctx.chords
      : [{ step: 0, length: total, degree: 0, rootPc: pc(ctx.root), tones: [pc(ctx.root), pc(ctx.root + 3), pc(ctx.root + 7)] }];

  const choices = new Map<number, { pattern: { tones: number[]; duration: number }; shift: number }>();
  const notes: RawNote[] = [];
  for (const slot of slots) {
    let choice = choices.get(slot.degree);
    if (!choice) {
      choice = {
        pattern: ARP_PATTERNS[ctx.rng.pick(profile.arpRhythms)],
        shift: ctx.rng.weighted([0, 1, 2], (s) => (s === 0 ? 3 : 1)),
      };
      choices.set(slot.degree, choice);
    }
    const { pattern, shift } = choice;
    const shape = arpShape(slot);
    const base = low + pc(slot.rootPc - low);
    let k = 0;
    for (let s = slot.step; s < Math.min(slot.step + slot.length, total); s += pattern.duration, k++) {
      notes.push({
        step: s,
        duration: Math.min(pattern.duration, slot.step + slot.length - s),
        midi: shapeNote(base, shape, (pattern.tones[k % pattern.tones.length] as number) + shift, low, high),
        palmMute: false,
        accent: s === slot.step,
        passing: false,
      });
    }
  }
  return notes;
}
