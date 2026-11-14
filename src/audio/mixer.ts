export type GuitarId = 'guitar1' | 'guitar2';
export const GUITARS: GuitarId[] = ['guitar1', 'guitar2'];

/** Mixer channels: the two guitars, the drums and the synth pad. */
export type ChannelId = GuitarId | 'drums' | 'synth';
export const CHANNELS: ChannelId[] = ['guitar1', 'guitar2', 'drums', 'synth'];

export type ChannelState = { muted: boolean; solo: boolean; volumeDb: number };
export type MixerState = Record<ChannelId, ChannelState>;

export function defaultMixer(): MixerState {
  return {
    guitar1: { muted: false, solo: false, volumeDb: 0 },
    guitar2: { muted: false, solo: false, volumeDb: 0 },
    drums: { muted: false, solo: false, volumeDb: 0 },
    synth: { muted: false, solo: false, volumeDb: 0 },
  };
}

/** A channel is heard unless it is muted, or another channel is soloed and it isn't. */
export function isAudible(mixer: MixerState, id: ChannelId): boolean {
  const ch = mixer[id];
  if (ch.muted) return false;
  const anySolo = CHANNELS.some((c) => mixer[c].solo);
  return !anySolo || ch.solo;
}
