import { GROUPINGS, PROFILES, type ComplexityProfile } from './complexity.ts';
import { ARCHETYPE_CELLS, CELLS, GROUP_CELLS, archetypeWeights, type Cell, type Weighted } from './rhythm.ts';
import type { Rng } from './random.ts';
import { degreeOf, hasFlatTwo, isInScale, scaleNotesInRange } from './theory.ts';
import type { Archetype, Bars, Complexity, NoteEvent, NoteName, ScaleId } from './types.ts';

/** A note before it has a tab position. */
export type RawNote = Omit<NoteEvent, 'string' | 'fret'>;

export type MelodyContext = {
  key: NoteName;
  scale: ScaleId;
  rng: Rng;
  /** Lowest root note (open low string). */
  root: number;
  /** Scale notes Guitar 1 may use, ascending, from the root up to the profile's range. */
  pool: number[];
  profile: ComplexityProfile;
};

type MelodyState = {
  current: number;
  /** Pitch before `current` (for trills). */
  previous: number;
  passing: boolean;
  chromDir: number;
  leapDir: number;
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
): MelodyContext {
  return { key, scale, rng, root, profile, pool: scaleNotesInRange(key, scale, root, Math.min(root + profile.range, high)) };
}

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

/** Weighted choice of the next melody note, following death metal habits (§4.2 of the readme). */
export function pickMove(ctx: MelodyContext, current: number): number {
  const p = ctx.profile;
  const candidates = ctx.pool.filter((n) => n !== current && n !== ctx.root);
  if (candidates.length === 0) return current;
  return ctx.rng.weighted(candidates, (n) => {
    const d = Math.abs(n - current);
    let w = d <= 2 ? 6 : d <= 4 ? 3 : d <= 7 ? 3 : d <= 12 ? 1 : 0.3;
    if (d > 4) w *= p.leapBoost;
    const degree = degreeOf(n, ctx.key);
    if (degree === 1) w *= 2.5 * p.dissonanceBoost; // ♭2
    if (degree === 6) w *= 2 * p.dissonanceBoost; // tritone
    if (n > ctx.root + 12) w *= p.highRegister; // keep it low and heavy
    return w;
  });
}

/** A leap of at least a minor 3rd, alternating direction where the range allows (broken arpeggio). */
function pickLeap(ctx: MelodyContext, state: MelodyState): number {
  const pick = (dir: number) => ctx.pool.filter((n) => (n - state.current) * dir >= 3 && n !== ctx.root);
  let options = pick(state.leapDir);
  if (options.length === 0) {
    state.leapDir = -state.leapDir;
    options = pick(state.leapDir);
  }
  if (options.length === 0) return pickMove(ctx, state.current);
  const choice = ctx.rng.weighted(options, (n) => 1 / Math.abs(n - state.current)); // prefer the nearer leaps
  state.leapDir = -state.leapDir;
  return choice;
}

/** A note from the upper part of the range, for string skipping against the low pedal. */
function pickHigh(ctx: MelodyContext, current: number): number {
  const high = ctx.pool.filter((n) => n >= ctx.root + 7 && n !== current);
  if (high.length === 0) return pickMove(ctx, current);
  return ctx.rng.weighted(high, (n) => (Math.abs(n - current) <= 4 ? 3 : 1) * (degreeOf(n, ctx.key) === 1 ? 2 : 1));
}

function renderCells(cells: Cell[], startStep: number, ctx: MelodyContext, state: MelodyState): RawNote[] {
  const out: RawNote[] = [];
  let cellStart = startStep;
  let prevRole: string | undefined;
  for (const cell of cells) {
    for (const hit of cell.hits) {
      let midi: number;
      switch (hit.role) {
        case 'root':
          midi = ctx.root;
          state.passing = false;
          break;
        case 'move':
          midi =
            ctx.profile.rootStay > 0 && ctx.rng.chance(ctx.profile.rootStay) ? ctx.root : pickMove(ctx, state.current);
          state.passing = false;
          break;
        case 'hold':
          midi = state.current;
          break;
        case 'chrom': {
          if (prevRole !== 'chrom') {
            state.chromDir = ctx.rng.chance(0.7) ? -1 : 1;
            if (state.current - 3 < ctx.root) state.chromDir = 1;
          }
          midi = state.current + state.chromDir;
          if (midi < ctx.root) midi = ctx.root;
          state.passing = !isInScale(midi, ctx.key, ctx.scale);
          break;
        }
        case 'back':
          midi = state.previous;
          state.passing = !isInScale(midi, ctx.key, ctx.scale);
          break;
        case 'leap':
          midi = pickLeap(ctx, state);
          state.passing = false;
          break;
        case 'high':
          midi = pickHigh(ctx, state.current);
          state.passing = false;
          break;
      }
      state.previous = state.current;
      state.current = midi;
      prevRole = hit.role;
      out.push({
        step: cellStart + hit.offset,
        duration: hit.duration,
        midi,
        palmMute: hit.palmMute,
        accent: hit.accent,
        passing: state.passing,
      });
    }
    cellStart += cell.length;
  }
  return out;
}

/** End the phrase on the root, or the ♭2 when the scale has one, so the riff loops cleanly. */
function resolveEnding(notes: RawNote[], ctx: MelodyContext, fromStep: number): void {
  const last = notes.at(-1);
  if (!last) return;
  const target = hasFlatTwo(ctx.scale) && ctx.rng.chance(0.35) ? ctx.root + 1 : ctx.root;
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

  const state: MelodyState = { current: ctx.root, previous: ctx.root, passing: false, chromDir: -1, leapDir: 1 };
  const head = renderCells(headCells, 0, ctx, state);
  const afterHead = { ...state };
  const tail = renderCells(tailCells, headLen, ctx, state);

  const headAgain = head.map((n) => ({ ...n, step: n.step + half }));
  const variation = renderCells(variationCells, half + headLen, ctx, { ...afterHead });

  const notes = [...head, ...tail, ...headAgain, ...variation];
  resolveEnding(notes, ctx, half + headLen);
  return notes;
}
