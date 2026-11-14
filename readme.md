# Riff Generator

Generates random death metal riffs. You pick the key, scale and tempo. The app
generates a riff, plays it back with two instruments, and shows the guitar part
as tablature.

> **Status:** All five milestones are done: riff engine, audio, SVG tab, UI,
> and polish (share links, MIDI export, tighter guitar tone). This document
> holds the plan, the findings and the decisions.

## Getting started

Requires Node 22.18+ (the `riff` script runs TypeScript directly).

```bash
npm install
npm test                                  # engine unit tests
npm run riff -- E phrygian 200 2 1234 extreme   # print a riff as text tab: key scale bpm bars [seed|-] [complexity]
npm run dev                               # the app at http://localhost:5173
npm run build                             # static build in dist/
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
    complexity.ts    # complexity levels: profiles (range, leaps, cells, groupings, variation) and odd groupings
    second.ts        # derives Guitar 2's part from Guitar 1 (see §4.6)
    generate.ts      # generateRiff(options): validation + wiring, the engine's entry point
    asciiTab.ts      # text tab for debugging and the CLI preview
    index.ts         # public engine API
    random.ts        # seeded PRNG (mulberry32) for reproducible riffs
    types.ts         # Riff, NoteEvent, TabPosition
  audio/
    schedule.ts      # pure: Riff → timed events in transport ticks, count-in, loop points
    mixer.ts         # pure: mute/solo/volume → per-guitar gain
    guitar.ts        # Tone.js guitar voice (synth + distortion + cab filter), one instance per guitar
    countIn.ts       # Tone.js muted-string scratch for the count-in
    player.ts        # transport: play/stop/loop, BPM, pan, solo/mute, cursor callbacks
  tab/
    layout.ts        # pure: Riff + width → systems, staves, note positions, palm-mute groups
    renderSvg.ts     # pure: layout → SVG markup
    TabView.ts       # DOM: mounts the SVG, re-lays out on resize, moves the playback cursor
  ui/
    settings.ts      # pure: settings model, BPM/seed parsing, labels, → GenerateOptions
    share.ts         # pure: settings ⇄ URL query string
    app.ts           # DOM wiring: controls, mixer, keyboard shortcuts, tab + player
  export/
    midi.ts          # pure: Riff → Standard MIDI File bytes (2 guitar tracks + tempo track)
  styles.css         # page styles, light/dark theme variables
  main.ts            # mounts the app
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

The tab mapping prefers playing **up the fretboard** (frets 5–12) over open
strings and the first frets, while keeping the hand in one area. §6.7 has
the details.

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
2. ✅ **Audio:** Tone.js playback of both guitars (panned, detuned), play/stop/loop,
   BPM changes, mute/solo, count-in. Detailed plan and findings in §6.1.
3. ✅ **Tab:** SVG renderer with two staves, palm-mute markings and a shared
   playback cursor. Detailed plan and findings in §6.2.
4. ✅ **UI:** controls connected to generate and play, and the seed shown.
   Detailed plan and findings in §6.3.
5. ✅ **Polish** (detailed plan and findings in §6.4): better guitar tone, MIDI export, sharing a riff via a seed in
   the URL.

### 6.1 Milestone 2 plan: audio

**Library:** Tone.js 15.1 (the current `latest` release). It handles the
transport, looping, tempo changes and the effects chain.

**Signal chain (one per guitar):**

```
Synth (fat sawtooth, 2 voices, ±12 cents)
  → pre-filter (low-pass; ~3.5 kHz open, ~700 Hz palm-muted)
  → Distortion (0.9, 4× oversampling)
  → high-pass 90 Hz → EQ3 (mid scoop) → low-pass 4.5 kHz, 24 dB/oct (cab sim)
  → Panner (G1 −0.8, G2 +0.8) → volume → mute/solo gain
