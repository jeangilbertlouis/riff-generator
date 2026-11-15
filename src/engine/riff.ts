import { GROUPINGS, PROFILES, type ComplexityProfile } from './complexity.ts';
import { chordAt, chordOnDegree, type Chord, type ChordSlot } from './harmony.ts';
import { ARCHETYPE_CELLS, CELLS, GROUP_CELLS, archetypeWeights, type Cell, type Hit, type Weighted } from './rhythm.ts';
import type { Rng } from './random.ts';
import { degreeOf, isInScale, pc, scaleNotesInRange } from './theory.ts';
import type { Archetype, Bars, Complexity, NoteEvent, NoteName, ScaleId } from './types.ts';

/**
 * A note before it has a tab position. `pedal` marks pedal notes (the chord root, or a note held
 * from it): when A′ repeats A over a different chord, those follow the new chord.
 */
export type RawNote = Omit<NoteEvent, 'string' | 'fret'> & { pedal?: boolean };

export type MelodyContext = {
  key: NoteName;
  scale: ScaleId;
  rng: Rng;
  /** Lowest root note (open low string). */
  root: number;
  /** Scale notes Guitar 1 may use, ascending, from the root up to the profile's range. */
  pool: number[];
  profile: ComplexityProfile;
  /** Runs step by semitones (outside the scale) instead of scale steps. Off by default. */
  chromaticPassing: boolean;
  /** The chord progression laid over the riff. */
  chords: ChordSlot[];
};

type MelodyState = {
  current: number;
  /** Pitch before `current` (for trills). */
  previous: number;
  passing: boolean;
  chromDir: number;
  /** Where the current arpeggio is anchored (a chord root). */
  arpBase: number;
  /** Extreme: the current arpeggio's inversion (0 starts on the root, 1 on the 3rd, 2 on the 5th). */
  arpShift: number;
  /** Start step of the chord under the previous note (to notice chord changes). */
  chordStep: number;
  /** Whether the previous note was a pedal note (so a hold of it is one too). */
  pedal: boolean;
};

/** Steps of the phrase that change between A and A′. */
export function variationLength(bars: Bars, complexity: Complexity = 'normal'): number {
  return PROFILES[complexity].variation(bars);
}

export function chooseArchetype(bpm: number, rng: Rng): Archetype {
  const weights = archetypeWeights(bpm);
  const all = Object.keys(weights) as Archetype[];
  return rng.weighted(all, (a) => weights[a]);
}

export function makeMelodyContext(
  key: NoteName,
  scale: ScaleId,
  root: number,
  high: number,
  rng: Rng,
  profile: ComplexityProfile = PROFILES.normal,
  chromaticPassing = false,
  chords?: ChordSlot[],
): MelodyContext {
  return {
    key,
    scale,
    rng,
    root,
    profile,
    chromaticPassing,
    // Without a progression, the tonic chord holds for the whole riff.
    chords: chords ?? [{ ...chordOnDegree(key, scale, 0), step: 0, length: Number.MAX_SAFE_INTEGER }],
    pool: scaleNotesInRange(key, scale, root, Math.min(root + profile.range, high)),
  };
}

/** The chord's root in the low register: the lowest pitch at or above the key's root. */
export function pedalRoot(root: number, chord: Chord): number {
  return root + pc(chord.rootPc - root);
}

const isChordTone = (midi: number, chord: Chord) => chord.tones.includes(pc(midi));

/** The style's cell pool, adjusted by the complexity profile. Normal returns the original pool unchanged. */
export function cellPool(archetype: Archetype, profile: ComplexityProfile): Weighted[] {
  const base = ARCHETYPE_CELLS[archetype];
  const extra = profile.extraCells[archetype] ?? [];
  if (profile.removeCells.length === 0 && extra.length === 0) return base;
  return [...base.filter(([id]) => !profile.removeCells.includes(id)), ...extra];
}

/** Pick cells that fill exactly `length` steps. */
export function fillCells(
  length: number,
  archetype: Archetype,
  rng: Rng,
  isRiffStart: boolean,
  profile: ComplexityProfile = PROFILES.normal,
): Cell[] {
  const pool = cellPool(archetype, profile);
  const cells: Cell[] = [];
  let remaining = length;
  while (remaining > 0) {
    // Odd groupings: split 8, 12 or 16 steps into 3s/5s/6s so accents drift across the beat.
    if (profile.groupingChance > 0 && remaining >= 8 && rng.chance(profile.groupingChance)) {
      const span = rng.pick(([8, 12, 16] as const).filter((s) => s <= remaining));
      for (const groupLength of rng.pick(GROUPINGS[span])) {
        cells.push(groupCell(groupLength, archetype, pool, rng));
      }
      remaining -= span;
      continue;
    }
    const prev = cells.at(-1);
    const options = pool.filter(([id]) => {
      const cell = CELLS[id] as Cell;
      if (cell.length > remaining) return false;
      // Rests only go mid-phrase: never first in the riff, never last in a segment, never twice in a row.
      if (
        id === 'rest' &&
        ((isRiffStart && cells.length === 0) || prev?.id === 'rest' || cell.length === remaining)
      ) {
        return false;
      }
      return true;
    });
    const [id] = rng.weighted(options, ([, w]) => w);
    const cell = CELLS[id] as Cell;
    cells.push(cell);
    remaining -= cell.length;
  }
  return cells;
}

