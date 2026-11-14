import type { Archetype, NoteEvent, Riff } from './types.ts';

export type DrumHit = Riff['drums'][number];
export type DrumPiece = DrumHit['piece'];

/** What a beat is built from: just enough to lock the drums to the riff. */
export type DrumSource = {
  archetype: Archetype;
  totalSteps: number;
  guitar1: Pick<NoteEvent, 'step' | 'palmMute'>[];
};

const STEPS_PER_BAR = 16;
const BEAT = 4;

/** Styles whose kick follows Guitar 1's palm-muted chugs. */
const LOCKED_KICK: ReadonlySet<Archetype> = new Set<Archetype>(['chug', 'gallop', 'breakdown']);

/**
 * A simple beat for a riff, derived from its style and Guitar 1's rhythm (no randomness):
 * - chug / gallop: kick on every palm-muted hit + beat 1, snare on 2 and 4, hats on 8ths;
 * - tremolo: kick on every beat, snare on every off-beat 8th (a skank beat), hats on quarters;
 * - breakdown: kick on the chugs + beat 1, snare on beat 3 (half time), hats on quarters;
 * - a crash on beat 1 of each half (A and A′), without a hat under it.
 */
export function generateDrums(riff: DrumSource): DrumHit[] {
  const hits = new Map<string, DrumHit>();
  const add = (step: number, piece: DrumPiece, accent: boolean) => {
    if (step < 0 || step >= riff.totalSteps) return;
    const key = `${step}:${piece}`;
    const existing = hits.get(key);
    hits.set(key, { step, piece, accent: accent || (existing?.accent ?? false) });
  };

  const half = riff.totalSteps / 2;
  const crashes = new Set([0, half]);
  const style = riff.archetype;

  for (let bar = 0; bar < riff.totalSteps; bar += STEPS_PER_BAR) {
    add(bar, 'kick', true); // every bar starts with a kick

    for (let s = 0; s < STEPS_PER_BAR; s++) {
      const step = bar + s;
      const onBeat = s % BEAT === 0;
      const onEighth = s % 2 === 0;

      // Snare
      if (style === 'tremolo' && onEighth && !onBeat) add(step, 'snare', s === 6 || s === 14);
      if ((style === 'chug' || style === 'gallop') && (s === 4 || s === 12)) add(step, 'snare', true);
      if (style === 'breakdown' && s === 8) add(step, 'snare', true);

      // Kick on the beat for tremolo riffs
      if (style === 'tremolo' && onBeat) add(step, 'kick', s === 0);

      // Hi-hat: 8ths for chug/gallop, quarters for tremolo and breakdown; never under a crash
      const hatHere = style === 'chug' || style === 'gallop' ? onEighth : onBeat;
      if (hatHere && !crashes.has(step)) add(step, 'hat', onBeat);
    }
  }

  // Kick locked to Guitar 1's palm-muted chugs
  if (LOCKED_KICK.has(style)) {
    for (const n of riff.guitar1) if (n.palmMute) add(n.step, 'kick', n.step % BEAT === 0);
  }

  for (const c of crashes) add(c, 'crash', true);

  const order: Record<DrumPiece, number> = { crash: 0, kick: 1, snare: 2, hat: 3 };
  return [...hits.values()].sort((a, b) => a.step - b.step || order[a.piece] - order[b.piece]);
}
