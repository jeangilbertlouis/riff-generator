export type GuitarId = 'guitar1' | 'guitar2';
export const GUITARS: GuitarId[] = ['guitar1', 'guitar2'];

export type ChannelState = { muted: boolean; solo: boolean; volumeDb: number };
export type MixerState = Record<GuitarId, ChannelState>;

export function defaultMixer(): MixerState {
  return {
    guitar1: { muted: false, solo: false, volumeDb: 0 },
    guitar2: { muted: false, solo: false, volumeDb: 0 },
  };
}

/** A guitar is heard unless it is muted, or another guitar is soloed and it isn't. */
export function isAudible(mixer: MixerState, id: GuitarId): boolean {
  const ch = mixer[id];
  if (ch.muted) return false;
  const anySolo = GUITARS.some((g) => mixer[g].solo);
  return !anySolo || ch.solo;
}
