import { describe, expect, it } from 'vitest';
import { noteVelocity, soundingFraction } from '../src/audio/schedule.ts';
import { generateRiff } from '../src/engine/generate.ts';
import { SCALE_IDS } from '../src/engine/theory.ts';
import { NOTE_NAMES, type NoteEvent, type Riff } from '../src/engine/types.ts';
import { DISTORTION_GUITAR, MIDI_PPQ, TICKS_PER_STEP, midiFileName, riffToMidi, vlq } from '../src/export/midi.ts';

// ---- A small, independent Standard MIDI File reader for the tests ----
type ParsedEvent = { tick: number; status: number; data: number[]; metaType?: number };
type Parsed = { format: number; ntracks: number; division: number; tracks: ParsedEvent[][] };

function readMidi(bytes: Uint8Array): Parsed {
  let pos = 0;
  const str = (n: number) => String.fromCharCode(...bytes.slice(pos, (pos += n)));
  const u32 = () => ((bytes[pos++]! << 24) | (bytes[pos++]! << 16) | (bytes[pos++]! << 8) | bytes[pos++]!) >>> 0;
  const u16 = () => (bytes[pos++]! << 8) | bytes[pos++]!;
  const readVlq = () => {
    let v = 0;
    for (;;) {
      const b = bytes[pos++]!;
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
  };
  expect(str(4)).toBe('MThd');
  expect(u32()).toBe(6);
  const format = u16();
  const ntracks = u16();
  const division = u16();
  const tracks: ParsedEvent[][] = [];
  for (let t = 0; t < ntracks; t++) {
    expect(str(4)).toBe('MTrk');
    const end = u32() + pos;
    const events: ParsedEvent[] = [];
    let tick = 0;
    while (pos < end) {
      tick += readVlq();
      const status = bytes[pos++]!;
      if (status === 0xff) {
        const metaType = bytes[pos++]!;
        const len = readVlq();
        events.push({ tick, status, metaType, data: [...bytes.slice(pos, (pos += len))] });
      } else {
        const len = (status & 0xf0) === 0xc0 ? 1 : 2;
        events.push({ tick, status, data: [...bytes.slice(pos, (pos += len))] });
      }
    }
    expect(pos).toBe(end);
    tracks.push(events);
  }
  expect(pos).toBe(bytes.length);
  return { format, ntracks, division, tracks };
}

type ReadNote = { start: number; end: number; midi: number; velocity: number };
function notesOf(events: ParsedEvent[]): ReadNote[] {
  const open = new Map<number, { start: number; velocity: number }>();
  const out: ReadNote[] = [];
  for (const e of events) {
    const kind = e.status & 0xf0;
    const [midi, vel] = e.data as [number, number];
    if (kind === 0x90 && vel > 0) {
      expect(open.has(midi)).toBe(false); // previous note on this pitch must be closed first
      open.set(midi, { start: e.tick, velocity: vel });
    } else if (kind === 0x80 || (kind === 0x90 && vel === 0)) {
      const on = open.get(midi)!;
      out.push({ start: on.start, end: e.tick, midi, velocity: on.velocity });
      open.delete(midi);
    }
  }
  expect(open.size).toBe(0);
  return out.sort((a, b) => a.start - b.start);
}
// ----------------------------------------------------------------------

describe('vlq', () => {
  it('encodes the spec examples', () => {
    expect(vlq(0)).toEqual([0x00]);
    expect(vlq(0x7f)).toEqual([0x7f]);
    expect(vlq(0x80)).toEqual([0x81, 0x00]);
    expect(vlq(0x2000)).toEqual([0xc0, 0x00]);
    expect(vlq(0x0fffffff)).toEqual([0xff, 0xff, 0xff, 0x7f]);
    expect(() => vlq(-1)).toThrow();
  });
});

describe('riffToMidi', () => {
  const riff = generateRiff({ key: 'E', scale: 'phrygian', bpm: 180, bars: 2, seed: 7, guitar2Mode: 'harmony' });
  const parsed = readMidi(riffToMidi(riff));

  it('writes a format-1 file with a tempo track and two guitar tracks', () => {
    expect(parsed.format).toBe(1);
    expect(parsed.ntracks).toBe(3);
    expect(parsed.division).toBe(MIDI_PPQ);
  });

  it('sets tempo and 4/4', () => {
    const tempo = parsed.tracks[0]!.find((e) => e.metaType === 0x51)!.data;
    expect((tempo[0]! << 16) | (tempo[1]! << 8) | tempo[2]!).toBe(Math.round(60_000_000 / 180));
    expect(parsed.tracks[0]!.find((e) => e.metaType === 0x58)!.data.slice(0, 2)).toEqual([4, 2]);
  });

  it('uses the playback tempo when given', () => {
    const p = readMidi(riffToMidi(riff, 120));
    const tempo = p.tracks[0]!.find((e) => e.metaType === 0x51)!.data;
    expect((tempo[0]! << 16) | (tempo[1]! << 8) | tempo[2]!).toBe(500_000);
  });

  it('puts each guitar on its own channel with a distortion guitar, panned apart', () => {
    for (const [i, ch] of [[1, 0], [2, 1]] as const) {
      const t = parsed.tracks[i]!;
      expect(t.find((e) => e.status === (0xc0 | ch))!.data).toEqual([DISTORTION_GUITAR]);
      const pan = t.find((e) => e.status === (0xb0 | ch) && e.data[0] === 10)!.data[1]!;
      expect(i === 1 ? pan < 64 : pan > 64).toBe(true);
      expect(t.every((e) => e.status === 0xff || (e.status & 0x0f) === ch)).toBe(true);
    }
  });

  it('every track ends with End of Track', () => {
    for (const t of parsed.tracks) expect(t.at(-1)!.metaType).toBe(0x2f);
  });

  it('writes every note with the right pitch, start, length and velocity', () => {
    const check = (notes: NoteEvent[], read: ReadNote[]) => {
      expect(read).toHaveLength(notes.length);
      read.forEach((r, i) => {
        const n = notes[i]!;
        expect(r.midi).toBe(n.midi);
        expect(r.start).toBe(n.step * TICKS_PER_STEP);
        expect(r.end - r.start).toBe(Math.round(n.duration * TICKS_PER_STEP * soundingFraction(n.palmMute)));
        expect(r.velocity).toBe(Math.round(noteVelocity(n.accent, n.palmMute) * 120));
      });
    };
    check(riff.guitar1, notesOf(parsed.tracks[1]!));
    check(riff.guitar2, notesOf(parsed.tracks[2]!));
  });

  it('is valid for every key and scale, including 7-string tunings and 4 bars', () => {
    for (const key of NOTE_NAMES) {
      for (const scale of SCALE_IDS) {
        const r: Riff = generateRiff({ key, scale, bpm: 60 + key.length * 50, bars: 4, seed: scale.length });
        const p = readMidi(riffToMidi(r));
        expect(notesOf(p.tracks[1]!)).toHaveLength(r.guitar1.length);
        expect(notesOf(p.tracks[2]!)).toHaveLength(r.guitar2.length);
        const last = Math.max(...p.tracks.flatMap((t) => t.map((e) => e.tick)));
        expect(last).toBeLessThanOrEqual(r.totalSteps * TICKS_PER_STEP);
      }
    }
  });

  it('names the file after the riff, without # in it', () => {
    const r = generateRiff({ key: 'C#', scale: 'locrian', bpm: 200, seed: 42 });
    expect(midiFileName(r)).toBe('riff-Cs-locrian-200bpm-42.mid');
    expect(midiFileName(r, 150)).toBe('riff-Cs-locrian-150bpm-42.mid');
  });
});