→ master: Compressor → Limiter → output
```

- **Palm mute:** the pre-filter closes per note and the note gets a shorter release.
- **Accent:** velocity 1.0; other notes 0.75.
- **Double-tracking:** Guitar 2 is detuned +6 cents and plays 8 ms late, so
  the two parts sound like two players.
- **Count-in:** four short noise bursts, band-passed and distorted (a muted
  string scratch), on their own centered chain so mute/solo don't affect them.

**Timing:**

- Riff steps map to transport ticks (16th = PPQ/4).
- When the count-in is on, the riff starts one bar later. The loop runs from
  the end of the count-in to the end of the riff, so the count-in plays only
  once.
- BPM changes apply live through `transport.bpm`. Note lengths are converted
  to seconds when each note plays, so they follow the new tempo.
- With looping off, the transport stops at the end of the riff.
- The cursor callback reports the current step (or the count-in beat) through
  `Tone.Draw`, so the tab in milestone 3 can follow it.

**Testing:**

- `schedule.ts` and `mixer.ts` are pure and covered by unit tests.
- The sound itself is checked in the browser with an offline render: the
  output isn't silent, G1 sits in the left channel and G2 in the right, and
  a muted guitar is silent.

**Temporary controls:** the preview page gets play/stop, BPM, loop, count-in,
and mute/solo per guitar, so the sound can be heard before the real UI
(milestone 4).

**Findings while building it:**

- **Tone.Offline and globals.** Tone swaps its global context only while the
  `Offline` setup callback runs. Anything that calls `Tone.getTransport()`,
  `Tone.Ticks()` or `Tone.getDraw()` later, inside a scheduled event, reaches
  the real-time transport and its tempo, not the offline one. The player
  therefore binds its transport on first use, converts ticks to seconds with
  that transport's own BPM, and uses `transport.context.draw`.
- **Duplicate events.** Tone's clock sometimes invokes the same transport
  event in two consecutive audio blocks, with times that differ only by
  floating-point drift. On a monophonic `Synth` the second attack throws
  "Start time must be strictly greater than previous start time". The voices
  ignore an attack within 0.1 ms of the previous one (`DUPLICATE_WINDOW`).
  Real notes are always at least about 58 ms apart (a 16th at 260 BPM).
- **Mute at start.** A gain ramp that starts at time 0 lets the first note of a
  muted guitar through for 20 ms. Mixer changes made while stopped are
  therefore applied immediately, and only ramp during playback.

**Verified:**

- Offline renders of six riffs, covering every archetype, every Guitar 2 mode
  and 60–260 BPM: note lengths match the schedule, muted output is exactly
  silent, G1/G2 are panned left/right (about 6:1 RMS), and peaks stay at or
  below about 0.5, so nothing clips.
- In real time in the browser: the count-in plays once, the loop wraps,
  a BPM change applies live (6 steps/s at 90 BPM), loop-off stops at the end
  of the riff, and the console has no errors.
- Not checked by machine: whether the tone sounds good. That needs ears.
  Tone improvements are planned for the polish milestone.

### 6.2 Milestone 3 plan: SVG tab

**Split into three layers**, so most of the work can be tested without a browser:

| Module | Role | Tested by |
|--------|------|-----------|
| `tab/layout.ts` | Pure: riff + width → systems, staves, note positions, palm-mute groups | Unit tests |
| `tab/renderSvg.ts` | Pure: layout → SVG markup string | Unit tests (string checks) |
| `tab/TabView.ts` | DOM: mounts the SVG, re-lays out on resize, moves the cursor | Browser |

**Layout rules:**

- **Systems:** a system is one row holding both staves (Guitar 1 above,
  Guitar 2 below) for the same bars, like a two-part score, so one cursor
  line runs through both.
- **Rhythm by spacing:** every 16th step gets the same width. Tab has no note
  stems, so faint beat ticks every 4 steps and bar lines make the rhythm
  readable.
- **Wrapping:** the number of bars per row is decided at 18 px per step. The
  row is then stretched to fill the width, up to 30 px per step. Rows are
  balanced, so 4 bars that fit 3 per row become 2 + 2, not 3 + 1. With one
  bar per row the step can shrink to 14 px. Below about 270 px even that
  doesn't fit; the tab container then scrolls sideways, and the page never
  does.
- **Labels:** string names on the left (top string lowercase); a staff header
  such as "Guitar 1 (L)" or "Guitar 2 · harmony (R)"; bar numbers above each
  bar.
- **Fret numbers** sit on the string line with a background-colored halo
  (`paint-order: stroke`), so the line appears broken behind the number.
  Chromatic passing tones get a muted color.
- **Palm mutes:** a "P.M." label with a dashed line under each group of
  consecutive palm-muted notes. A group breaks at an open note, at a rest of a
  beat or longer, or at a line wrap.
- **Theming:** colors come from CSS variables (`--tab-line`, `--tab-text`,
  `--tab-bg`, `--tab-muted`, `--tab-accent`, `--tab-cursor`) with fallbacks,
  so the real UI (milestone 4) can theme it for light and dark.
- **Accessibility:** the SVG has `role="img"` and a label summarizing the riff
  (key, scale, tuning, bars).

**Cursor:** `TabView.setCursor(position)` takes the player's
`CursorPosition`. It shows a translucent column over the current step across
both staves of the active system, and highlights the notes that start on that
step. During the count-in the cursor is hidden. Only DOM attributes change, so
the SVG is never re-rendered during playback.

**Findings while building it:**

- **Stale cursor after Stop.** Cursor updates are queued on `Tone.Draw` ahead
  of time, so some arrived after Stop and left a cursor stuck on the tab. The
  player now cancels the Draw queue on stop and drops cursor events when not
  playing.
- **Header collision.** On a counter-melody or octave part the top-string
  notes ran into the staff title. The header got more room (28 px).
- **Wrapping too early.** Deciding the row fit at 22 px per step put 2 bars
  on 2 rows at about 700 px. Deciding at 18 px and then stretching keeps them
  on one row.
- **Short palm-mute groups** showed a stub line ("P.M. -!"). They now show
  the "P.M." label alone.

**Verified:**

- 23 unit tests cover row fitting and balancing, that every note is placed
  once on its own string, rhythmic spacing, 7-string labels, palm-mute
  grouping, that the cursor column lines up with the notes, and that the SVG
  output is well-formed, labelled and uses only CSS-variable colors.
- In the browser, with a 4-bar B Locrian riff at 240 BPM:
  - The cursor passed through all 4 rows, with only one ever visible.
  - It lined up with the highlighted note in 302 of 302 samples.
  - Stop left no cursor and no highlighted notes.
- On a phone-width screen (375 px) the tab was 342 px inside a 343 px
  container, with no sideways page scroll. Resizing to 734 px re-laid it out
  from 4 rows to 2. The console showed no errors.

### 6.3 Milestone 4 plan: the real UI

Replaces the temporary preview page. It stays a single page with no framework:
a few dozen controls don't need one, and plain TypeScript keeps the bundle
small.

**Layout** (top to bottom; it stacks on phones):

1. **Header:** the app name and a one-line description.
2. **Riff panel:**
   - Settings: key, scale, bars, style (Auto, Tremolo, Gallop, Chug,
     Breakdown) and Guitar 2 (Auto, Unison, Harmony, Counter-melody, Octave).
   - Tempo: a BPM slider with a number box, 60–260.
   - Seed: a number box with a copy button.
   - Actions: a primary **Generate** button and a large **Play/Stop** button.
   - Toggles: Loop and Count-in. Four count-in dots light up during the
     count-in.
3. **Riff summary:** tuning, the style and Guitar 2 mode that "Auto" picked,
   and the seed.
4. **Mixer:** for each guitar, Mute and Solo toggle buttons (`aria-pressed`)
   and a volume slider (−24 to +6 dB).
5. **Tab:** the SVG tab from milestone 3, with the playback cursor.

**Behavior:**

| Action | Result |
|--------|--------|
| **Generate** | New random seed, current settings, new riff |
| Change key / scale / bars / style / Guitar 2 | Regenerate with the **same seed**, so the same "idea" can be heard in another key or scale |
| Edit the seed (Enter or leaving the field) | Valid (whole number 0–4294967295): regenerate. Invalid: the field is marked invalid with a message and the riff is kept |
| Change BPM | Tempo changes live. The value is also used for the next generation, where in Auto it influences the style choice |
| Regenerate while playing | The new riff starts at once, **without** another count-in |
| Mute / Solo / volume | Applies live |

A riff is fully described by key, scale, bars, style, Guitar 2 mode, BPM
and seed. Sharing riffs through the URL is part of the polish milestone.

**Keyboard:**

- <kbd>Space</kbd> plays or stops, <kbd>G</kbd> generates and <kbd>L</kbd>
  toggles the loop.
- These shortcuts are ignored while typing in a field or when a button has
  focus, because <kbd>Space</kbd> already presses the focused button.

**Theme:**

- Light and dark come from `prefers-color-scheme`, using one set of CSS
  variables that also feeds the tab's `--tab-*` colors.
- The red accent signals "metal" without hurting contrast. Focus outlines
  are visible.

**Code:**

- `ui/settings.ts` (pure, unit tested): the settings model, defaults,
  parsing and validating BPM and seed, labels, and settings → generate
  options.
- `ui/app.ts`: the DOM wiring.
- `styles.css`: the page styles.
- `main.ts`: only mounts the app.

**Findings while building it:**

- **Mixer overflow.** At 734 px the two mixer channels in a `1fr 1fr` grid
  were wider than the panel and made the whole page scroll sideways. The grid
  now uses `repeat(auto-fit, minmax(min(100%, 330px), 1fr))`, so the channels
  stack when there isn't room.
- **Field wrapping.** At tablet width the Guitar 2 selector wrapped onto a row
  of its own. A smaller base width for the wide fields keeps all five settings
  on one row.
- **TypeScript and CSS imports.** Importing `styles.css` needs the
  `vite/client` types in `tsconfig.json`.

**Verified in the browser:**

- **Settings:** changing the key keeps the seed and gives a new riff (Drop C).
  Switching back to E gives exactly the same tab as before.
- **Seed:** Generate picks a new seed. Typing the old seed back reproduces
  the original riff. An invalid seed ("12a") shows the message, sets
  `aria-invalid` and keeps the riff; Escape restores the field.
- **BPM:** the slider and the number box stay in sync, and 999 is clamped
  to 260.
- **Mixer:** Solo on Guitar 2 marks Guitar 1 as silent, and Mute toggles
  `aria-pressed`.
- **Keyboard, with real key presses:**
  - Space starts playback, and the count-in dots light 1 → 4 before bar 1.
  - G during playback goes straight into the new riff, with no count-in.
  - L turns the loop off, and Space stops with no cursor left behind.
- **Layout:** no sideways page scroll at 734 px or at 375 px (phone, light
  theme), and the tab fits its container. Light and dark themes both apply
  to the tab.

### 6.4 Milestone 5 plan: polish

Three independent pieces.

**1. Sharing a riff through the URL** (`ui/share.ts`, pure and unit tested)

- **Query string:** for example
  `?key=E&scale=phrygian&bars=2&style=auto&g2=auto&bpm=180&seed=48213`.
  `bpm` is the tempo the riff was **generated** with. An extra `tempo`
  parameter appears only when the playback tempo was changed afterwards.
  - Why both: in Auto, tempo influences the style choice. Encoding only
    the playback tempo could give the recipient a different riff from the
    one the sender hears.
- **Updating the address bar:** after every regeneration and every committed
  tempo change it is updated with `history.replaceState`, so it doesn't fill
  the browser history. Tempo updates happen when the slider is released, not
  on every move, which avoids browser rate limits on `replaceState`.
- **Opening a link:** each value is checked separately. An invalid or
  missing value falls back to the default, and a missing seed gets a random
  one. A bad link never breaks the page.
- **Copy link** button in the tablature header.

**2. MIDI export** (`export/midi.ts`, pure and unit tested; no dependency)

- **File format:** a Standard MIDI File, format 1, at 480 ticks per quarter
  note.
  - Track 0: tempo, 4/4 time signature and the riff name.
  - Track 1 (Guitar 1) and track 2 (Guitar 2): channels 1 and 2, GM program
    31 "Distortion Guitar", panned left and right.
- **What's in it:** one pass of the riff, with no count-in. Note lengths and
  velocities match what the app plays: palm mutes shorter and slightly
  softer, accents louder.
- **Event order:** at the same tick, note-offs come before note-ons, so
  repeated notes on the same pitch retrigger properly.
- **Testing:** the tests read the file back with a small parser and check
  the header, tempo, and every note's pitch, start and length.
- **Download:** a **Download MIDI** button saves
  `riff-E-phrygian-180bpm-48213.mid`.

**3. Better guitar tone** (`audio/guitar.ts`)

Standard high-gain techniques the current chain lacks:

- **Tight boost before the distortion:** a high-pass around 110 Hz and a mid
  hump (+6 dB at 900 Hz), like an overdrive pedal in front of an amp. Low
  palm mutes stop turning to mud, and the riff cuts through.
- **Pick attack:** a very short burst of filtered noise into the distortion
  on each note, so notes start like a pick hitting a string rather than like
  a synth.
- **Cab-style EQ after the distortion:** a mid scoop (−4 dB at 450 Hz), a
  presence bump (+3 dB at 2.8 kHz) and a steeper low-pass at 5.5 kHz. This
  replaces the 3-band EQ.
- **Settings in one place:** all tone values live in one `TONE` object, so
  they are easy to tune by ear later.

Only the absence of problems can be checked by machine: no clipping, no
silence, no errors. Whether it sounds better needs ears. The previous tone
stays in git history for comparison.

**Findings while building it:**

- **Why a share link carries two tempos.** Tested with seed 229265: the sender
  generated at 180 BPM, which Auto turned into a Chug riff, then slowed
  playback to 100. Generating at 100 BPM would have given a Breakdown riff
  instead. The link therefore stores both: `bpm=180&tempo=100`.
- **Shared note shaping.** Note length and velocity rules now live in one
  place (`soundingFraction` and `noteVelocity` in `audio/schedule.ts`), used by
  both the audio and the MIDI export, so they can't drift apart.
- **Tone, measured.** Band levels (in dB) of the left channel were measured on
  two fixed riffs before and after the change:

  | Riff | Measure | Before | After |
  |------|---------|--------|-------|
  | Chug | 60 Hz minus 900 Hz | 19.4 | 12.8 |
  | Chug | 1.8 kHz | −19.1 | +0.6 |
  | Chug | 5 kHz | −12.8 | −5.9 |
  | Tremolo | 60 Hz minus 900 Hz | 27.3 | 16.9 |

  The old tone was very bottom-heavy. The new chain shifts energy into the
  mids and presence. RMS dropped by about 3 dB because the pick transient
  raises the peaks, so the output level went from −6 dB to −3.5 dB. Peaks are
  now about 0.65, below the −1 dB limiter.
- **Rendering speed.** Offline renders now run at about real-time speed in the
  browser pane (5.3 s for 5.9 s of audio). Tone advances its offline clock in
  JavaScript, so this says little about real-time CPU load. Real-time playback
  had no errors, but CPU use was not measured.
- **Dev-server caching.** Vite once served a stale transform of `guitar.ts`
  from between two quick edits. Touching the file fixed it. This only affects
  development, not the build.

**Verified:**

- **Unit tests (108 in all):**
  - 7 for share links: round-trip, escaping `#`, when `tempo` is added, that
    a link reproduces the riff, and per-value fallback on bad input.
  - 16 for MIDI: a separate parser reads every file back and checks the
    header, tempo, time signature, channels, program, pan, End of Track, and
    every note's pitch, start, length and velocity, for every key and scale.
