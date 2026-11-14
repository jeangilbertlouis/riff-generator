# Riff Generator

Generates random death metal riffs. You pick the key, scale and tempo. The app
generates a riff, plays it back with two instruments, and shows the guitar part
as tablature.

> **Status:** Milestone 1 (riff engine) is done. Audio, the SVG tab and the UI
> come next. This document holds the plan, the findings and the decisions.

## Getting started

Requires Node 22.18+ (the `riff` script runs TypeScript directly).

```bash
npm install
npm test                                  # engine unit tests
npm run riff -- E phrygian 200 2 1234     # print a riff as text tab: key scale bpm bars [seed]
npm run dev                               # temporary preview page (text tab only)
```

---

## 1. Requirements

| # | Requirement | Notes |
|---|-------------|-------|
| R1 | Generate death metal riffs at random | Each riff is new; a seed makes a riff reproducible |
| R2 | Choose the **key** | Root note E, F, F#, G, … D#. Tuning follows from it (see §4.3) |
| R3 | Choose the **scale** | List of scales in §4.2 |
| R4 | Choose the **BPM** | Range 60–260; the default is 180 |
| R5 | **Play back** the riff | In the app, with play/stop and loop |
| R6 | Exactly **two instruments** | **Two guitars**, no drums or bass (decided) |
| R7 | Show **guitar tablature** | Tab for both guitars, kept in step with playback, with a cursor on the current note |

---

## 2. Proposed approach (summary)

A **browser-only web app** (no backend):

- **TypeScript + Vite** for the app shell.
- A pure, testable **riff engine** that turns *(key, scale, bpm, seed)* into a
  note-level score: one event list for each guitar, on a 16th-note grid.
- **Tone.js** for scheduling and sound. Both guitars are **synthesized** and
  run through a distortion and cabinet chain (decided). Guitar 1 is panned
  left and Guitar 2 right, as in a typical double-tracked metal mix. The voice
  interface stays swappable so samples can replace the synth later.
- A **custom SVG tab renderer** that draws two staves, one per guitar. It is
  simple because each part is monophonic. Tab only, no standard notation.
- **MIDI export** (one file with two tracks) later, as a polish item. It costs
  little because the score already exists.

Why a web app: it is the quickest way to get audio, controls and a visual tab
in one place, it runs anywhere, and it needs no install. A desktop app or CLI
would need its own audio stack and UI toolkit to reach the same result.

---

## 3. Architecture

```
src/
  engine/            # pure TS, no DOM/audio — unit tested
    theory.ts        # notes, intervals, scales, key → pitch set
    tuning.ts        # tunings, pitch → (string, fret) mapping
    rhythm.ts        # rhythmic cells (gallops, tremolo, pedal point, breakdown chugs)
    riff.ts          # generator: assembles cells + pitches into Guitar 1's part
    second.ts        # derives Guitar 2's part from Guitar 1 (see §4.6)
    generate.ts      # generateRiff(options): validation + wiring, the engine's entry point
    asciiTab.ts      # text tab for debugging and the CLI preview
    index.ts         # public engine API
    random.ts        # seeded PRNG (mulberry32) for reproducible riffs
    types.ts         # Riff, NoteEvent, TabPosition
  audio/
    guitar.ts        # Tone.js guitar voice (synth + distortion + cab filter), one instance per guitar
    player.ts        # transport: play/stop/loop, BPM, pan, solo/mute, cursor callbacks
  tab/
    renderTab.ts     # Riff → two SVG tab staves, playback cursor
  ui/
    controls.ts      # key / scale / BPM / bars / G2 mode / generate / play
  main.ts
tests/               # vitest unit tests for engine/
```

### Data model (draft)

```ts
type NoteEvent = {
  step: number;          // position on the 16th-note grid
  duration: number;      // in 16ths; gaps between notes are rests
  midi: number;
  palmMute: boolean;
  accent: boolean;       // louder hit, keeps the pulse clear without drums
  passing: boolean;      // chromatic passing tone, may be outside the scale
  string: number;        // 1 = highest string … 6 (or 7) = lowest
  fret: number;
};

type SecondGuitarMode = 'unison' | 'harmony' | 'counter' | 'octave';

type Riff = {
  key: NoteName; scale: ScaleId; bpm: number; seed: number;
  bars: number; timeSignature: [number, number];
  tuning: Tuning;               // shared by both guitars
  guitar1: NoteEvent[];         // rhythm / main riff
  guitar2: NoteEvent[];         // derived part, see §4.6
  guitar2Mode: SecondGuitarMode;
};
```

