import { ARCHETYPE_CELLS, CELLS, archetypeWeights, type Cell } from './rhythm.ts';
import type { Rng } from './random.ts';
import { degreeOf, hasFlatTwo, isInScale, scaleNotesInRange } from './theory.ts';
import type { Archetype, Bars, NoteEvent, NoteName, ScaleId } from './types.ts';

/** A note before it has a tab position. */
export type RawNote = Omit<NoteEvent, 'string' | 'fret'>;

export type MelodyContext = {
  key: NoteName;
  scale: ScaleId;
  rng: Rng;
  /** Lowest root note (open low string). */
  root: number;
  /** Scale notes Guitar 1 may use, ascending, from the root up about an octave and a 5th. */
  pool: number[];
};

type MelodyState = { current: number; passing: boolean; chromDir: number };

/** Highest pitch Guitar 1 uses, in semitones above the root. */
const G1_RANGE = 19;

/** Steps of the phrase that change between A and A′. */
export function variationLength(bars: Bars): number {
  return bars === 1 ? 4 : 8;
}

export function chooseArchetype(bpm: number, rng: Rng): Archetype {
  const weights = archetypeWeights(bpm);
  const all = Object.keys(weights) as Archetype[];
  return rng.weighted(all, (a) => weights[a]);
}

export function makeMelodyContext(key: NoteName, scale: ScaleId, root: number, high: number, rng: Rng): MelodyContext {
  return { key, scale, rng, root, pool: scaleNotesInRange(key, scale, root, Math.min(root + G1_RANGE, high)) };
}

/** Pick cells that fill exactly `length` steps. */
export function fillCells(length: number, archetype: Archetype, rng: Rng, isRiffStart: boolean): Cell[] {
  const pool = ARCHETYPE_CELLS[archetype];
  const cells: Cell[] = [];
  let remaining = length;
  while (remaining > 0) {
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

/** Weighted choice of the next melody note, following death metal habits (§4.2 of the readme). */
export function pickMove(ctx: MelodyContext, current: number): number {
  const candidates = ctx.pool.filter((n) => n !== current && n !== ctx.root);
  if (candidates.length === 0) return current;
  return ctx.rng.weighted(candidates, (n) => {
    const d = Math.abs(n - current);
    let w = d <= 2 ? 6 : d <= 4 ? 3 : d <= 7 ? 3 : d <= 12 ? 1 : 0.3;
    const degree = degreeOf(n, ctx.key);
    if (degree === 1) w *= 2.5; // ♭2
    if (degree === 6) w *= 2; // tritone
    if (n > ctx.root + 12) w *= 0.6; // keep it low and heavy
    return w;
  });
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
          midi = pickMove(ctx, state.current);
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
      }
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

/**
 * Guitar 1: phrase A followed by A′. A′ repeats A except for its last
 * `variationLength` steps, which get new cells and new notes.
 */
export function generateGuitar1(ctx: MelodyContext, archetype: Archetype, bars: Bars): RawNote[] {
  const half = (bars * 16) / 2;
  const varLen = variationLength(bars);
  const headLen = half - varLen;

  const headCells = fillCells(headLen, archetype, ctx.rng, true);
  const tailCells = fillCells(varLen, archetype, ctx.rng, false);
  const variationCells = fillCells(varLen, archetype, ctx.rng, false);

  const state: MelodyState = { current: ctx.root, passing: false, chromDir: -1 };
  const head = renderCells(headCells, 0, ctx, state);
  const afterHead = { ...state };
  const tail = renderCells(tailCells, headLen, ctx, state);

  const headAgain = head.map((n) => ({ ...n, step: n.step + half }));
  const variation = renderCells(variationCells, half + headLen, ctx, { ...afterHead });

  const notes = [...head, ...tail, ...headAgain, ...variation];
  resolveEnding(notes, ctx, half + headLen);
  return notes;
}
