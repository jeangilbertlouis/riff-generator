import { describe, expect, it } from 'vitest';
import { PROFILES } from '../src/engine/complexity.ts';
import { generateRiff } from '../src/engine/generate.ts';
import { PROGRESSIONS, chordAt, chordOnDegree, romanProgression } from '../src/engine/harmony.ts';
import { CELLS } from '../src/engine/rhythm.ts';
import { arpeggioNote, chordLadder } from '../src/engine/riff.ts';
import { SCALES, SCALE_IDS, pc, scaleNotesInRange } from '../src/engine/theory.ts';
import { COMPLEXITIES, NOTE_NAMES, type Bars, type Complexity, type Riff } from '../src/engine/types.ts';

describe('chords on scale degrees', () => {
  it.each([
    ['E', 'phrygian', 0, 'Em', 'i'],
    ['E', 'phrygian', 1, 'F', '♭II'],
    ['E', 'phrygian', 5, 'C', '♭VI'],
    ['A', 'harmonicMinor', 4, 'E', 'V'],
    ['A', 'harmonicMinor', 2, 'C+', '♭III+'],
    ['A', 'harmonicMinor', 6, 'G#°', 'vii°'],
    ['A', 'naturalMinor', 6, 'G', '♭VII'],
    ['B', 'locrian', 0, 'B°', 'i°'],
    ['B', 'locrian', 4, 'F', '♭V'],
    ['E', 'phrygianDominant', 0, 'E', 'I'],
    ['C', 'diminished', 0, 'C°', 'i°'],
    ['E', 'chromatic', 6, 'A#m', '♭v'],
  ] as const)('%s %s degree %i is %s (%s)', (key, scale, degree, name, roman) => {
    const c = chordOnDegree(key, scale, degree);
    expect(c.name).toBe(name);
    expect(c.roman).toBe(roman);
  });

  it('every triad in every scale is made of scale tones', () => {
    for (const scale of SCALE_IDS) {
      const pcs = SCALES[scale].intervals.map((i) => pc(i + 4)); // key E
      for (let d = 0; d < SCALES[scale].intervals.length; d++) {
        for (const t of chordOnDegree('E', scale, d).tones) expect(pcs).toContain(t);
      }
    }
  });
});

describe('progressions', () => {
  it('every template starts on the tonic and uses valid degrees', () => {
    for (const scale of SCALE_IDS) {
      const { two, four } = PROGRESSIONS[scale];
      for (const p of two) expect(p).toHaveLength(2);
      for (const p of four) expect(p).toHaveLength(4);
      for (const p of [...two, ...four]) {
        expect(p[0]).toBe(0);
        const limit = scale === 'chromatic' ? 12 : SCALES[scale].intervals.length;
        for (const d of p) expect(d).toBeLessThan(limit);
      }
    }
  });

  it('covers the whole riff without gaps, and both halves have the same chords', () => {
    for (const bars of [1, 2, 4] as Bars[]) {
      for (const complexity of COMPLEXITIES) {
        for (let seed = 0; seed < 20; seed++) {
          const r = generateRiff({ key: 'E', scale: 'phrygian', bpm: 180, bars, seed, complexity });
          let next = 0;
          for (const s of r.progression) {
            expect(s.step).toBe(next);
            expect(s.length % 4).toBe(0);
            next += s.length;
          }
          expect(next).toBe(r.totalSteps);
          const half = r.progression.length / 2;
          expect(r.progression.slice(half).map((s) => s.roman)).toEqual(r.progression.slice(0, half).map((s) => s.roman));
          expect(r.progression[0]!.degree).toBe(0); // starts on the tonic
        }
      }
    }
  });

  it('Simple uses two chords per half; 4-bar riffs at other levels use four', () => {
    for (let seed = 0; seed < 20; seed++) {
      expect(generateRiff({ key: 'E', scale: 'phrygian', bpm: 180, bars: 4, seed, complexity: 'simple' }).progression).toHaveLength(4);
      expect(generateRiff({ key: 'E', scale: 'phrygian', bpm: 180, bars: 4, seed, complexity: 'normal' }).progression).toHaveLength(8);
    }
  });

  it('names the progression in Roman numerals', () => {
    const r = generateRiff({ key: 'A', scale: 'harmonicMinor', bpm: 200, bars: 4, seed: 77, complexity: 'complex' });
    expect(romanProgression(r.progression)).toBe('i – iv – V – i');
  });
});

