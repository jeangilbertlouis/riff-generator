import { noteVelocity, soundingFraction } from '../audio/schedule.ts';
import { SCALES } from '../engine/theory.ts';
import type { NoteEvent, Riff } from '../engine/types.ts';

export const MIDI_PPQ = 480;
export const TICKS_PER_STEP = MIDI_PPQ / 4;
/** General MIDI program 31 "Distortion Guitar" (0-based 30). */
export const DISTORTION_GUITAR = 30;
const PAN = { guitar1: 20, guitar2: 108 } as const;

type TrackEvent = { tick: number; order: number; bytes: number[] };

/** MIDI variable-length quantity. */
export function vlq(value: number): number[] {
  if (!Number.isInteger(value) || value < 0 || value > 0x0fffffff) throw new RangeError(`Bad VLQ value ${value}`);
  const bytes = [value & 0x7f];
  let v = value >>> 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return bytes;
}

const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u16 = (n: number) => [(n >>> 8) & 0xff, n & 0xff];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0) & 0x7f);
const meta = (type: number, data: number[]) => [0xff, type, ...vlq(data.length), ...data];

function chunk(id: string, data: number[]): number[] {
  return [...ascii(id), ...u32(data.length), ...data];
}

/** Sort by tick; at the same tick metas/setup first, then note-offs, then note-ons. */
function track(events: TrackEvent[]): number[] {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order);
  const data: number[] = [];
  let last = 0;
  for (const e of sorted) {
    data.push(...vlq(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  data.push(...vlq(0), ...meta(0x2f, []));
  return chunk('MTrk', data);
}

function guitarTrack(name: string, notes: NoteEvent[], channel: number, pan: number): number[] {
  const events: TrackEvent[] = [
    { tick: 0, order: 0, bytes: meta(0x03, ascii(name)) },
    { tick: 0, order: 0, bytes: [0xc0 | channel, DISTORTION_GUITAR] },
    { tick: 0, order: 0, bytes: [0xb0 | channel, 10, pan] },
    { tick: 0, order: 0, bytes: [0xb0 | channel, 7, 100] },
  ];
  for (const n of notes) {
    const start = n.step * TICKS_PER_STEP;
    const length = Math.max(1, Math.round(n.duration * TICKS_PER_STEP * soundingFraction(n.palmMute)));
    const velocity = Math.max(1, Math.min(127, Math.round(noteVelocity(n.accent, n.palmMute) * 120)));
    events.push({ tick: start, order: 2, bytes: [0x90 | channel, n.midi, velocity] });
    events.push({ tick: start + length, order: 1, bytes: [0x80 | channel, n.midi, 64] });
  }
  return track(events);
}

/**
 * A Standard MIDI File (format 1): tempo track + one track per guitar. One pass, no count-in.
 * `bpm` defaults to the riff's; pass the playback tempo if it was changed live.
 */
export function riffToMidi(riff: Riff, bpm = riff.bpm): Uint8Array<ArrayBuffer> {
  const microsPerQuarter = Math.round(60_000_000 / bpm);
  const [num, den] = riff.timeSignature;
  const title = `Riff ${riff.key} ${SCALES[riff.scale].name} seed ${riff.seed}`;
  const tempoTrack = track([
    { tick: 0, order: 0, bytes: meta(0x03, ascii(title)) },
    { tick: 0, order: 0, bytes: meta(0x58, [num, Math.log2(den), 24, 8]) },
    { tick: 0, order: 0, bytes: meta(0x51, [(microsPerQuarter >> 16) & 0xff, (microsPerQuarter >> 8) & 0xff, microsPerQuarter & 0xff]) },
  ]);
  const bytes = [
    ...chunk('MThd', [...u16(1), ...u16(3), ...u16(MIDI_PPQ)]),
    ...tempoTrack,
    ...guitarTrack('Guitar 1', riff.guitar1, 0, PAN.guitar1),
    ...guitarTrack(`Guitar 2 (${riff.guitar2Mode})`, riff.guitar2, 1, PAN.guitar2),
  ];
  return new Uint8Array(bytes);
}

export function midiFileName(riff: Riff, bpm = riff.bpm): string {
  return `riff-${riff.key.replace('#', 's')}-${riff.scale}-${bpm}bpm-${riff.seed}.mid`;
}