- **In the browser:**
  - A link with `key=C%23…&bpm=200&seed=4242&tempo=150` restores every
    control. The tab matches that riff, and Download MIDI produces exactly
    the expected bytes, named `riff-Cs-locrian-150bpm-4242.mid`. The download
    was intercepted rather than saved.
  - A link full of invalid values opens normally on the defaults and
    rewrites itself into a clean link.
  - Changing the tempo adds `tempo=`, and opening that link fresh reproduces
    the sender's tab exactly.
  - Copy link reports success. Reading the clipboard back is blocked in the
    preview pane, so its contents were not read back.
  - Offline renders of chug, tremolo, gallop and breakdown riffs with the new
    tone: no NaNs, peaks about 0.65, and muted guitars exactly silent.
  - On a phone the share and MIDI buttons wrap below the heading, with no
    sideways page scroll.
- **Not verified:** how the new tone actually sounds.

### 6.5 Tone revision: punch and precision

**Feedback:** the guitar sound was "not very distinct". It should be punchier
and more precise.

**Measurement:** each guitar voice was rendered offline with exact note
times, bypassing the transport (see the findings below). For every note:

- **Attack:** the level of the first 15 ms compared with the body 50–90 ms in.
  Positive means a note starts harder than it sustains, which is punch.
- **Separation:** the level in the 6 ms just before the next note compared
  with the note's attack. More negative means cleaner gaps, which is
  precision.