---

## 4. Findings: how to make it sound like death metal

Random notes from a scale won't sound like death metal. The generator has to
build riffs from the genre's own **rhythmic and melodic patterns**.

### 4.1 Rhythm vocabulary (the most important part)

These are the rhythmic cells the generator chains together:

| Cell | Description |
|------|-------------|
| **Tremolo picking** | Steady 16ths (or 32nds at lower BPM) on one note at a time |
| **Gallop** | 8th + two 16ths (`x-xx`) or the reverse (`xx-x`), palm-muted |
| **Chug / palm-mute bursts** | Open low string with syncopated rests |
| **Pedal-point riff** | Alternates the open low string with higher scale notes |
| **Breakdown** | Half-time, sparse, syncopated chugs |
| **Chromatic run** | 3–4 notes stepping by semitone, often descending |

The generator picks a **riff archetype** for each riff (tremolo, gallop,
chug/groove, breakdown). The archetype sets which cells it uses and how
Guitar 2 behaves by default.

Without drums, the guitars have to carry the pulse on their own. Findings that
affect the design:

- Accents (louder velocity, unmuted notes) go on downbeats and on the
  syncopated hits, so the meter stays clear.
- Silences in chug and breakdown riffs must be truly silent: the note is cut
  off, not left to ring.
- An optional **count-in** (four muted string scratches on Guitar 1) helps the
  listener find the tempo without adding a third instrument.

### 4.2 Scales and harmony

