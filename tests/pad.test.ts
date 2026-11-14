import { describe, expect, it } from 'vitest';
import { generateRiff } from '../src/engine/generate.ts';
import { chordOnDegree } from '../src/engine/harmony.ts';
import { PAD_HIGH, PAD_LOW, closeVoicings, movement, voicePad } from '../src/engine/pad.ts';
import { pc } from '../src/engine/theory.ts';
import { rootMidi } from '../src/engine/tuning.ts';
import { COMPLEXITIES, NOTE_NAMES, type Riff } from '../src/engine/types.ts';
import { riffDigest } from './digest.ts';

describe('pad voicings', () => {
  const em = chordOnDegree('E', 'phrygian', 0); // E G B

  it('lists close-position triads (root position and inversions) inside the range', () => {
    expect(closeVoicings(em.tones, 52, 67)).toEqual([
      [52, 55, 59], // E G B
      [55, 59, 64], // G B E
      [59, 64, 67], // B E G
    ]);
  });

  it('voice-leads to the nearest inversion: Em → F (E phrygian i → ♭II) moves each voice by a step or so', () => {
    const f = chordOnDegree('E', 'phrygian', 1); // F A C
    const slots = [
      { ...em, step: 0, length: 8 },
      { ...f, step: 8, length: 8 },
    ];
    const [a, b] = voicePad(slots, 40);
    expect(movement(a!.midis, b!.midis)).toBeLessThanOrEqual(4);
  });
});

describe('the pad on generated riffs', () => {
  const riffs: Riff[] = [];
  let seed = 1;
  for (const complexity of COMPLEXITIES) {
    for (const key of NOTE_NAMES) {
      for (const chordChanges of ['steady', 'longer', 'repeat'] as const) {
        riffs.push(generateRiff({ key, scale: 'harmonicMinor', bpm: 180, bars: 4, seed: seed++ * 37, complexity, chordChanges }));
      }
    }
  }

  it('plays one chord per chord slot, covering the riff exactly', () => {
    for (const r of riffs) {
      expect(r.pad.map((p) => [p.step, p.length])).toEqual(r.progression.map((s) => [s.step, s.length]));
    }
  });

  it('every pad chord is its slot\'s triad: three distinct chord tones, in the pad register', () => {
    for (const r of riffs) {
      const root = rootMidi(r.tuning, r.key);
      r.pad.forEach((p, i) => {
        const slot = r.progression[i]!;
        expect(p.midis).toHaveLength(3);
        expect(new Set(p.midis.map(pc))).toEqual(new Set(slot.tones));
        for (const m of p.midis) {
          expect(m).toBeGreaterThanOrEqual(root + PAD_LOW);
          expect(m).toBeLessThanOrEqual(root + PAD_HIGH);
        }
        expect(p.midis[2]! - p.midis[0]!).toBeLessThan(12); // close position
      });
    }
  });

  it('voice-leads more smoothly than playing every chord in root position', () => {
    let smooth = 0;
    let rootPosition = 0;
    for (const r of riffs) {
      const root = rootMidi(r.tuning, r.key);
      // Baseline: each chord in root position, as low as it goes from the pad's bottom (an octave of
      // headroom so a root position always exists; inside the pad's range only inversions may fit).
      const rootVoicings = r.progression.map((s) => {
        const options = closeVoicings(s.tones, root + PAD_LOW, root + PAD_HIGH + 12).filter((v) => pc(v[0]!) === s.rootPc);
        return options[0]!;
      });
      for (let i = 1; i < r.pad.length; i++) {
        smooth += movement(r.pad[i - 1]!.midis, r.pad[i]!.midis);
        rootPosition += movement(rootVoicings[i - 1]!, rootVoicings[i]!);
      }
    }
    expect(smooth).toBeLessThan(rootPosition * 0.75);
  });

  it('does not change the riff', () => {
    const r = riffs[5]!;
    expect(riffDigest(r)).toBe(riffDigest({ ...r, pad: [] }));
  });
});