**Root causes found:**

1. **The master compressor ate the attack.** Web Audio's compressor looks
   ~6 ms ahead, so with a 5 ms attack it ducked each note's first milliseconds.
   Raw synth peaks of about 0.38 came out at 0.15–0.22.
2. **Distortion flattens any envelope in front of it**, so nothing restored a
   transient after the amp.
3. **Notes ran into each other:** long note lengths, a 50 ms release and a
   high-sustain amp left almost no dip between back-to-back notes (about −1 dB).
4. **Smearing:** a wide oscillator detune (±12 cents) and Guitar 2 sitting
   8 ms late blurred every onset.

**Changes:**

| Where | Before | After |
|-------|--------|-------|
| Master compressor | −18 dB threshold, 4:1, 5 ms attack | −14 dB, 3:1, **30 ms attack** (transients pass), soft knee |
| Post-amp note envelope | none | **new per-note shaper after the cab:** 1.5 ms dip, 2 ms rise to a peak scaled by velocity, then down to 72 % (open) or 50 % (palm mute) over 60 / 35 ms, cut 8 ms after the note ends |
| Note length (audio and MIDI) | open 92 %, palm mute 75 % | open 88 %, palm mute 70 % |
| Oscillator detune spread | 12 cents | 5 cents |
| Synth release | 50 ms | 20 ms |
| Distortion | 0.9 | 0.8 (less amp compression, more definition) |
| Pick attack level | −12 dB | −8 dB |
| Guitar 2 doubling | +6 cents, 8 ms late | +4 cents, 4 ms late |