function groupCell(length: number, archetype: Archetype, pool: Weighted[], rng: Rng): Cell {
  if (length === 4) {
    const beats = pool.filter(([id]) => (CELLS[id] as Cell).length === 4 && id !== 'rest');
    return CELLS[rng.weighted(beats, ([, w]) => w)[0]] as Cell;
  }
  const options = GROUP_CELLS[archetype][length as 2 | 3 | 5 | 6];
  return CELLS[rng.weighted(options, ([, w]) => w)[0]] as Cell;
}

/**
 * Weighted choice of the next melody note, following death metal habits (§4.2 of the readme)
 * and the current chord: its tones weigh more (by the profile's chordToneBoost).
 */
export function pickMove(
  ctx: MelodyContext,
  current: number,
  chord: Chord = chordAt(ctx.chords, 0),
  strong = false,
): number {
  const p = ctx.profile;
  // Strong beats (accents and beat starts) want chord tones twice as much; weak ones leave room for colour.
  const chordBoost = p.chordToneBoost * (strong ? 2 : 1);
  const pedal = pedalRoot(ctx.root, chord);
  const candidates = ctx.pool.filter((n) => n !== current && n !== pedal);
  if (candidates.length === 0) return current;
  return ctx.rng.weighted(candidates, (n) => {
    const d = Math.abs(n - current);
    let w = d <= 2 ? 6 : d <= 4 ? 3 : d <= 7 ? 3 : d <= 12 ? 1 : 0.3;
    if (d > 4) w *= p.leapBoost;
    const degree = degreeOf(n, ctx.key);
    if (degree === 1) w *= 2.5 * p.dissonanceBoost; // ♭2
    if (degree === 6) w *= 2 * p.dissonanceBoost; // tritone
    if (n > ctx.root + 12) w *= p.highRegister; // keep it low and heavy
    if (isChordTone(n, chord)) w *= chordBoost * (pc(n) === chord.rootPc ? 1.2 : 1);
    return w;
  });
}

/** A chord tone from the upper part of the range, for string skipping against the low pedal. */
function pickHigh(ctx: MelodyContext, current: number, chord: Chord): number {
  const high = ctx.pool.filter((n) => n >= ctx.root + 7 && n !== current);
  if (high.length === 0) return pickMove(ctx, current, chord);
  return ctx.rng.weighted(high, (n) => (Math.abs(n - current) <= 4 ? 3 : 1) * (isChordTone(n, chord) ? 4 : 1));
}

/** The chord's tones within the melody's range, ascending (the rungs an arpeggio climbs). */
export function chordLadder(pool: number[], chord: Chord): number[] {
  return pool.filter((n) => isChordTone(n, chord));
}

/** Anchor a new arpeggio on the chord root nearest below the current note (or the lowest one). */
function arpeggioBase(ladder: number[], chord: Chord, current: number): number {
  const roots = ladder.filter((n) => pc(n) === chord.rootPc);
  const below = roots.filter((n) => n <= current);
  return below.at(-1) ?? roots[0] ?? ladder[0] ?? current;
}

/**
 * Chord tone number `tone` above `base` on the ladder (0 = the base, 1 = next chord tone …).
 * Past either end it folds back by an octave (3 rungs), so it always lands on a chord tone.
 */
export function arpeggioNote(ladder: number[], base: number, tone: number): number {
  if (ladder.length === 0) return base;
  let baseIndex = 0;
  ladder.forEach((n, i) => {
    if (n <= base) baseIndex = i;
  });
  let i = baseIndex + tone;
  while (i >= ladder.length) i -= 3;
  while (i < 0) i += 3;
  return ladder[Math.max(0, Math.min(ladder.length - 1, i))] as number;
}

/**
 * An arpeggio's shape: semitones above the chord root for tone 0, 1, 2 (root, 3rd, 5th) and, when
 * the chord has a flavour tone, tone 3 (the flavour, placed above the 5th: a 7th, 9th or 11th).
 */
export function arpShape(chord: Pick<ChordSlot, 'rootPc' | 'tones' | 'flavour'>): number[] {
  const shape = chord.tones.map((t) => pc(t - chord.rootPc));
  if (chord.flavour !== undefined) {
    const f = pc(chord.flavour - chord.rootPc);
    shape.push(f > (shape[2] as number) ? f : f + 12);
  }
  return shape;
}

