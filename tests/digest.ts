import { createHash } from 'node:crypto';
import type { NoteEvent, Riff } from '../src/engine/types.ts';

/** Musical content only: timing, pitch and articulation (no tab positions). */
const strip = (notes: NoteEvent[]) =>
  notes.map(({ step, duration, midi, palmMute, accent, passing }) => [step, duration, midi, palmMute, accent, passing]);

/** A short hash of a riff's music: style, progression, both guitars. Fingering is left out on purpose. */
export function riffDigest(r: Riff): string {
  const chords = r.progression.map((c) => [c.step, c.length, c.roman]);
  return createHash('sha256')
    .update(JSON.stringify([r.archetype, r.guitar2Mode, chords, strip(r.guitar1), strip(r.guitar2)]))
    .digest('hex')
    .slice(0, 16);
}