describe('the riff follows the chords', () => {
  const riffs: Riff[] = [];
  let seed = 3;
  for (const complexity of COMPLEXITIES) {
    for (const key of NOTE_NAMES) {
      for (const scale of SCALE_IDS) riffs.push(generateRiff({ key, scale, bpm: 180, bars: 2, seed: seed++ * 31, complexity }));
    }
  }

  it("every palm-muted pedal note is the current chord's root", () => {
    let pedals = 0;
    for (const r of riffs) {
      for (const n of r.guitar1) {
        if (!n.palmMute) continue;
        pedals++;
        expect(pc(n.midi), `${r.key} ${r.scale} seed ${r.seed} step ${n.step}`).toBe(chordAt(r.progression, n.step).rootPc);
      }
    }
    expect(pedals).toBeGreaterThan(1000);
  });

  it('the pedal moves when the chord changes (it is not stuck on the key root)', () => {
    const moved = riffs.filter((r) => new Set(r.guitar1.filter((n) => n.palmMute).map((n) => pc(n.midi))).size > 1);
    expect(moved.length / riffs.length).toBeGreaterThan(0.5);
  });
});

describe('arpeggios', () => {
  const pool = scaleNotesInRange('E', 'phrygian', 40, 59); // E2..B3
  const em = chordOnDegree('E', 'phrygian', 0);

  it('the ladder holds only chord tones, ascending', () => {
    expect(chordLadder(pool, em)).toEqual([40, 43, 47, 52, 55, 59]); // E G B E G B
  });

  it('climbs chord tones from the base and folds back an octave past the top', () => {
    const ladder = chordLadder(pool, em);
    expect([0, 1, 2, 3].map((t) => arpeggioNote(ladder, 40, t))).toEqual([40, 43, 47, 52]);
    expect(arpeggioNote(ladder, 52, 3)).toBe(52); // past the top (would be E4): folds back to E3
    expect(arpeggioNote(ladder, 40, -1)).toBe(47); // below the bottom: up an octave
  });

  it('every arpeggio cell only uses chord-tone roles that fit inside it', () => {
    for (const id of ['arpeggio', 'arpUp', 'arpDown', 'arpBroken', 'arpRoll', 'tremArp', 'tremArpBeat', 'pedalArp', 'ringArp', 'g3Arp', 'g5Arp', 'g6Arp']) {
      const cell = CELLS[id]!;
      expect(cell.hits.some((h) => h.role === 'arp')).toBe(true);
      for (const h of cell.hits) {
        expect(h.offset + h.duration).toBeLessThanOrEqual(cell.length);
        if (h.role === 'arp') expect(typeof h.tone).toBe('number');
      }
    }
  });

  it('every profile can use arpeggios', () => {
    for (const c of COMPLEXITIES) expect(PROFILES[c].arpRhythms.length).toBeGreaterThan(0);
  });
});

// ---- Less random: measured over many riffs (Guitar 1, 2 bars, six non-chromatic scales) ----

const SCALE_LIST = ['phrygian', 'phrygianDominant', 'locrian', 'naturalMinor', 'harmonicMinor', 'diminished'] as const;

function measure(complexity: Complexity) {
  let groups = 0, arps = 0, strong = 0, strongIn = 0;
  let seed = 7;
  for (const key of NOTE_NAMES) {
    for (const scale of SCALE_LIST) {
      const r = generateRiff({ key, scale, bpm: 180, bars: 2, seed: seed++ * 7907, complexity });
      const n = r.guitar1;
      for (let i = 2; i < n.length; i++) {
        const [a, b, d] = [n[i - 2]!, n[i - 1]!, n[i]!];
        if (a.midi === b.midi || b.midi === d.midi || a.midi === d.midi) continue;
        groups++;
        const chord = chordAt(r.progression, d.step);
        const inChord = [a, b, d].every((x) => chordAt(r.progression, x.step).tones.includes(pc(x.midi)));
        if ((b.midi - a.midi) * (d.midi - b.midi) > 0 && inChord && chord) arps++;
      }
      for (const x of n) {
        if (x.palmMute || !(x.accent || x.step % 4 === 0)) continue;
        strong++;
        if (chordAt(r.progression, x.step).tones.includes(pc(x.midi))) strongIn++;
      }
    }
  }
  return { arpeggioShare: arps / groups, strongBeatChordTones: strongIn / strong };
}

describe('less random (measured)', () => {
  it.each(COMPLEXITIES)('%s: arpeggios are common and strong beats land on chord tones', (c) => {
    const m = measure(c);
    // Before chords: arpeggio share was 0.2–5.5 % depending on level (readme §6.10).
    expect(m.arpeggioShare).toBeGreaterThan(0.15);
    expect(m.strongBeatChordTones).toBeGreaterThan(0.75);
  });
});