Scales the user can pick (with each scale's intervals in semitones from the root):

| Scale | Intervals | Character |
|-------|-----------|-----------|
| Phrygian | 0 1 3 5 7 8 10 | The core death metal sound (♭2) |
| Phrygian dominant | 0 1 4 5 7 8 10 | "Eastern", Nile-style |
| Locrian | 0 1 3 5 6 8 10 | ♭2 + ♭5, the darkest |
| Natural minor (Aeolian) | 0 2 3 5 7 8 10 | Melodic death metal |
| Harmonic minor | 0 2 3 5 7 8 11 | Neoclassical, melodic |
| Diminished (half-whole) | 0 1 3 4 6 7 9 10 | Dissonant, technical death metal |
| Chromatic | all 12 | Anything goes |

Melodic rules the generator follows, with weighted randomness:

- Come back to the **root (open low string)** often, as a pedal tone.
- Favor **♭2 and ♭5 (tritone)** intervals. The engine weights them up.
- Mostly **stepwise motion**, with occasional leaps of a 4th, a 5th or a tritone.
- Use **power chords** (root + 5th) on chugs and accents as an option. This is
  still a single guitar.
- End each phrase on the root or the ♭2, so the riff loops cleanly.

### 4.3 Tuning and key

Death metal is usually played in drop or down tunings. The proposal is to
choose the tuning from the key, so the root is the **open lowest string**,
which is idiomatic:

| Key | Tuning (as implemented in `src/engine/tuning.ts`) |
|-----|--------|
| E | E standard (E A D G B E) |
| D# | Eb standard |
| D | Drop D |
| C# | C# standard |
| C | Drop C (very common) |
| B | B standard, 7-string |
| A# | Bb standard, 7-string |
| A | Drop A, 7-string |
| F, F#, G, G# | E standard, root fretted on the low string (frets 1–4) |

The tab mapping chooses the (string, fret) position that is cheapest to reach
from the previous note, preferring frets 0–7 on the low strings.

### 4.4 Structure

- 1, 2 or 4 bars in 4/4 (the user picks); the default is 2 bars.
- The riff is built as **phrase A + variation A′**: the same rhythm with the
  last cell changed. Repetition with variation is what makes it sound
  composed rather than random.
- A seed is shown in the UI. Typing a seed back in regenerates the same riff.

### 4.5 Sound (findings)

- A synthesized guitar sounds convincing for death metal if it goes through a
  **heavy distortion, a cabinet-sim low-pass (~5 kHz) and a high-pass (~80 Hz)**.
  Palm mutes come from a short envelope and extra low-pass filtering.
- A sampled guitar (e.g. free DI samples run through the same amp chain) sounds
  better but adds asset weight. Decision: **start synthesized, keep the voice
  interface swappable.**
- Two guitars playing in unison sound thin and "phasey" if they are identical.
  A slight detune (±5 cents), a few milliseconds of timing offset, and a little
  difference in the filter settings make them sound like two players.
- Hard-pan the guitars (G1 left, G2 right) and give each a mute/solo control,
  so either part can be heard alone while reading its tab.

### 4.6 The second guitar

Guitar 1 always plays the generated riff. Guitar 2 is **derived** from Guitar 1,
so the two parts fit together. Four modes (a dropdown, or "Auto" lets the
archetype choose):

| Mode | What Guitar 2 plays | Fits best with |
|------|---------------------|----------------|
| **Unison** (double-track) | The same notes with a small timing/detune offset | Chugs, breakdowns |
| **Harmony** | The same rhythm, each note moved up a diatonic 3rd (or 5th/4th) *inside the chosen scale* | Tremolo and melodic riffs |
| **Counter-melody** | Sustained or tremolo notes over Guitar 1's chugs, chosen from the scale, moving against the bass line | Pedal-point and gallop riffs |
| **Octave** | Guitar 1 one octave up, on the higher strings | Tremolo riffs |

The harmony mode works on scale degrees, not fixed semitones. In Phrygian, a
diatonic 3rd above the root is a minor 3rd, and above the ♭2 it is a major
3rd, which gives the typical dark harmonized lead sound.

---

## 5. UI (draft)

```
┌────────────────────────────────────────────────────────────┐
│ Key [E ▾]  Scale [Phrygian ▾]  BPM [180]  Bars [2 ▾]       │
│ Style [Auto ▾]  Guitar 2 [Harmony ▾]  Seed [48213]          │
│ [🎲 Generate] [▶ Play] [⟳ Loop]                              │
├────────────────────────────────────────────────────────────┤
│ Guitar 1 (L)                                    [M] [S]     │
│ e|-----------------------------------------------------|    │
│ B|-----------------------------------------------------|    │
│ G|-----------------------------------------------------|    │
│ D|-----------------------------------------------------|    │
│ A|------------3--1-----------------6--5----------------|    │
│ E|-0-0-0-0-1-------0-0-0-0-0-0-0-1--------0-0-0-0-0----|    │
│   PM-----                 PM-----------                     │
│ Guitar 2 (R)                                    [M] [S]     │
│ e|-----------------------------------------------------|    │
│ B|-----------------------------------------------------|    │
│ G|-----------------------------------------------------|    │
│ D|-3-3-3-3-5-------3-3-3-3-3-3-3-5---------------------|    │
│ A|------------6--5-----------------10-8----------------|    │
│ E|-----------------------------------------------------|    │
│              ▲ playback cursor (shared)                     │
├────────────────────────────────────────────────────────────┤
│ G1 vol ──●──   G2 vol ──●──   [Count-in ☐]  [Export MIDI]   │
└────────────────────────────────────────────────────────────┘
```

---

## 6. Milestones

1. ✅ **Engine:** theory, tunings, seeded random, rhythm cells, Guitar 1 riff
   generation, Guitar 2 derivation (all four modes), plus unit tests (scale
   correctness, notes inside the scale, bar lengths add up, tab positions are
   playable, Guitar 2 stays in the scale and in time with Guitar 1).
   The tests sweep every key × scale × bar count. `formatAsciiTab` and
   `npm run riff` print riffs as text for checking by eye.
2. **Audio:** Tone.js playback of both guitars (panned, detuned), play/stop/loop,
   BPM changes, mute/solo, count-in.
3. **Tab:** SVG renderer with two staves, palm-mute markings and a shared
   playback cursor.
4. **UI:** controls connected to generate and play, and the seed shown.
5. **Polish:** better guitar tone, MIDI export, sharing a riff via a seed in
   the URL.

---

## 7. Decisions

| # | Question | Decision |
|---|----------|----------|
| Q1 | Platform | **Browser web app** (TypeScript + Vite + Tone.js) |
| Q2 | Which two instruments? | **Two guitars** (G1 riff, G2 derived: unison / harmony / counter / octave) |
| Q3 | Guitar sound | **Synthesized first**, swappable for samples later |
| Q4 | Tab only, or tab plus standard notation? | **Tab only** (custom SVG) |
| Q5 | Tuning | **Follows the key** (root = open low string) |
| Q6 | MIDI / audio export | **MIDI export later**, as a polish item; no audio export |
| Q7 | Default Guitar 2 mode | **Auto**: the archetype picks |
| Q8 | Count-in | **On by default** |

## 8. Open questions

None at the moment.