**Results** (both guitars, offline):

| Riff | Attack: before → after | Separation: before → after |
|------|------------------------|----------------------------|
| Chug, 140 BPM | −1.4 → **+4.4 dB** | −33 → −63 dB |
| Gallop, 200 BPM | −1.5 → **+4.4 dB** | −1.5 → **−32 dB** |
| Tremolo, 220 BPM | (no notes long enough) | −0.6 → **−7.4 dB** |

**Trade-off:** average level is 3–6 dB lower than before, because there is
real silence between notes now and the peaks are higher (about 0.82–0.85).
Raising the output further would push the transients into the −1 dB limiter,
whose look-ahead would flatten them again. A first pass with an even shorter
body (+6.6 dB attack) lost too much level and was eased back.

**Findings while doing it:**

- **Fixed output delay:** the chain delays sound by about 16 ms (synth start,
  4× oversampling, compressor look-ahead). It is the same for every note, so
  timing stays tight, but measurements must line up with where the sound
  actually starts.
- **Offline transport timing:** in `Tone.Offline`, transport events start
  20–120 ms late by varying amounts, because Tone moves event times that are
  already past to "now". Offline renders through the transport are fine for
  level and clipping checks, but not for timing measurements. Real-time
  playback uses a 100 ms look-ahead and is not affected.
