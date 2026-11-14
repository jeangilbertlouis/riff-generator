import * as Tone from 'tone';
import type { Riff } from '../engine/types.ts';
import type { GuitarId } from './mixer.ts';
import { Player } from './player.ts';

export type OfflineOptions = {
  countIn?: boolean;
  muted?: GuitarId[];
  solo?: GuitarId[];
  /** Defaults to one pass of the riff (plus count-in) and a short tail. */
  seconds?: number;
};

/** Seconds for one pass of the riff, plus the count-in bar when it is on. */
export function riffSeconds(riff: Riff, countIn: boolean): number {
  const stepSeconds = 60 / riff.bpm / 4;
  return (riff.totalSteps + (countIn ? riff.timeSignature[0] * 4 : 0)) * stepSeconds;
}

/**
 * Render a riff to a stereo buffer without playing it (no user gesture needed).
 * Used to check the sound in the browser; it can back a WAV export later.
 */
export async function renderOffline(riff: Riff, options: OfflineOptions = {}): Promise<Float32Array[]> {
  const countIn = options.countIn ?? false;
  const seconds = options.seconds ?? riffSeconds(riff, countIn) + 0.3;
  const buffer = await Tone.Offline(() => {
    const player = new Player({ loop: true, countIn });
    player.load(riff);
    options.muted?.forEach((g) => player.setMuted(g, true));
    options.solo?.forEach((g) => player.setSolo(g, true));
    player.startTransport(0);
  }, seconds, 2);
  const channels = buffer.toArray();
  return Array.isArray(channels) ? channels : [channels, channels];
}

export function rms(samples: Float32Array, from = 0, to = samples.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += (samples[i] as number) ** 2;
  return Math.sqrt(sum / Math.max(1, to - from));
}