/**
 * Tone number `tone` of `shape` above `base` (a chord root): each pass through the shape climbs an
 * octave, so a 4-note shape runs root, 3rd, 5th, flavour, root′ … Out of [low, high] it folds by octaves.
 */
export function shapeNote(base: number, shape: number[], tone: number, low: number, high: number): number {
  const n = shape.length;
  const octave = Math.floor(tone / n);
  let midi = base + 12 * octave + (shape[tone - octave * n] as number);
  while (midi > high && midi - 12 >= low) midi -= 12;
  while (midi < low) midi += 12;
  return midi;
}

/**
 * Extreme's Guitar 1 arpeggio note. A new run (or a chord change) picks an inversion and anchors on
 * the chord root nearest below the current note that leaves room for the cell's highest tone.
 */
function extendedArpNote(ctx: MelodyContext, state: MelodyState, chord: ChordSlot, tone: number, maxTone: number, restart: boolean): number {
  const shape = arpShape(chord);
  const low = ctx.pool[0] ?? ctx.root;
  const high = ctx.pool.at(-1) ?? low;
  if (restart) {
    state.arpShift = ctx.rng.weighted([0, 1, 2], (s) => (s === 0 ? 3 : 1));
    const span = shapeNote(0, shape, maxTone + state.arpShift, -Infinity, Infinity);
    const roots: number[] = [];
    for (let r = low + pc(chord.rootPc - low); r <= high; r += 12) roots.push(r);
    const fits = roots.filter((r) => r + span <= high);
    state.arpBase = fits.filter((r) => r <= state.current).at(-1) ?? fits[0] ?? roots[0] ?? low;
  }
  return shapeNote(state.arpBase, shape, tone + state.arpShift, low, high);
}

/**
 * One step of a scale run: the next note of `pool` (ascending scale notes) from `current`
 * in direction `dir`. At either end of the pool the run turns around. Returns the note and
 * the (possibly reversed) direction.
 */
export function scaleRunStep(pool: number[], current: number, dir: number): { midi: number; dir: number } {
  if (pool.length === 0) return { midi: current, dir };
  let i = pool.indexOf(current);
  if (i < 0) {
    // `current` isn't a scale note (not expected in strict mode): start from the nearest one behind it.
    const above = pool.findIndex((n) => n > current);
    i = dir > 0 ? (above < 0 ? pool.length - 1 : above - 1) : above < 0 ? pool.length : above;
  }
  let next = i + dir;
  if (next < 0 || next >= pool.length) {
    dir = -dir;
    next = i + dir;
  }
  return { midi: pool[Math.max(0, Math.min(pool.length - 1, next))] as number, dir };
}

function scaleStep(ctx: MelodyContext, state: MelodyState): number {
  const { midi, dir } = scaleRunStep(ctx.pool, state.current, state.chromDir);
  state.chromDir = dir;
  return midi;
}