- **Throttled preview pane:** during this check the browser pane drew only
  about 0.7 animation frames per second even with playback stopped, and
  there were no long tasks. The cursor therefore updated in jumps. That is
  the preview environment throttling the page, not the app.

**Verified:** 108 tests, the type-check and the build pass. Offline renders
through the full player (count-in, all styles, 90–260 BPM) have no NaNs,
peaks of 0.73–0.85 and exactly silent mutes. Real-time playback and
regenerating during playback ran with no console errors. **How it sounds
still needs your ears.** Every value is in `TONE` (`audio/guitar.ts`) and
`MASTER` / `GUITAR2_OFFSET` (`audio/player.ts`).

### 6.6 Engine refinement: complexity

**Feedback:** the riffs should be more complicated. A **Complexity** dropdown
in the UI sets how far the generator goes.

**Levels:**

| Level | In short |
|-------|----------|
| **Simple** | Core cells only, stepwise melody in one octave, lots of pedal tone, no chromatic runs |
| **Normal** | Exactly today's generator. Every existing seed and share link gives the same riff |
| **Complex** (new default) | Odd groupings, style changes within a riff, wider and more dissonant melody, new techniques, a longer variation, a busier Guitar 2 |
| **Extreme** | All of Complex, pushed further, and almost no repetition |

**What complexity controls** (one `ComplexityProfile` per level in `engine/complexity.ts`):

1. **Odd groupings (rhythmic displacement):** a span of 8 or 16 steps is split
   into groups of 3, 5 or 6 steps instead of whole beats, for example
   3+3+2, 3+5, 3+3+3+3+4, 5+5+6 or 6+6+4. Each group starts with an accent, so
   the accents drift across the beat while the riff stays in 4/4. This is the
   core of technical death metal phrasing.
2. **New cells** (Complex and Extreme):
   - groups of 2, 3, 5 and 6 steps for the groupings;
   - a **trill** (two notes alternating);
   - a **broken arpeggio** (leaps of 3 or more semitones, changing direction);
   - a **string-skip** pedal (low root against high notes);
   - an 8-note **chromatic run**.
3. **Style changes within a riff:** the head, tail and variation segments may
   each use a different style (for example tremolo into a gallop).
