import { describe, expect, it } from 'vitest';
import { buildSchedule, midiToFrequency, positionAtTicks } from '../src/audio/schedule.ts';
import { defaultMixer, isAudible } from '../src/audio/mixer.ts';
import { effectiveTime } from '../src/audio/guitar.ts';
import { generateRiff } from '../src/engine/generate.ts';

const riff = generateRiff({ key: 'E', scale: 'phrygian', bpm: 180, bars: 2, seed: 7 });

describe('buildSchedule', () => {
  it('maps steps to ticks with no count-in', () => {
    const s = buildSchedule(riff, { countIn: false });
    expect(s.ticksPerStep).toBe(48);
    expect(s.countIn).toEqual([]);
    expect(s.riffStart).toBe(0);
    expect(s.riffEnd).toBe(32 * 48);
    s.guitar1.forEach((n, i) => {
      const src = riff.guitar1[i]!;
      expect(n.ticks).toBe(src.step * 48);
      expect(n.durationTicks).toBe(src.duration * 48);
      expect(n.midi).toBe(src.midi);
    });
    expect(s.guitar2).toHaveLength(riff.guitar2.length);
  });

  it('shifts the riff by one bar when the count-in is on', () => {
    const s = buildSchedule(riff, { countIn: true });
    expect(s.countIn).toEqual([0, 192, 384, 576]);
    expect(s.riffStart).toBe(768);
    expect(s.riffEnd).toBe(768 + 32 * 48);
    expect(s.guitar1[0]!.ticks).toBe(768 + riff.guitar1[0]!.step * 48);
  });

  it('every note ends inside the loop', () => {
    for (const countIn of [true, false]) {
      const s = buildSchedule(riff, { countIn });
      for (const n of [...s.guitar1, ...s.guitar2]) {
        expect(n.ticks).toBeGreaterThanOrEqual(s.riffStart);
        expect(n.ticks + n.durationTicks).toBeLessThanOrEqual(s.riffEnd);
      }
    }
  });

  it('schedules every drum hit, shifted by the count-in like the guitars', () => {
    for (const countIn of [false, true]) {
      const s = buildSchedule(riff, { countIn });
      expect(s.drums).toHaveLength(riff.drums.length);
      s.drums.forEach((d, i) => {
        expect(d.ticks).toBe(s.riffStart + riff.drums[i]!.step * 48);
        expect(d.piece).toBe(riff.drums[i]!.piece);
        expect(d.ticks).toBeLessThan(s.riffEnd);
      });
    }
  });

  it('honours a custom PPQ and rejects odd ones', () => {
    expect(buildSchedule(riff, { countIn: false, ppq: 96 }).ticksPerStep).toBe(24);
    expect(() => buildSchedule(riff, { countIn: false, ppq: 90 })).toThrow(RangeError);
  });
});

describe('positionAtTicks', () => {
  const s = buildSchedule(riff, { countIn: true });

  it('reports count-in beats before the riff', () => {
    expect(positionAtTicks(s, 0)).toEqual({ kind: 'countIn', beat: 0 });
    expect(positionAtTicks(s, 600)).toEqual({ kind: 'countIn', beat: 3 });
  });

  it('reports riff steps and wraps at the loop end', () => {
    expect(positionAtTicks(s, 768)).toEqual({ kind: 'riff', step: 0 });
    expect(positionAtTicks(s, 768 + 5 * 48)).toEqual({ kind: 'riff', step: 5 });
    expect(positionAtTicks(s, 768 + 32 * 48)).toEqual({ kind: 'riff', step: 0 });
  });
});

describe('mixer', () => {
  it('plays both guitars by default', () => {
    const m = defaultMixer();
    expect(isAudible(m, 'guitar1')).toBe(true);
    expect(isAudible(m, 'guitar2')).toBe(true);
  });

  it('mute silences one guitar', () => {
    const m = defaultMixer();
    m.guitar1.muted = true;
    expect(isAudible(m, 'guitar1')).toBe(false);
    expect(isAudible(m, 'guitar2')).toBe(true);
  });

  it('solo silences the other guitar; mute wins over solo', () => {
    const m = defaultMixer();
    m.guitar2.solo = true;
    expect(isAudible(m, 'guitar1')).toBe(false);
    expect(isAudible(m, 'guitar2')).toBe(true);
    m.guitar2.muted = true;
    expect(isAudible(m, 'guitar2')).toBe(false);
  });

  it('the drums are a third channel: on by default, mutable, and covered by solo', () => {
    const m = defaultMixer();
    expect(isAudible(m, 'drums')).toBe(true);
    m.drums.muted = true;
    expect(isAudible(m, 'drums')).toBe(false);
    m.drums.muted = false;
    m.guitar1.solo = true;
    expect(isAudible(m, 'drums')).toBe(false); // soloing a guitar silences the drums
    m.drums.solo = true;
    expect(isAudible(m, 'drums')).toBe(true);
    expect(isAudible(m, 'guitar2')).toBe(false);
  });

  it('both soloed means both heard', () => {
    const m = defaultMixer();
    m.guitar1.solo = true;
    m.guitar2.solo = true;
    expect(isAudible(m, 'guitar1')).toBe(true);
    expect(isAudible(m, 'guitar2')).toBe(true);
  });
});

it('effectiveTime: late events are moved up to now, so two late hits share one instant (and the guard catches it)', () => {
  expect(effectiveTime(1.5, 1.0)).toBe(1.5); // on time: unchanged
  expect(effectiveTime(0.9, 1.0)).toBe(1.0); // late: clamped
  expect(effectiveTime(0.95, 1.0)).toBe(effectiveTime(0.9, 1.0)); // two late hits collide
});

it('midiToFrequency: A4 = 440 Hz, E2 ≈ 82.4 Hz', () => {
  expect(midiToFrequency(69)).toBe(440);
  expect(midiToFrequency(40)).toBeCloseTo(82.41, 2);
});