function renderCells(cells: Cell[], startStep: number, ctx: MelodyContext, state: MelodyState): RawNote[] {
  const out: RawNote[] = [];
  let cellStart = startStep;
  let prevRole: string | undefined;
  for (const cell of cells) {
    for (const hit of cell.hits as Hit[]) {
      const step = cellStart + hit.offset;
      const chord = chordAt(ctx.chords, step);
      const strong = hit.accent || step % 4 === 0;
      const chordChanged = state.chordStep !== chord.step;
      state.chordStep = chord.step;
      let midi: number;
      let pedal = false;
      switch (hit.role) {
        case 'root':
          midi = pedalRoot(ctx.root, chord);
          pedal = true;
          state.passing = false;
          break;
        case 'move':
          pedal = ctx.profile.rootStay > 0 && ctx.rng.chance(ctx.profile.rootStay);
          midi = pedal ? pedalRoot(ctx.root, chord) : pickMove(ctx, state.current, chord, strong);
          state.passing = false;
          break;
        case 'hold':
          // A held tremolo note that runs into a chord it doesn't belong to is re-picked.
          if (chordChanged && !isChordTone(state.current, chord)) {
            midi = pickMove(ctx, state.current, chord, true);
            state.passing = false;
          } else {
            midi = state.current;
            // A held pedal stays a pedal only under the same chord. Held into a new chord it is just a
            // sustained tone there, so a repeat (A′) must keep its pitch rather than re-root it.
            pedal = state.pedal && !chordChanged;
          }
          break;
        case 'chrom': {
          // The direction draw happens either way, so the toggle changes only the run's pitches.
          if (prevRole !== 'chrom') {
            state.chromDir = ctx.rng.chance(0.7) ? -1 : 1;
            if (state.current - 3 < ctx.root) state.chromDir = 1;
          }
          if (ctx.chromaticPassing) {
            // Like a scale run, turn around at either end of Guitar 1's range rather than leave it.
            const low = ctx.pool[0] ?? ctx.root;
            const high = ctx.pool.at(-1) ?? low;
            midi = state.current + state.chromDir;
            if (midi > high || midi < low) {
              state.chromDir = -state.chromDir;
              midi = state.current + state.chromDir;
            }
            midi = Math.max(low, Math.min(high, midi));
            state.passing = !isInScale(midi, ctx.key, ctx.scale);
          } else {
            midi = scaleStep(ctx, state);
            state.passing = false;
          }
          break;
        }
        case 'back':
          midi = state.previous;
          state.passing = !isInScale(midi, ctx.key, ctx.scale);
          break;
        case 'arp': {
          if (ctx.profile.arpVaries) {
            const maxTone = Math.max(...cell.hits.filter((h) => h.role === 'arp' && h.offset >= hit.offset).map((h) => h.tone ?? 0));
            midi = extendedArpNote(ctx, state, chord, hit.tone ?? 0, maxTone, prevRole !== 'arp' || chordChanged);
            state.passing = false;
            break;
          }
          const ladder = chordLadder(ctx.pool, chord);
          if (prevRole !== 'arp') state.arpBase = arpeggioBase(ladder, chord, state.current);
          midi = arpeggioNote(ladder, state.arpBase, hit.tone ?? 0);
          state.passing = false;
          break;
        }
        case 'high':
          midi = pickHigh(ctx, state.current, chord);
          state.passing = false;
          break;
      }
      state.previous = state.current;
      state.current = midi;
      state.pedal = pedal;
      prevRole = hit.role;
      out.push({
        step: cellStart + hit.offset,
        duration: hit.duration,
        midi,
        palmMute: hit.palmMute,
        accent: hit.accent,
        passing: state.passing,
        ...(pedal ? { pedal: true } : {}),
      });
    }
    cellStart += cell.length;
  }
  return out;
}

/** End the phrase on the final chord's root (low register), so the riff lands on the harmony and loops. */
function resolveEnding(notes: RawNote[], ctx: MelodyContext, fromStep: number): void {
  const last = notes.at(-1);
  if (!last) return;
  const target = pedalRoot(ctx.root, chordAt(ctx.chords, last.step));
  const tailPitch = last.midi;
  // Retune the trailing run of the last pitch (e.g. a whole tremolo group), within the variation only.
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i] as RawNote;
    if (n.step < fromStep || n.midi !== tailPitch) break;
    n.midi = target;
    n.passing = false;
  }
}

/** At higher complexity a segment may switch to another style (e.g. tremolo into a gallop). */
function segmentStyle(main: Archetype, ctx: MelodyContext): Archetype {
  const chance = ctx.profile.styleSwitchChance;
  if (chance <= 0 || !ctx.rng.chance(chance)) return main;
  const others = (Object.keys(ARCHETYPE_CELLS) as Archetype[]).filter((a) => a !== main);
  return ctx.rng.pick(others);
}

/**
 * Guitar 1: phrase A followed by A′. A′ repeats A except for its last
 * `variationLength` steps, which get new cells and new notes.
 */
export function generateGuitar1(ctx: MelodyContext, archetype: Archetype, bars: Bars): RawNote[] {
  const half = (bars * 16) / 2;
  const varLen = ctx.profile.variation(bars);
  const headLen = half - varLen;
  const p = ctx.profile;

  const headCells = fillCells(headLen, segmentStyle(archetype, ctx), ctx.rng, true, p);
  const tailCells = fillCells(varLen, segmentStyle(archetype, ctx), ctx.rng, false, p);
  const variationCells = fillCells(varLen, segmentStyle(archetype, ctx), ctx.rng, false, p);

  const state: MelodyState = {
    current: ctx.root,
    previous: ctx.root,
    passing: false,
    chromDir: -1,
    arpBase: ctx.root,
    arpShift: 0,
    chordStep: -1,
    pedal: false,
  };
  const head = renderCells(headCells, 0, ctx, state);
  const afterHead = { ...state };
  const tail = renderCells(tailCells, headLen, ctx, state);

  // A′ repeats A's notes. Over a different chord (chord changes "repeat"/"longer"), the pedal
  // notes follow the chord now underneath; melody notes stay exactly as they were.
  const headAgain = head.map((n) => {
    const step = n.step + half;
    return n.pedal ? { ...n, step, midi: pedalRoot(ctx.root, chordAt(ctx.chords, step)) } : { ...n, step };
  });
  const variation = renderCells(variationCells, half + headLen, ctx, { ...afterHead });

  const notes = [...head, ...tail, ...headAgain, ...variation];
  resolveEnding(notes, ctx, half + headLen);
  return notes;
}