4. **Melody:**
   - **Range:** 12, 19, 22 and 24 semitones above the root, from Simple to
     Extreme.
   - **Leaps:** big intervals get more weight as complexity rises.
   - **Dissonance:** the ♭2 and tritone get more weight.
   - **Pedal tone:** fewer returns to the root.
5. **Structure:** how much of A′ is new.

   | Level | 1 bar | 2 bars | 4 bars |
   |-------|-------|--------|--------|
   | Simple / Normal | 4 steps | 8 steps | 8 steps |
   | Complex | 4 steps | 8 steps | 16 steps |
   | Extreme | 4 steps | 12 steps | 28 steps (only the opening beat repeats) |

6. **Guitar 2:**
   - **Harmony:** at Complex and above, the interval can change every beat
     (3rds, 4ths, 5ths) instead of staying parallel.
   - **Counter-melody:** gains 8th-note and 3+3+2 rhythms.

**Compatibility:**

- **The engine defaults to Normal**, and Normal draws random numbers in
  exactly the same order as before. The new features only consume randomness
  when their probability is above zero.
- **A golden test** (`tests/fixtures/golden-riffs.json`) holds hashes of 84
  riffs generated *before* this change, covering every key and scale. Normal
  must reproduce all of them.
- **The UI defaults to Complex.**
- **Share links:** the new parameter is `cx`. An old link, which has a seed
  but no `cx`, opens at Normal, so it still plays the riff it was made with.

**Tests:**

- All existing invariants (in scale, monophonic, playable tab, ending, A/A′
  repeat, Guitar 2 modes) are swept across every complexity.
- Averages over 200 seeds each must show that complexity is real:
  - distinct pitches per riff rise from Simple to Extreme;
  - more note starts fall off the beat at Complex and Extreme;
  - Extreme repeats less of the riff.

**Findings while building it:**

- **Measured per level** (Guitar 1, 200 seeds each, E/C/A/D Phrygian, 2 bars):

  | Level | Distinct pitches | Accents off the beat | Kinds of note length |
  |-------|------------------|----------------------|----------------------|
  | Simple | 3.0 | 28 % | 1.7 |
  | Normal | 4.8 | 25 % | 1.6 |
  | Complex | 6.1 | 49 % | 2.4 |
  | Extreme | 6.7 | 53 % | 2.3 |

- **12-step groupings.** At Extreme, A′ repeats only one beat, so on 2 bars
  most material lives in 12-step stretches. With only 8- and 16-step
  groupings, Extreme displaced *less* than Complex (46 % vs 49 %). Adding
  12-step groupings (3+3+3+3, 5+5+2, 6+6, 3+3+2+4) and raising Extreme's
  grouping chance from 0.70 to 0.85 fixed the order.
- **Complex and Extreme mix styles,** so the style shown in the summary is
  the riff's *main* style. Segments may switch, for example a tremolo riff
  whose variation turns into displaced chugs.
- **Old links with a bad seed.** An early version treated any link with a
  `seed` parameter as an old one (opening at Normal), even when the seed was
  invalid. Only a valid seed counts now; otherwise the default applies.
- **Settings layout.** With six settings the last one wrapped onto a
  full-width row. The settings row is now a CSS grid, so wrapped fields keep
  their column width: 4 + 2 on desktop, 2 columns on a phone.
- **Dev-server caching again.** Vite served a stale `generate.ts` (the
  `COMPLEXITIES` usage without its import) from between two quick edits.
  Touching the files fixed it. The build is not affected.

**Verified:**

- 125 tests pass. They include:
  - the golden test: all 84 pre-complexity riffs reproduced at Normal;
  - every invariant swept across the four levels (1,008 riffs);
  - the level-ordering measurements above;
  - grouping, cell and variation-length checks;
  - share links with `cx`, including old links opening at Normal with the
    same riff.
- In the browser:
  - the dropdown defaults to Complex;
  - changing it keeps the seed, regenerates, and updates the summary
    ("Extreme gallop riff …") and the link;
  - the old link `…&seed=229265&tempo=100` opens at Normal as the same Chug
    riff;
  - no sideways page scroll at desktop or phone width;
  - a Complex and an Extreme riff render through the audio player with no
    NaNs (peaks 0.74–0.83) and export to MIDI.

### 6.7 Fingering: play higher up the fretboard

**Feedback:** when writing out the tab, prefer playing notes higher up the
fretboard.

