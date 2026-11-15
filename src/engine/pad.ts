import { pc } from './theory.ts';
import type { ChordSlot } from './types.ts';

/** One sustained pad chord: the pitches sound together from `step` for `length` steps. */
export type PadChord = { step: number; length: number; midis: number[] };

/** Pad register, in semitones above the riff's root: above the guitars' pedal, under their leads. */
export const PAD_LOW = 12;
export const PAD_HIGH = 28;

/** All close-position voicings (root position and inversions) of a triad that fit [low, high]. */
export function closeVoicings(tones: number[], low: number, high: number): number[][] {
  const out: number[][] = [];
  for (let bass = low; bass <= high; bass++) {
    if (!tones.includes(pc(bass))) continue;
    // Stack the other two tones as the next pitches above the bass.
    const voicing = [bass];
    let next = bass;
    while (voicing.length < 3) {
      next++;
      if (tones.includes(pc(next)) && !voicing.some((v) => pc(v) === pc(next))) voicing.push(next);
    }
    if ((voicing.at(-1) as number) <= high) out.push(voicing);
  }
  return out;
}

/** How far the hands move from one voicing to the next (sum of voice movements, matched low to high). */
export function movement(a: number[], b: number[]): number {
  return a.reduce((sum, v, i) => sum + Math.abs(v - (b[i] as number)), 0);
}

/**
 * Voice the progression for the pad: close-position triads between root+12 and root+28. The first
 * chord takes the voicing nearest the middle of that range; each next chord takes the inversion
 * closest to the previous one (smooth voice leading, like a keyboard player). A chord with a
 * flavour tone (Extreme) adds it on top, just above the triad, so a ♭9 colours the chord
 * instead of clustering inside it; the voice leading follows the triads.
 */
export function voicePad(progression: ChordSlot[], root: number): PadChord[] {
  const low = root + PAD_LOW;
  const high = root + PAD_HIGH;
  const middle = (low + high) / 2;
  const out: PadChord[] = [];
  let prev: number[] | null = null;
  for (const slot of progression) {
    const options = closeVoicings(slot.tones, low, high);
    const choice: number[] = options.reduce((best, v) => {
      const cost = (x: number[]) => (prev ? movement(prev, x) : Math.abs(x[1]! - middle));
      return cost(v) < cost(best) ? v : best;
    }, options[0]!);
    const top = choice.at(-1) as number;
    const flavour = slot.flavour === undefined ? [] : [top + 1 + pc(slot.flavour - top - 1)];
    out.push({ step: slot.step, length: slot.length, midis: [...choice, ...flavour] });
    prev = choice;
  }
  return out;
}