**Before** (60 riffs per complexity, both guitars, every key):

- fretted notes average **fret 2.5–3.2**;
- about **40 %** of notes are open strings, and about a third of those
  (14 % of all notes) could have been fretted elsewhere.

The old mapping was greedy: note by note, it took the position nearest the
previous one, and open strings cost nothing. So it hugged the nut.

**Plan:** replace the greedy choice with an optimizer that looks at the
**whole part at once** (a Viterbi / dynamic-programming search over every
playable position of every note). It minimizes the sum of:

| Cost | Value | Purpose |
|------|-------|---------|
| **Position**: open string | 2.5 | open strings only when nothing else is possible, or when it clearly saves a shift |
| Position: frets 1–4 | 2.0 → 0.5 (lower fret costs more) | nudge notes up the neck |
| Position: frets 5–12 | 0 | the target zone |
| Position: frets 13–17 | 0.5 per fret above 12 | reachable, but not the default |
| Position: frets above 17 | an extra 1 per fret | rarely needed |
| **Hand move** within a stretch (≤ 3 frets) | 0.3 per fret | small reaches are cheap |
| Hand move: a real position shift | 1 + 0.8 per fret | avoid jumping around |
| **String change** | 0.3 per string | prefer staying on nearby strings |

- **Open strings don't move the hand.** The search remembers where the
  fretting hand is across open notes: the open-string pedal root that many
  riffs return to doesn't reset the hand position. That needs a state of
  (position, hand fret), not just position, so the search runs over those
  pairs.
- **The lowest root stays open where it must.** It is on the open low string
  and has no other position. Notes with only one position are unaffected.
- **Nothing musical changes:** same notes, same rhythm. Only string and
  fret move. The golden test now hashes musical content only, so it still
  guards the riffs themselves.

**Tests:**

- every position plays the right pitch;
- a note that can be fretted at 5–12 is never left on an open string or the
  first frets without a reason;
- the whole sweep still produces playable tab;
- fingering statistics: the average fret rises into the target zone, there
  are fewer avoidable open strings, and hand shifts stay moderate.

**Results** (same 60 riffs per level, before → after):

| Level | Average fretted fret | Avoidable open strings | Hand shifts over 5 frets |
|-------|----------------------|------------------------|--------------------------|
| Simple | 2.5 → 4.4 | 11 % → 0 % | 0 → 0 |
| Normal | 2.8 → 5.1 | 14 % → 1 % | 0 → 0 |
| Complex | 3.1 → 5.2 | 14 % → 1 % | 0 → 0 |
| Extreme | 3.2 → 5.1 | 15 % → 1 % | 0 → 1 % |

Across the full test sweep, fewer than 3 % of notes that *could* be fretted
stay open, and over half of notes that fit in frets 5–12 are played there.

**Findings:**

- **Why the average doesn't go higher.** Riffs live around the low root.
  The ♭2, ♭3 and 4th just above the open low string exist **only** on that
  string at frets 1–4. Moving them up would mean changing octaves, which
  would change the music. The fingering changes only where a choice exists.
- **Low notes anchor the hand.** Right after a forced fret-1 note (the ♭2 on
  the lowest string), the optimizer keeps the next few notes near that
  position rather than leaping 5+ frets at speed, then shifts up. For the
  same reason it keeps an open note in place when fretting it would force a
  jump back down. A guitarist would finger it the same way.
- **Higher up, when nothing is forced.** Guitar 2's harmony and octave parts
  benefit most: in A Phrygian (seed 31) the harmony moved from open strings
  and first-position notes to frets 5–8 on the low strings.
- **Tuning knob.** `FINGERING` in `engine/tuning.ts` holds every cost. Raising
  `belowZonePerFret` makes the optimizer shift up the neck more readily.
- **Golden test.** It now hashes musical content only (no string or fret),
  so fingering changes don't register as different riffs. It was regenerated
  *before* the fingering change, from the Normal engine, which the previous
  fixture had proven identical to the original.

**Verified:**

- 133 tests pass, 8 of them new for fingering: costs, a lone note fretted at
  5 instead of open, a melody kept in frets 5–12, an open pedal not resetting
  the hand, the forced open root, no big jumps, a 7-string tuning, and the
  sweep-wide open-string and zone shares.
- The app shows the new fingering: riff seed 31, fretted notes average fret
  6.3, highest fret 8.

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
