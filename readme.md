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
| R4 | Choose the **BPM** | Range 60–260; the default is 180. Riff length: 1, 2, 4 or 8 bars (§6.17) |
| R5 | **Play back** the riff | In the app, with play/stop and loop |
| R6 | Exactly **two instruments** | **Two guitars**, no bass. A simple drum beat was added to playback later (§6.12) |
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
    harmony.ts       # chords on scale degrees, names, progression templates, chord timeline
    drums.ts         # simple drum beat derived from the style and Guitar 1 (pure, no randomness)
    pad.ts           # synth pad voicings for the backing chords, with smooth voice leading (pure)
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
    drums.ts         # Tone.js synthesized kit: kick, snare, hi-hat, crash
    pad.ts           # Tone.js polyphonic synth pad playing the backing chords
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
so the two parts fit together. Three modes (a dropdown, or "Auto" lets the
archetype choose). Unison was removed in §6.9: Guitar 2 always plays its own part.

| Mode | What Guitar 2 plays | Fits best with |
|------|---------------------|----------------|
| **Harmony** | The same rhythm, each note moved up a diatonic 3rd (or 5th/4th) *inside the chosen scale* | Tremolo and melodic riffs |
| **Counter-melody** | Sustained or tremolo notes over Guitar 1's chugs, chosen from the scale, moving against the bass line | Pedal-point and gallop riffs |
| **Octave** | Guitar 1 one octave up, on the higher strings | Tremolo riffs |
| **Arpeggio** (§6.10) | The chord progression arpeggiated an octave or more up, in 8ths, 16ths or tremolo pairs | Chug and breakdown riffs |

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
| **Complex** (the default until §6.11) | Odd groupings, style changes within a riff, wider and more dissonant melody, new techniques, a longer variation, a busier Guitar 2 |
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
- **The UI defaults to Complex** (changed to Extreme in §6.11).
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

### 6.8 Scale review: chromatic runs

**Feedback:** Harmonic Minor riffs contained chromatic runs, which is wrong
for that scale.

**Review:**

- **Scale definitions are correct.** All seven interval sets were checked
  against theory: Phrygian `0 1 3 5 7 8 10`, Phrygian dominant
  `0 1 4 5 7 8 10`, Locrian `0 1 3 5 6 8 10`, Natural minor
  `0 2 3 5 7 8 10`, Harmonic minor `0 2 3 5 7 8 11`, Diminished half-whole
  `0 1 3 4 6 7 9 10`, and Chromatic (all 12).
- **The problem was not specific to Harmonic Minor.** An audit of 480 riffs
  per scale (every key and complexity) found notes outside the scale in
  **about 18 % of riffs in every scale except Chromatic**, 1–2 % of all
  notes.

  | Where they came from | Why |
  |----------------------|-----|
  | Guitar 1's run cells (`chromRun`, `chromRun8`) | Their `chrom` role steps by semitones whatever the scale. This was by design (§4.1, "chromatic passing tones"); those notes were flagged `passing` and greyed in the tab |
  | Guitar 2 harmony and octave parts | They transpose Guitar 1's passing notes, so they leave the scale too |
  | Trills | Can repeat a passing note |
  | Tests | "every non-passing note is in the scale" allowed all of the above |

- **Why it sounds wrong in Harmonic Minor:** the runs produced ♭7 and ♭2,
  which contradict the scale's defining raised 7th and natural 2nd.
- **Clean paths:** the ending (♭2 only in scales that have one), the
  counter-melody, leaps, string skips and Simple were already strictly in
  the scale.

**Decision:** strict by default, plus a toggle.

- **Runs follow the scale by default.** The run cells keep their rhythm and
  direction, but each step goes to the next note *of the chosen scale*
  instead of the next semitone. In the Chromatic scale that is still a
  semitone, so nothing changes there.
- **The toggle is "Chromatic passing notes"**, off by default and available
  for every scale. Turned on, runs step by semitones as before (flagged
  `passing`, greyed in the tab), and Guitar 2 follows them.
- **Randomness is unchanged:** the run's direction choice draws the same
  random number either way, so rhythm, style and Guitar 2 mode are identical
  with the toggle on or off. Pitches change inside the runs, and also in
  some later notes, because the melody continues from wherever a run ends
  (measured below).
- **Old links** have no toggle parameter, so they open strict. Riffs with
  runs (about 18 %) play the corrected in-scale version, as agreed. Everything
  else in those riffs is unchanged.
- **Golden test:** it now generates with chromatic passing **on**, which is
  exactly the old engine, so it still proves the old riffs are reproducible.

**Changes:**

- Engine option `chromaticPassing` (default `false`), stored on `Riff`.
- `chrom` role: one scale step in the run's direction. A run that would go
  below the root or past the top of the range turns around.
- UI: a "Chromatic passing notes" switch next to the settings. Share
  parameter `chr=1`, present only when it is on. The summary says
  "chromatic passing" when it is on.

**Tests:**

- With the toggle off, *every* note of both guitars is in the scale, for
  every key, scale, bar count and complexity, and nothing is flagged
  `passing`.
- With it on, the old rules apply: passing notes are flagged, and every
  non-passing note is in the scale.
- Runs move by exactly one scale step per note.
- Rhythm and every pitch outside the runs are identical with the toggle on
  and off.
- Share links: `chr`, and old links opening strict.

**Findings while building it:**

- **The toggle doesn't change only the runs.** My plan said everything
  outside the runs would be identical with the toggle on and off. A test
  proved that wrong. Rhythm, style and Guitar 2 mode are identical, but the
  next melodic choices start from wherever a run ends. Measured on 1,152
  riffs (six non-chromatic scales, all keys and complexities): the toggle
  changes **15.7 %** of riffs, and within those about **20 %** of Guitar 1's
  notes. The run-step behavior is therefore tested directly, as a pure
  function (`scaleRunStep`).
- **Harmonic Minor runs now cross the augmented 2nd:** for example F → G♯,
  never through G. They step C → B, never through B♭.

**Verified:**

- **The audit, re-run on the strict default: 0 % of notes outside the scale
  for every scale**, in both guitars, across all keys and complexities.
- 149 tests pass. New ones cover:
  - the scale definitions;
  - every note in the scale with the toggle off (1,008 riffs × 2 guitars);
  - no ♭7 or ♭2 in Harmonic Minor;
  - run steps, including turning around at the ends;
  - toggle behavior, including the Chromatic scale being unaffected;
  - share links with `chr`;
  - the summary.
  - The golden test still proves the old engine is reproducible (toggle on).
- **In the browser** (A Harmonic Minor, Extreme tremolo, seed 2): off, there
  are no passing notes; on, two greyed passing notes, `chr=1` in the link and
  "chromatic passing" in the summary; off again, back to strict. The switch
  fits the settings grid, with no sideways scroll.

### 6.9 Feedback: the G shortcut, and no unison

**1. The G shortcut didn't generate.**

- **Reproduced with real key presses:** G worked when the page itself had
  focus, but did nothing after clicking any button, switch or slider,
  including Generate itself, because focus stays on the clicked control.
- **Cause:** the shortcut handler skipped all shortcuts whenever *any*
  control had focus. That is right for text fields (G is a letter you're
  typing), and for Space on a button or switch (Space presses it). It is
  wrong for G and L on a button, switch or slider.
- **Dropdowns have a related trap:** a letter key jumps to the first
  matching option, so G on a focused dropdown would change Key to G or
  Style to Gallop.
- **Fix:**
  - The decision moves into a pure, unit-tested function
    (`shortcutFor` in `ui/shortcuts.ts`).
  - Shortcuts are ignored only while typing in a text or number field.
  - On buttons and switches, Space is left to the control; G and L still
    work.
  - A dropdown picked with the mouse hands focus back to the page after
    the pick, so the next G or L reaches the app. A dropdown reached with
    the keyboard keeps focus, so keyboard users can still type to jump
    between options.

**2. Guitar 2 should never play in unison.**

- **Unison is removed** from the engine, the Guitar 2 dropdown and Auto.
  Guitar 2 now always plays its own part: harmony, counter-melody or octave.
- **Auto, per style:**

  | Style | Before | After |
  |-------|--------|-------|
  | Tremolo | 70 % harmony, 30 % octave | unchanged |
  | Gallop | 60 % counter, 40 % harmony | unchanged |
  | Chug | always unison | **60 % counter-melody, 40 % harmony** (a lead line or harmonized chugs over the riff) |
  | Breakdown | 60 % unison, 40 % counter | **60 % counter-melody, 40 % octave** |

- **Old links** with `g2=unison` fall back to Auto (per-value fallback).
- **Golden test:** it now hashes Guitar 1 and the style only. Guitar 2 is
  generated after Guitar 1 and has changed on purpose, so Guitar 1 must
  still be identical to the old engine. The fixture is regenerated from the
  current engine *before* this change.

**Verified:**

- **157 tests pass. New ones:**
  - 6 for the shortcut rules: G and L right after a button, switch or
    slider (the reported bug); Space left to buttons and switches; nothing
    while typing or on a keyboard-focused dropdown; modified and repeated
    keys ignored.
  - No riff in the 1,008-riff sweep has a Guitar 2 that doubles Guitar 1
    note for note.
  - Auto never picks unison for any style.
  - Old `g2=unison` links fall back to Auto, and the dropdown offers only
    Auto, Harmony, Counter-melody and Octave.
- **In the browser, with real key presses:**
  - G right after clicking Generate generates. That is the case that failed
    before.
  - G and L right after clicking Play generate (playback continues) and
    toggle the loop.
  - Space on the focused Play button stops playback exactly once.
- **Dropdown focus** (simulated events, since native dropdown menus can't be
  clicked by automation):
  - a mouse pick returns focus to the page;
  - a keyboard pick keeps focus on the dropdown.
- **Auto on the old unison styles:** a Chug riff now gets harmony, and a
  Breakdown riff a counter-melody.

### 6.10 Chord progressions and arpeggios

**Feedback:** the riffs sound too random. Each riff should rest on an
underlying chord progression, and the generator should use it for more
arpeggios.

**Decisions (agreed):**

- It applies to **every level, including Normal**. Old seeds and links
  produce new, chord-based riffs.
- The **low pedal note follows the chord root**, so the riff audibly
  outlines the progression (e.g. E → F → C).
- **Chord names appear above the tab** where chords change, and the summary
  shows the progression in Roman numerals.
- **Guitar 2 gets an Arpeggio mode**, which Auto uses.

**Baseline** (Guitar 1, 216 riffs per level: 12 keys × 6 non-chromatic
scales × 3 seeds, 2 bars; measured independently of any chord model):

| Level | Arpeggio share¹ | Pitch entropy per bar² | Melodic notes fitting the best diatonic chord per half bar³ |
|-------|-----------------|------------------------|-------------------------------------------------------------|
| Simple | 0.2 % | 0.85 bits | 82.6 % |
| Normal | 0.4 % | 1.19 bits | 80.4 % |
| Complex | 5.2 % | 1.51 bits | 79.3 % |
| Extreme | 5.5 % | 1.47 bits | 78.3 % |

¹ Groups of three distinct notes moving one way, all from one diatonic
triad. ² How scattered the pitches are. ³ A weak measure: with only 2–3
melodic notes per half bar, the best of seven triads nearly always fits.
After the change, the fit is measured against the engine's *own* chords.

**Plan:**

1. **Chords** (`engine/harmony.ts`, pure):
   - **Triads:** the chord on scale degree *d* stacks the scale's own thirds
     (*d*, *d*+2, *d*+4 scale steps). That gives the right quality in every
     scale: Phrygian i, ♭II, ♭VI; Harmonic Minor V and ♭III+; diminished
     triads in the half-whole scale.
   - **The Chromatic scale** has no diatonic thirds, so its chords are
     minor triads on chosen roots.
   - **Names:** Roman numerals relative to the key (lowercase = minor,
     ° = diminished, + = augmented, ♭ for lowered roots) and letter names
     (Em, F, C, B°).
2. **Progressions per scale:** hand-picked, idiomatic templates of 2 and 4
   chords, always starting on the tonic.

   | Scale | Examples |
   |-------|----------|
   | Phrygian | i–♭II, i–♭VI–♭II–i, i–iv–♭II–i |
   | Phrygian dominant | I–♭II, I–iv–♭II–I |
   | Locrian | i°–♭II, i°–♭V–♭II–i° |
   | Natural minor | i–♭VI, i–♭VI–♭VII–i |
   | Harmonic minor | i–V, i–iv–V–i, i–♭VI–V–i |
   | Diminished | minor-third axis moves (i°–♭iii°…) |
   | Chromatic | ♭II and tritone moves on minor chords |

3. **Harmonic rhythm:** the progression spans **one half of the riff (A)**
   and repeats in A′, so the A/A′ repetition stays true to the harmony.

   | Riff length | Chords per half | Chord length |
   |-------------|-----------------|--------------|
   | 1 bar | 2 | one beat |
   | 2 bars | 2; sometimes 4 at Complex and Extreme | half a bar (a beat with 4) |
   | 4 bars | 4 (2 at Simple) | half a bar (a bar with 2) |

   Simple always uses 2-chord progressions.
4. **Melody follows the chords:**
   - The **pedal (`root` role)** plays the current chord's root in the low
     register.
   - **Melodic choices** strongly favour chord tones of the current chord.
   - **String skips** reach for chord tones.
   - **The riff ends** on the final chord's root.
   - **Scale runs** stay as passing motion between chord tones.
5. **Arpeggio cells:** a new `arp` role plays the *k*-th chord tone above
   the arpeggio's base (the chord root nearest the current note). Cells:
   - `arpUp`, `arpDown` and `arpBroken` (1-5-3-5), plus `arpRoll` (an
     up-and-down 16th sweep);
   - `tremArp` (tremolo pairs per chord tone) and `tremArpBeat` (a chord tone
     per beat);
   - `pedalArp`: a palm-muted pedal alternating with chord tones;
   - `ringArp`, ringing chord tones for breakdowns;
   - 3-, 5- and 6-step arpeggio groups for the odd groupings.

   They join every style's pool at every level, with more and faster ones as
   complexity rises. The old random-leap "arpeggio" cell becomes a real chord
   arpeggio.
6. **Guitar 2:**
   - **Counter-melody** favours chord tones of the chord under each window,
     and resolves to the final chord's root.
   - **New Arpeggio mode:** chord tones an octave up, following the
     progression, in 8ths, 16ths or tremolo pairs.
   - **Auto now:**

     | Style | Auto |
     |-------|------|
     | Chug | 40 % arpeggio, 35 % counter, 25 % harmony |
     | Breakdown | 45 % arpeggio, 35 % counter, 20 % octave |
     | Gallop | 40 % counter, 30 % harmony, 30 % arpeggio |
     | Tremolo | 60 % harmony, 25 % octave, 15 % arpeggio |

7. **Display:**
   - Chord names above the Guitar 1 staff at each change.
   - Roman numerals in the summary, for example "i – ♭VI – ♭II – i".
   - A chord line in the text tab.
8. **Golden test:** the old one guarded "Normal = old engine", which is
   intentionally no longer true. It becomes a **regression guard** for the
   new engine, regenerated by a script (`scripts/update-golden.ts`) when a
   change is deliberate.

**Tests:**

- Chord qualities and names per scale; templates are valid and start on
  the tonic.
- The progression covers the riff, and both halves have the same chords.
- Every palm-muted pedal note is the current chord's root.
- The riff ends on the final chord's root.
- Guitar 2's Arpeggio mode plays only chord tones, an octave or more up.
- All earlier invariants (strict scale, monophonic, playable, A/A′) still
  hold.
- **Measured against the baseline:** the arpeggio share rises sharply at
  every level, and most melodic notes are tones of the engine's own current
  chord.

**Results** (same 216 riffs per level as the baseline):

| Level | Arpeggio share, before → after | Strong-beat notes on the current chord | Melodic notes on the current chord | Guitar 2 notes on the current chord |
|-------|--------------------------------|----------------------------------------|------------------------------------|-------------------------------------|
| Simple | 0.2 % → **21.4 %** | 91.3 % | 90.5 % | 83.7 % |
| Normal | 0.4 % → **21.8 %** | 88.9 % | 86.1 % | 80.3 % |
| Complex | 5.2 % → **28.1 %** | 79.9 % | 82.0 % | 73.9 % |
| Extreme | 5.5 % → **25.2 %** | 78.9 % | 80.3 % | 75.8 % |

**Findings while building it:**

- **Strong beats needed their own rule.** In the first version, melodic notes
  favoured chord tones equally everywhere, and only 69–85 % of strong-beat
  notes (accents and beat starts) were chord tones. Two changes raised that
  to 79–91 %:
  - chord-tone weight doubles on strong beats;
  - a held tremolo note that crosses into a chord it doesn't belong to is
    re-picked.

  Weak beats keep room for colour: scale runs, trills, and the ♭2/tritone
  weighting at higher levels.
- **Pitch entropy is the wrong yardstick here.** Per-bar pitch entropy rose
  (Normal 1.19 → 1.68 bits), because the pedal now moves between chord roots
  and arpeggios span three chord tones. There are more pitches, but they are
  organized by the harmony. The measures that capture "random" are the
  chord-tone shares above.
- **The counter-melody resolved to the wrong chord.** It used the chord at
  the riff's last step, but its last note can start under the previous chord
  (a sustained note with 4 chords per half). It now uses the chord under the
  last note's attack, like Guitar 1.
- **The harmonic rhythm table was wrong** in the first draft of this plan: 4
  chords per half in a 4-bar riff last half a bar each, not a bar. The table
  is corrected above.
- **Arpeggio accents and the limiter.** Guitar 2's Arpeggio mode first
  accented every beat. With both guitars that pushed the peak of one test
  riff to 0.891, the limiter's −1 dB threshold. Accenting only chord changes
  brought the other test riffs to 0.74–0.84. One riff still touches 0.889 at
  a chord change where both guitars accent together: a brief peak, caught.
- **Chord names fit the tab:** they are at most 3 characters ("C#m", "G#°"),
  in the band under the bar numbers (now 30 px tall).

**Verified:**

- **186 tests pass.** The new ones cover:
  - 12 chord names and numerals across all scales; triads built only from
    scale tones;
  - templates; full timeline coverage, with identical halves starting on
    the tonic; 2 versus 4 chords per half;
  - every palm-muted pedal note being the current chord's root (more than
    1,000 notes), and the pedal moving in most riffs;
  - the arpeggio ladder and fold-back; all 12 arpeggio cells;
  - Arpeggio mode: only chord tones, at least an octave up, repeating per
    half;
  - the counter-melody and Guitar 1 ending on the right chord root;
  - chord names in the SVG tab at three widths;
  - the "less random" thresholds per level.
  - All earlier invariants still hold, including the strict scale.
- **Golden test:** it is now a regression guard for this engine (`npm run
  golden` regenerates it after deliberate changes).
- **In the browser:**
  - A Harmonic Minor, 4 bars, Complex: Am Dm E Am above the tab, the summary
    reads "i – iv – V – i", and Guitar 2's arpeggios follow each chord.
  - Arpeggio is offered in the Guitar 2 dropdown.
  - Offline renders have no NaNs, and the console has no errors.

### 6.11 New starting settings

What a fresh page load (a URL without parameters) starts with:

| Setting | Before | Now |
|---------|--------|-----|
| Key | E | E (unchanged) |
| Scale | Phrygian | **Harmonic Minor** |
| Bars | 2 | **4** |
| Complexity | Complex | **Extreme** |
| Count-in | on | **off** |

- **Only the UI's starting settings changed** (`defaultSettings` in
  `ui/settings.ts`, and the count-in switch in `index.html`).
- **The engine's own defaults are unchanged** (Normal, 2 bars), so the golden
  test is unaffected.
- **Share links still say what they contain.** A link with missing values
  falls back to these new defaults, except a link with a seed but no `cx`,
  which still opens at Normal.

### 6.12 Drums

**Request:** a simple drum beat during playback. This revises R6 (two guitars,
no drums): the riff and the tab stay two guitars, and the drums only
accompany playback (and the MIDI export).

**Choices I made** (easy to change):

- **On by default,** with a **Drums** channel in the mixer (Mute, Solo,
  volume), like the guitars.
- **Synthesized, no samples,** to match the guitars and keep the app
  asset-free.
- **Included in the MIDI export** on General MIDI channel 10, so the file
  matches what you hear.
- **Not shown in the tab,** which stays guitar tablature.

**The beat** (`engine/drums.ts`, pure and deterministic, derived from the
riff; no randomness, so riffs and share links don't change):

| Style | Kick | Snare | Hi-hat |
|-------|------|-------|--------|
| **Chug** | locked to Guitar 1's palm-muted hits, plus beat 1 | beats 2 and 4 | 8ths |
| **Gallop** | locked to Guitar 1's palm-muted hits, plus beat 1 | beats 2 and 4 | 8ths |
| **Tremolo** | every beat (a "skank" beat) | every off-beat 8th | quarters |
| **Breakdown** | locked to Guitar 1's palm-muted hits, plus beat 1 | beat 3 only (half time) | quarters |

- **A crash** on the first beat of each half of the riff (A and A′), with no
  hi-hat under it.
- **Accents:** beat-1 kicks and backbeat snares are accented; off-beat hats
  are softer.
- **Locking the kick to the palm-muted chugs** is what makes the drums sound
  like they play *with* the riff rather than over it.
- **The riff's main style decides the beat,** even when Complex or Extreme
  switch style within the riff, so the groove stays steady.

**Sound** (`audio/drums.ts`), centered:

| Piece | Built from |
|-------|------------|
| Kick | a pitched membrane drum with a fast pitch drop, plus a short high noise click for the beater, so it cuts through distorted guitars |
| Snare | a band-passed noise burst plus a short tuned body around 180 Hz |
| Hi-hat | a metallic tone, very short |
| Crash | a long, bright noise wash |

- Every voice gets the same duplicate-event guard as the guitars (§6.1).
- **Count-in:** unchanged (the muted-string scratch).

**Code:**

- `buildSchedule` adds a drum lane.
- The mixer becomes three channels (`guitar1`, `guitar2`, `drums`); mute and
  solo rules work across all three.
- The MIDI writer adds a fourth track, using GM notes 36 kick, 38 snare,
  42 closed hi-hat and 49 crash.

**Tests:**

- **Pattern rules per style:** beat-1 kick in every bar, snare placement,
  crashes, and the hi-hat grid without a hat under a crash.
- **Chug, gallop and breakdown:** the kick lands on every palm-muted
  Guitar 1 note.
- **Every pattern:** stays inside the riff, has one hit per piece per step,
  and is deterministic.
- **Plumbing:** the scheduled drum ticks (with the count-in offset), the
  3-channel mute/solo rules, and the MIDI drum track on channel 10.
- **In the browser:**
  - drums are audible and centered;
  - muting them is silent;
  - peaks stay at or below the limiter;
  - no console errors.

**Findings while building it:**

- **The MetalSynth hi-hat broke under Tone's offline clock.** It restarts six
  internal oscillators per hit and schedules overlapping stops. Even with
  clean, increasing hit times, its own state bookkeeping threw "Start time
  must be strictly greater than previous start time". The hi-hat is now
  high-passed noise with a 40 ms decay, like the other noise-based voices,
  which have been reliable.
- **Late events can collide.** When Tone runs an event late, it moves the
  start up to "now", so two late hits can land on the same instant. All
  voices (guitars, count-in, drums) now apply their duplicate guard to that
  *effective* time (`effectiveTime` in `audio/guitar.ts`), not the requested
  one. This also protects live playback during a CPU hiccup.
- **The first level was far too loud.** At −3 dB the drums out-shouted the
  guitars (RMS 0.19 vs 0.13). The kick's attack pushed the mix to 1.12, past
  full scale, faster than the limiter reacts. The kit now plays at −13 dB.

**Verified:**

- **198 tests pass. New ones:**
  - the beat for each style, written out bar by bar;
  - on generated riffs (every level, style and length): a kick on beat 1 of
    every bar, crashes at the start of each half, the kick on every
    palm-muted note (more than 500 checked), hits inside the riff and
    sorted, no doubles, no hat under a crash;
  - determinism, and the riff's music being unaffected;
  - drum scheduling with and without the count-in;
  - the 3-channel mute/solo rules and the late-event time clamp;
  - the MIDI drum track on channel 10 with GM sounds 36/38/42/49.
  - The golden test is unchanged, so the riffs themselves did not change.
- **Offline renders** of a chug, a tremolo and a breakdown riff:

  | Riff | Drums alone (RMS) | Guitars alone (RMS) | Full-mix peak |
  |------|-------------------|---------------------|---------------|
  | Chug | 0.071 | 0.13–0.15 | 0.80 |
  | Tremolo | 0.060 | 0.17 | 0.90 (the guitars alone reach 0.887) |
  | Breakdown | 0.051 | 0.08–0.14 | 0.87 |

  The drums are centered (left and right RMS equal), and muting
  everything is exactly silent.
- **Live in the browser:**
  - Generate, Play, regenerating during playback and Stop raised no new
    errors.
  - The Drums row is in the mixer: Mute greys it out, and Solo on the drums
    silences the guitars.
- **Not verified:** how the kit sounds. The values are all in `KIT`
  (`audio/drums.ts`).

### 6.13 Feedback: more pronounced kick and snare

**Measured first** (single accented hits through the kit, and the mix):

| | Before | After |
|-|--------|-------|
| Kick peak / body (RMS, 100 ms) | −14.2 / −23.9 dB | **−7.8 / −18.9 dB** |
| Snare peak / body | −19.6 / −35.3 dB | **−9.8 / −24.3 dB** |
| Hi-hat peak | −29.3 dB | −31.0 dB |
| Crash peak | −27.2 dB | −32.2 dB |
| Drums vs guitars (RMS, 5 riffs) | 6–9 dB under | **1.7–5.2 dB under** |
| Full-mix peak | 0.84–0.96 | **0.72–0.81** |

The snare was the main problem: its body sat 11 dB under the kick and barely
above the crash.

**Changes** (`KIT` in `audio/drums.ts`):

- **Snare:** body +10 dB and tuned to G3, a longer body (120 ms) and noise
  tail (200 ms), a wider and lower crack (a 1.8 kHz band instead of
  2.5 kHz, Q 0.6 instead of 0.8), and noise +10 dB.
- **Kick:** +5 dB, and the beater click +10 dB with a lower high-pass
  (2.5 kHz), so it cuts through the guitars.
- **Hi-hat −4 dB, crash −4 dB**, so the kick and snare stand out.
- **Non-accented hits:** kick and snare now play at 85 % velocity (they were
  70 %); hi-hat 55 %, crash 70%.
- **Kit output** −13 → −14.5 dB. Without that, the drums nearly equalled the
  guitars on chug riffs (−0.4 dB), and the riff should stay on top.
- **Master trim −1.5 dB before the limiter** (`MASTER.trimDb`). With the
  louder kick, a locked kick and a guitar pick attack landing together
  peaked at 0.985 on a gallop riff, faster than the limiter reacts. The trim
  lowers everything equally, so the balance above is unchanged.

**Verified:** 198 tests pass, and the build is clean. Live in the browser,
play, regenerating and stopping raised no errors.

- **The dev server stopped once** (exit code 1) right after a production
  build ran alongside it. A restart fixed it; the app code was not involved.
- **Not verified:** how it sounds. That needs your ears.

### 6.14 Key and tuning chosen independently

**Request:** choose the key and the guitar tuning separately. Until now the
tuning followed the key (§4.3).

**Plan:**

- **A Tuning dropdown next to Key**, defaulting to **Auto (follows the
  key)**. Auto is exactly today's behaviour, so existing riffs, links and
  the golden test are unchanged.
- **The tunings offered** (`TUNINGS` in `engine/tuning.ts`):

  | Strings | Tunings |
  |---------|---------|
  | 6 | E standard, E♭ standard, D standard, Drop D, C♯ standard, Drop C♯, C standard, Drop C, B standard, Drop B, Drop A |
  | 7 | B standard, B♭ standard, A standard, Drop A |

- **Where the root goes in any tuning:** the **lowest pitch of the key at or
  above the lowest open string**, at fret 0–11 on the lowest string.
  - E standard in A: the root is A2 (low E string, fret 5, or the open A).
  - Drop C in E: E2 on the low C string, fret 4.

  Everything that follows from the root (the pedal following the chords,
  the melody range, Guitar 2's register, the fingering) works unchanged.
  Auto tunings are the cases where that fret is 0 (or 1–4 for F–G♯, as
  before).
- **Staying playable:** a root up to 11 frets above the open string pushes
  the top of the range up.
  - **Guitar 1's range** was already capped at the highest playable note
    (fret 22 on the top string).
  - **Guitar 2's Octave mode** could go past it, for example in the highest
    keys of a low tuning with a two-octave Extreme melody. Notes that would
    pass fret 22 play a diatonic third above Guitar 1 instead (not unison).
- **Share links** add `tun=<id>` only when a tuning is chosen. Links without
  it, including old ones, use Auto.
- **The summary** already starts with the tuning name, for example
  "Drop C · …".

**Tests:**

- The tuning catalogue: names, 6 or 7 strings, strings ordered from high to
  low, unique ids.
- The root rule, with examples.
- **Every key × every tuning** at every complexity and Guitar 2 mode
  produces playable tab (frets 0–22), stays in the scale, and roots the
  pedal correctly.
- Auto still equals the old key-to-tuning map (the golden test passes
  unchanged).
- Share links round-trip `tun`; invalid values and old links fall back to
  Auto.

**Findings while building it:**

- **The octave guard really is needed.** On a 6-string with a low top
  string and a high root, for example B standard in A♯ (top string B3,
  fret 22 = A5), an Extreme melody an octave up passes fret 22. The test
  sweeps every tuning × key in Octave mode and requires the guard to fire at
  least once. Where it does, Guitar 2 plays a diatonic third instead (3 or 4
  semitones above), never unison.
- **A riff is not a set of options.** One test built options by spreading a
  riff, and a riff's `tuning` is now a tuning *object*, which collides with
  the new `tuning` option. The test now passes explicit options.

**Verified:**

- **212 tests pass. New ones cover:**
  - the 15-tuning catalogue (exact strings for Drop C, Drop D, B standard,
    Drop A and Drop A 7-string);
  - the root rule;
  - Auto matching the old map for all 12 keys;
  - unknown tunings being rejected;
  - **all 720 combinations of key × tuning × level**: playable tab (frets
    0–22, each matching its pitch), in the scale, with the pedal on the
    chord roots;
  - the octave guard;
  - `tun` in share links;
  - the tuning reaching the engine independently of the key.
  - The golden test is unchanged, so Auto is unchanged.
- **In the browser:**
  - The Tuning dropdown (Auto plus 15 tunings) sits next to Key.
  - E in Drop C: the summary says "Drop C", the tab's strings read
    d A F C G C, and the link gains `tun=dropC`.
  - Changing the key to A keeps Drop C, with the pedal at fret 9 on the low
    C string.
  - Back to Auto: A follows the key to Drop A (7-string), and `tun` leaves
    the link.
  - No sideways page scroll.

### 6.15 Chord changes: longer chords and repeats over a new chord

**Feedback:**

- The chord always changes at the same point.
- Sometimes a chord should last twice as long.
- Sometimes the riff should repeat over a different backing chord.
- Both should be selectable in a dropdown.

**Decisions (agreed):**

- **On a repeat over a new chord, Guitar 1 keeps the same notes**, and only
  the pedal and the backing chord change underneath. That's a
  reharmonization, not a transposition.
- **The dropdown defaults to Auto.**

**The "Chord changes" dropdown:**

| Option | Chords over the riff |
|--------|----------------------|
| **Steady** | Today's behaviour: equal chord lengths, and the second half (A′) has the same chords as A |
| **Longer chords** | Three chords where one lasts **twice as long** as the other two, for example 8 + 4 + 4 steps in 1 bar, or a whole bar then two half bars in 2 bars. Where the long chord sits varies (first, middle or last) |
| **Repeat on new chord** | A has its chord(s); A′ repeats the riff over a **different chord**. In 1- and 2-bar riffs that is one chord per half (for example Em, then F); in 4-bar riffs two chords per half, each moved by the same scale step |
| **Auto** (default) | Each riff picks one: 40 % Steady, 30 % Longer, 30 % Repeat (Simple 50/25/25) |

**How it works:**

- **The chord timeline now covers the whole riff,** not just one half that
  repeats, so A′ can have different chords from A.
- **Guitar 1's A′ copies A's notes (as before),** but every **pedal note**
  (the palm-muted chug, or a note held from it) is re-rooted to the chord
  now underneath. Melody notes stay exactly as they were. The A′ variation
  is generated fresh over its own chords, as before.
- **Guitar 2:**
  - Harmony and Octave follow Guitar 1.
  - The Counter-melody repeats its notes, like Guitar 1.
  - The **Arpeggio** part is generated chord by chord across the whole
    riff, instead of being copied, so it always arpeggiates the chord
    actually sounding.
- **The drums** follow Guitar 1's rhythm, so they are unchanged.
- **Separate randomness for the Auto choice:** Auto picks its option from its
  own random stream, derived from the seed. When it picks Steady, the riff is
  identical to before.
- **Old links** (a valid seed but no `chg`) open as **Steady**, so they still
  play exactly the riff they were made with. New links carry `chg`.
- **The summary** shows both halves when they differ, for example
  "i | ♭II" or "i | ♭VI – ♭II".
- **The chord names above the tab** already appear wherever a chord starts,
  at any length.

**Tests:**

- **Each option:**
  - the timeline covers the riff without gaps;
  - Steady has equal lengths and identical halves;
  - Longer has three chords, one exactly twice as long as the others;
  - Repeat gives the halves different chords on the same rhythm.
- **Pedal and melody on the repeat:** every palm-muted pedal is the chord
  root (across all options), and A′'s copied melody notes equal A's.
- **Auto:** picking Steady reproduces the explicit Steady riff exactly; old
  links open as Steady.
- **Guitar 2:** the Arpeggio part plays only tones of the chord sounding.
- **Golden test:** unchanged (see the findings below).

**Findings while building it:**

- **The golden test didn't need regenerating.** The *engine's* default is
  Steady (like Normal for complexity); only the UI defaults to Auto. The
  golden test, which uses engine defaults, still passed after the whole
  refactor:
  - the timeline now covering the whole riff;
  - pedal tracking;
  - the Arpeggio part generated chord by chord instead of copied.

  That proves Steady riffs are bit-for-bit unchanged.
- **Pedal notes aren't always palm-muted.** At Simple, a melody note
  sometimes falls back to the pedal root (the pedal-tone weighting), without
  palm mute. Those notes are re-rooted on a repeat too, which is correct. A
  test that recognized pedals only by palm mute flagged them, so it now
  recognizes a pedal as a note on the chord root in both halves.
- **Two existing tests assumed the halves always match:** A′ repeating A,
  and the Arpeggio part repeating per half. They now allow a difference
  only where the chord underneath changed, and only as the new chord's
  root. The main invariant sweep (scale, monophonic, playable, endings)
  now also runs with Auto chord changes.

**Verified:**

- **222 tests pass. New ones cover:**
  - each option's timeline: Steady has equal lengths and identical halves;
    Longer has three chords, one exactly twice as long, in all three
    positions; Repeat keeps the same rhythm with a different chord;
  - the repeat keeping Guitar 1's melody notes exactly, with more than 50
    pedals moving to the new chord's root;
  - Auto using all three options, and Auto-Steady equalling an explicit
    Steady riff;
  - unknown values being rejected;
  - the Arpeggio part following the sounding chord;
  - `chg` links: old links open as Steady, and Auto links reproduce the
    same riff;
  - the dropdown labels and the summary with "|".
- **In the browser:**
  - the dropdown offers Auto, Steady, Longer chords and Repeat on new chord;
  - Repeat shows Em … C above the tab and "i | ♭VI" in the summary;
  - Longer shows Em C B;
  - Steady shows Em B Em B;
  - the link carries `chg`;
  - playback, including switching option mid-play, raised no errors;
  - the settings sit in two rows of four.

### 6.16 Synth track: the backing chords

**Request:** a synth track that just plays the backing chord.

**Choices I made** (easy to change):

- **A sustained pad,** one chord per chord slot, held for the slot's full
  length, so it follows Steady, Longer and Repeat changes.
- **On by default,** with a **Synth** channel in the mixer (Mute, Solo,
  volume), like the other instruments.
- **Included in the MIDI export** as a fifth track (channel 3, GM program
  90 "Pad 2 (warm)").
- **Not in the tab;** the chord names above the tab already show what it
  plays.

**Voicing** (`engine/pad.ts`, pure, derived from the progression, no
randomness, so riffs don't change):

- **Close-position triads** (root, third and fifth within an octave) in the
  middle register: between an octave and about two octaves above the riff's
  root. That sits above the guitars' low pedal and under their leads.
- **Smooth voice leading:** each chord uses the inversion closest to the
  previous chord (the smallest total movement), the way a keyboard player
  would, rather than jumping the whole chord around.

**Sound** (`audio/pad.ts`):

- A soft polyphonic pad: detuned saw voices, a slow attack (80 ms) and a long
  release, then a low-pass filter around 2 kHz, so it fills the space
  without fighting the distorted guitars.
- Centered, and **quieter than the guitars**; levels are measured, as for
  the drums.
- The same late/duplicate-event guard as every other voice.

**Code:**

- The mixer becomes four channels.
- `buildSchedule` adds a pad lane.
- The MIDI writer adds the pad track.

**Tests:**

- The pad covers the progression exactly.
- Every pad note is a tone of its chord: three distinct pitch classes.
- Pad notes stay in range.
- The voice leading moves less than root-position voicings would.
- Scheduling, the 4-channel mixer and the MIDI pad track.
- In the browser: the synth is audible and centered; muting it is silent;
  the peaks are safe.

**Findings while building it:**

- **A root-position chord doesn't always fit the pad's range.** The range is
  16 semitones, and a root-position triad needs 7 semitones above its bass,
  which leaves a 9-semitone window for the bass. Some chord roots fall
  outside it. The pad is fine (it can always use an inversion), but the
  test's root-position comparison needed an octave of headroom.
- **First level, measured** (three riffs: chug/Repeat, tremolo/Longer,
  breakdown/Steady):
  - the synth sits **4–7 dB under the guitars**, perfectly centered
    (left = right);
  - the synth alone peaks at about 0.30;
  - full-mix peaks are 0.78–0.81;
  - muting everything is exactly silent.

**Verified:**

- **231 tests pass. New ones cover:**
  - voicings and voice leading: Em → F moves at most 4 semitones in total,
    and across 144 riffs the pad moves less than 75 % of what root-position
    chords would;
  - one pad chord per chord slot, in all three chord-changes options;
  - three distinct chord tones in close position, in the pad register;
  - the riff being unaffected;
  - pad scheduling with the count-in;
  - the 4-channel mixer;
  - the MIDI pad track (channel 3, program 90, every chord held for exactly
    its slot).
  - The golden test is unchanged.
- **Live in the browser:** the Synth row is in the mixer; Solo on the synth
  silences the guitars and drums; play, regenerating during playback and
  stop raised no errors.
- **Not verified:** how the pad sounds. The values are in `PAD`
  (`audio/pad.ts`).

### 6.17 8-bar riffs

**Request:** generate 8-bar riffs too. In 8-bar mode, chords must never
change within a bar.

**Plan:**

- **Bars: 1, 2, 4 or 8.** The structure stays A (4 bars) then A′ (4 bars).
- **Chords change only on bar lines** in 8-bar mode: every chord starts on a
  bar line and lasts whole bars. With 64 steps per half, the existing
  options give:

  | Chord changes | 8-bar chords |
  |---------------|--------------|
  | Steady | 4 per half (one per bar); Simple: 2 per half (two bars each) |
  | Longer chords | 4 bars + 2 + 2 (a quarter of the riff is 2 bars), in any order |
  | Repeat on new chord | 2 per half (two bars each), moved to new chords in A′ |

  All of these fall on bar lines by construction. A test also asserts it
  for every 8-bar riff.
- **How much of A′ is new** (the variation):

  | Level | 8 bars |
  |-------|--------|
  | Simple, Normal | 1 bar |
  | Complex | 2 bars |
  | Extreme | everything except the opening beat (60 steps) |

  Normal stays close to the shorter riffs' feel (one changed bar out of
  four), and the higher levels repeat less.
- **Everything else already works per bar or per step:** the drums (a kick
  on beat 1 of every bar, a crash at each half), the synth pad, Guitar 2,
  MIDI, and the tab. The tab wraps 8 bars into balanced rows (for example
  3 + 3 + 2, or 4 + 4).
- **UI and links:** the Bars dropdown gains 8, and links accept `bars=8`.

**Tests:**

- The main invariant sweep includes 8 bars: in scale, monophonic, playable,
  ending, A/A′, Guitar 2 modes, chord coverage.
- **Every chord in every 8-bar riff** (all options, levels and keys) starts
  on a bar line and lasts whole bars.
- Variation lengths, the drums' bar-1 kick, the pad covering the chords, the
  tab layout for 8 bars, and links.

**Findings while building it:**

- **A bug from §6.15, found by the 8-bar sweep.** A pedal note **held across
  a chord change** (a tremolo on C♯, the root of C♯m, continuing into F♯m,
  where C♯ is a chord tone) kept its "pedal" mark. When A′ copied it, the
  mark re-rooted it to F♯, so **A′ no longer repeated A even in Steady**.
  - **Fix:** a held note stays a pedal only under the same chord.
  - **Guard:** a new regression test requires Steady's A′ to repeat A
    exactly (2, 4 and 8 bars, every level and key). It **fails** with the
    old line and passes with the fix.
  - **Golden test:** unaffected; none of its cases hit this.
- **Test timeouts.** The larger sweeps (now with 8-bar riffs) pushed one test
  close to Vitest's 5-second default under a parallel full run: it failed
  once and passed alone in 3.9 s. `vitest.config.ts` now sets a 30-second
  per-test limit. Two consecutive full runs passed (about 8 s each).

**Verified:**

- **235 tests pass. New ones cover:**
  - every chord of every 8-bar riff (all three options plus Auto × 4
    levels × 12 keys) starting on a bar line and lasting whole bars;
  - the 8-bar chord lengths for each option;
  - the exact-repeat regression;
  - `bars=8` in links.
  - The main invariant, drum, tab and variation sweeps now include 8 bars,
    and the golden test is unchanged.
- **In the browser,** with E Harmonic Minor at Extreme and the Bars
  dropdown on 8, the tab lays out in rows of 3 + 3 + 2:

  | Chord changes | Chords |
  |---------------|--------|
  | Steady | one per bar (Em C B Em Em C B Em) |
  | Longer | Em (2 bars), C (2 bars), B (4 bars) |
  | Repeat | two bars each (i – V \| V – ii°) |

  Playback raised no errors, and there's no sideways scroll.

### 6.18 Deployment: Azure Static Web Apps (live)

**Live at <https://victorious-sea-0e5b24e03.6.azurestaticapps.net>**
(deployed 2026-11-14 from `main` @ `e645f53`).

**First deploy, verified:**

- **The GitHub Actions run passed in 1 min 4 s:** CI on Node 26.13.1, all
  14 test files passed, the build succeeded, and Azure reported "Deployment
  Complete".
- **Live headers match the config:** `no-cache` and the full security
  policy on the page; `max-age=31536000, immutable` on hashed assets.
- **Live in the browser:**
  - the app loads, styled;
  - after a real click on Play, the playhead advances;
  - MIDI download produces a valid file;
  - a share link reopens the same riff;
  - **no policy violations.**
- **Warnings from the first run,** fixed in the workflow afterwards:
  - `actions/checkout@v4` and `actions/setup-node@v4` targeted the
    deprecated Node 20 runtime, so they moved to `@v5` (Node 24);
  - `skip_api_build` is not an input of `Azure/static-web-apps-deploy@v1`
    (it was ignored), so it was removed.
  - A third notice, that the `ubuntu-latest` label moves to Ubuntu 26, is
    informational only.

#### The original plan

**What we're deploying:** a purely static site.

- `npm run build` produces `dist/` (316 KB: `index.html`, one JS bundle and
  one CSS file).
- **No server and no API calls:** audio, MIDI export and share links all run
  in the browser.
- **No secrets and no stored data:** share links are query strings, so there
  is no database.

**Recommendation: Azure Static Web Apps (Free plan), deployed by GitHub
Actions.**

| Option | Verdict |
|--------|---------|
| **Static Web Apps, Free** | **Recommended.** Built for static sites: free, global CDN, automatic HTTPS, free custom domains, and a preview URL per pull request. Deploys from the GitHub repository we already have |
| Storage account (static website) | Works, and is almost free, but HTTPS on a custom domain needs Front Door or a CDN in front, and there are no PR previews |
| App Service / Container Apps | Overkill: a running server, and a monthly cost, for files that never change at runtime |

**How it would work:**

1. **Push `main` to GitHub.** The repository has the remote
   `jeangilbertlouis/riff-generator`, but the commits are local only.
2. **Create the Static Web App** in the Azure portal (or with `az
   staticwebapp create`) and link it to the repository. Azure adds a
   deployment token to the repository as a secret.
3. **GitHub Actions workflow**
   (`.github/workflows/azure-static-web-apps.yml`), on every push to
   `main` and every pull request:
   - set up **Node 22** (LTS; Vitest needs 22.12 or newer, Vite 20.19 or
     newer);
   - `npm ci` → `npm test` → `npm run build`. **Tests gate the deploy:** a
     failing test stops it;
   - upload the already-built `dist/` with
     `Azure/static-web-apps-deploy@v1` and `skip_app_build: true`, so
     Azure doesn't rebuild with its own Node version;
   - pull requests get their own preview URL, removed when the PR closes.
4. **`staticwebapp.config.json`** (copied into `dist/` at build time):
   - **Caching:** `/assets/*` files have content hashes in their names, so
     they can be cached for a year; `index.html` is always revalidated, so a
     new deploy shows up immediately.
   - **Security headers:** `X-Content-Type-Options`, `Referrer-Policy`, and
     a Content-Security-Policy allowing only the site's own scripts and
     styles. (Tone.js runs from the bundle, and the app needs no external
     hosts.)
   - **No routing rules:** the app is a single page, and share links are
     query strings on `/`.
5. **Optional custom domain:** add it in the portal, and HTTPS is issued
   automatically.

**Cost:** the Free plan covers this: 100 GB of bandwidth a month and 2
custom domains, with no server to pay for.

**Checks after the first deploy:**

- the site loads over HTTPS;
- the first Play starts audio (browsers require a click, which the app
  already handles);
- a share link opens the same riff;
- MIDI download works;
- the response headers are present.

**Status:** the deployment files are in the repository. Creating the Azure
resource and pushing to GitHub are outward-facing steps, so they wait for
your go-ahead.

**What was added:**

| File | Purpose |
|------|---------|
| `.github/workflows/azure-static-web-apps.yml` | On a push to `main`: `npm ci` → `npm test` → `npm run build` → deploy `dist/` to production. On a pull request: the same, to a preview URL, removed when the PR closes |
| `public/staticwebapp.config.json` | Headers and caching. Vite copies it into `dist/` unchanged |

**Changes from the plan:**

- **Node 26 in CI, not 22.** Node 26 is the current LTS release, and it's the
  version the project is developed and tested on (all 235 tests). Node 22
  would have been an untested version.
- **Two Content-Security-Policy allowances, both from reading the code:**
  - `style-src 'unsafe-inline'`: the tab's SVG carries its own `<style>`
    block (`tab/renderSvg.ts`). Without this the tab would render unstyled.
    The risk is low, because the app never injects user-supplied markup.
  - `worker-src 'self' blob:`: Tone.js runs its clock in a Web Worker built
    from a `blob:` URL (`Ticker._createWorker` in Tone 15). Blocked, it
    falls back to a timer, which is less accurate and is throttled in
    background tabs.

**The policy in full:**

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; media-src 'self' blob:; worker-src 'self' blob:;
connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self';
frame-ancestors 'none'
```

The other headers are `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, and a
`Permissions-Policy` turning off camera, microphone and geolocation. Caching
is `immutable` for a year on `/assets/*`, and `no-cache` on `/` and
`/index.html`.

**Verified locally, with production headers:** a small test server served
the built `dist/` with exactly the headers from
`staticwebapp.config.json`.

- **Headers:** the page gets `no-cache` plus every security header, and a
  hashed asset gets `max-age=31536000, immutable`.
- **Under that policy, in the browser:**
  - the app loads, and the page CSS and the tab's inline SVG styles apply;
  - after a real click on Play, the playhead advanced;
  - Generate works;
  - Download MIDI produces a valid file (`MThd`, 1,633 bytes);
  - **no policy violations.** The only one seen during testing came from the
    test's own `fetch()` of the MIDI `blob:` URL, which `connect-src`
    rightly blocks; the app downloads through a link instead.
- `npm run build` copies `staticwebapp.config.json` into `dist/`, and its
  JSON is valid.
- **Not verified:** the workflow itself. It runs only on GitHub, so the
  first push is its test. The YAML follows the action's documented inputs.

**Your steps to go live:**

1. **Create the Static Web App:** Azure portal → Create → Static Web App →
   Free plan → **Deployment source: Other**. Choosing "GitHub" there would
   make Azure commit a second workflow of its own.
2. **Copy the deployment token:** Static Web App → Overview → *Manage
   deployment token*.
3. **Save it in GitHub:** repository → Settings → Secrets and variables →
   Actions → new secret named `AZURE_STATIC_WEB_APPS_API_TOKEN`.
4. **Push `main`.** The workflow tests, builds and deploys, and the site's
   URL appears in the Static Web App's overview.
5. **Optional:** add a custom domain under *Custom domains*.

### 6.19 Guitar 2 "Mixed": switching parts within the riff

**Feedback:** Guitar 2 should be more varied. Within one riff it should
sometimes harmonise, sometimes play a counter-melody, and sometimes
arpeggiate.

**Decisions (agreed):**

- **A new Guitar 2 option, Mixed,** which becomes the **default** for new
  riffs.
- **Auto and the single modes are unchanged,** so old share links (`g2=auto`
  and so on) still play exactly the same riff. The golden test, which uses
  engine defaults, is also unchanged.
- **Mixed switches between Harmony, Counter-melody and Arpeggio** (not
  Octave).

**How the riff is split into sections:**

- **Section boundaries follow the chords:** a section starts at each chord
  change. Sections shorter than half a bar (8 steps) are merged into the one
  before, so no part is shorter than that. Each half of the riff (A and A′)
  is split separately, which handles Steady, Longer and Repeat chord
  changes.
- **Each section gets one of the three parts:**
  - the first section's part is weighted by style (Chug: arpeggio or
    counter; Tremolo: harmony; Gallop: counter; Breakdown: arpeggio);
  - **every next section switches to a different part**, so it never stays
    on one part for two sections in a row.
- **A′ mirrors A** when A has two or more sections, so the riff still feels
  like A then A′. When each half has only one section (a 1-bar riff, or one
  chord per half), A′ simply takes a different part from A.
- **How it's built:** all three parts are generated for the whole riff (each
  already follows the chords), and each section takes the notes that start
  in it. A note that would ring past its section's end is cut there, so
  Guitar 2 stays monophonic and parts don't overlap.

**Code:**

- `SecondGuitarMode` gains `'mixed'`.
- `Riff.guitar2Sections` lists each section's step range and part, so the
  UI can show it.
- The summary lists the parts in the order they first appear, for example
  "Guitar 2: mixed (arpeggio, counter, harmony)".
- The Guitar 2 dropdown gains "Mixed (harmony / counter / arpeggio)", and
  the UI default becomes Mixed. Share links carry `g2=mixed`.

**Tests:**

- Sections tile the riff, each at least 8 steps and starting on a chord
  change.
- Consecutive sections use different parts, and a riff uses at least two
  parts.
- Each section's notes come from its part: a counter section's notes are in
  the counter register; an arpeggio section's notes are chord tones of the
  sounding chord.
- Guitar 2 stays monophonic and in the scale, with every note playable.
- Old links (`g2=auto`) are unchanged, and the golden test passes untouched.

**Findings while building it:**

- **Too few riffs used all three parts.** With "different from the previous
  part" as the only rule, and A′ mirroring A, a 4-bar riff often swung
  between just two parts: only about 19 % of riffs used all three. Two
  changes fixed it:
  - a part not yet used in the riff is weighted ×3 when picking;
  - when A′ mirrors A, its last section switches to the unused part, if
    there is one (A′ still starts like A, and the new part arrives as the
    riff's ending).

  Measured over many seeds afterwards:

  | Bars | Average sections | Riffs using all three parts |
  |------|------------------|-----------------------------|
  | 1 | 2.0 | 0 % (two half-bar sections at most) |
  | 2 | 2.9 | 49 % |
  | 4 | 4.8 | 92 % |
  | 8 | 4.8 | 93 % |

- **Changing the UI default broke old links.** A link that had a seed but
  no valid `g2` (for example the removed `g2=unison`) used to fall back to
  the default, Auto; with Mixed as the default it would have opened with a
  different Guitar 2. Now a link with a seed but no valid `g2` opens as
  **Auto**, and only a fresh visit (no seed) gets Mixed. This is the same
  rule used for `cx` and `chg`.
- **A split can also land at the middle of the riff,** where A′ begins,
  even when no chord changes there (with Longer chords, one chord can span
  the join). The tests allow a section to start either at a chord change or
  at the half.

**Verified:**

- 245 tests pass, `tsc --noEmit` is clean, and `vite build` succeeds. The
  golden fixture is unchanged.
- In the browser:
  - the page opens with Guitar 2 set to Mixed, and links carry `g2=mixed`;
  - a 4-bar Gallop riff ran counter → arpeggio → harmony → arpeggio …, one
    section per chord;
  - the summary reads, for example, "Guitar 2: mixed (arpeggio, counter,
    harmony)";
  - playback, regenerating while playing, and stopping all ran with no
    console errors.

### 6.20 More modes of the harmonic minor scale

**Request:** add more modes of the harmonic minor scale.

**What exists:** Harmonic minor (mode 1) and Phrygian dominant (mode 5).

**Plan:** add the other five modes. Intervals are in semitones from the key's
root; the triads are the scale's own stacked thirds, worked out by the
existing `chordOnDegree`.

| Mode | Name | Intervals | Triads on each degree |
|------|------|-----------|-----------------------|
| 2 | Locrian ♮6 | 0 1 3 5 6 9 10 | i° ♭II+ ♭iii IV ♭V vi° ♭vii |
| 3 | Ionian ♯5 | 0 2 4 5 8 9 11 | I+ ii III IV ♭vi° vi vii° |
| 4 | Ukrainian Dorian (Dorian ♯4) | 0 2 3 6 7 9 10 | i II ♭III ♭v° v vi° ♭VII+ |
| 6 | Lydian ♯2 | 0 3 4 6 7 9 11 | I ♭iii° iii ♭v° V+ vi VII |
| 7 | Ultralocrian (Super-Locrian 𝄫7) | 0 1 3 4 6 8 9 | i° ♭ii ♭iii° III+ ♭v ♭VI VI |

- **Progressions:** each mode gets its own two- and four-chord templates,
  all starting on the tonic and leaning on that mode's colour chord (for
  example ♭II+ in Locrian ♮6, II in Ukrainian Dorian, ♭ii in Ultralocrian).
- **Labels:** each new mode's label names its mode number, for example
  "Locrian ♮6 (harm. minor mode 2)". Phrygian dominant's label gains
  "(harm. minor mode 5)". Links use the ids (`locrianNat6`, `ionianSharp5`,
  `dorianSharp4`, `lydianSharp2`, `ultralocrian`), not the labels.
- **Existing riffs are unchanged:** the existing scales and their
  progressions don't change, so old links still play the same riffs. The
  golden script keeps recording the original seven scales, so its 84 cases
  stay comparable.
- **Tests:**
  - the intervals and some known triads;
  - every template is valid;
  - the existing sweeps (every scale × key: in scale, playable, MIDI, tab)
    cover the new modes automatically.

**Findings while building it:**

- **The modes slot into the engine with no special cases.** Triads,
  arpeggios, pedals, Guitar 2's thirds and runs all work from the scale's
  intervals. A diminished tonic (Locrian ♮6, Ultralocrian) behaves like
  Locrian's; an augmented tonic (Ionian ♯5) is a valid chord with its own
  roman numeral (I+).
- **The new scales exposed an existing bug in chromatic passing.** Adding
  scales moved the test sweeps onto different seeds, and one Chromatic riff
  then came out differently with passing on and off. The cause: a strict
  run turned around at the top of Guitar 1's range, but a chromatic run
  kept climbing past it. Chromatic runs now turn around at either end of
  the range, as scale runs do.
  - Only riffs with chromatic passing on (`chr=1`) change, and only when a
    run reaches the edge of the range: 12 of 1,344 such riffs in a sweep
    across the original scales. Default riffs, and the golden test, are
    unchanged.
- **The golden script now uses a fixed list of the original seven
  scales.** With `SCALE_IDS`, every added scale would shift the seeds of
  the recorded cases.
- **Chord variety** (distinct chords used over 200 four-bar Extreme riffs
  in E): 4–6 per mode, similar to the existing scales.

**Verified:**

- 264 tests pass, `tsc --noEmit` is clean, `vite build` succeeds, and the
  golden fixture is unchanged.
- In the browser, the Scale dropdown lists the five new modes after
  Harmonic minor, and links carry their ids (for example
  `scale=dorianSharp4`). Summaries show each mode's chords, for example:
  - "i° – ♭V | ♭V – ♭II+" (Locrian ♮6);
  - "I+ – IV – III" (Ionian ♯5);
  - "i | ♭III – II" (Ukrainian Dorian);
  - "i° – ♭VI – ♭ii – i°" (Ultralocrian).

  Playback ran with no console errors.

### 6.21 Extreme arpeggios: wider shapes and a flavour note

**Request:** at Extreme, make arpeggios (in either guitar) more complex.
Also allow an extra "flavour" note, so an arpeggio can have 4 unique
notes.

**What changed (Extreme only):**

- **Flavour tones** (`harmony.ts`: `flavourOptions`, `withFlavour`,
  `addFlavours`):
  - Each chord can gain a 4th tone from the scale: its **7th**, **9th** or
    **11th**, built from stacked scale thirds. It is a 7th most often
    (weights 3 : 2 : 1).
  - Options that double a chord tone or blur the 3rd are skipped, for
    example a ♭11, which sounds as a major 3rd.
  - Each scale degree gets one with a 75 % chance at its first appearance,
    and keeps it every time the chord comes back.
  - The Chromatic scale uses the m7, ♭9 or 11.
- **Chord names show the flavour** in the tab, the text tab and the
  summary:
  - names: "Em7", "Em(maj7)", "F#ø7", "D#°7", "Cmaj7", "F(add♭9)";
  - Roman numerals: "i7", "iiø7", "♭II(add♭9)".

  A chord is named with its flavour only if a guitar actually plays that
  tone over it somewhere in the riff. It is then named that way every time
  it comes round, so both halves read the same.
- **Arpeggio shapes** (`riff.ts`: `arpShape`, `shapeNote`):
  - An arpeggio is root, 3rd, 5th, then the flavour above the 5th (a 9th is
    played as a 9th, not a 2nd).
  - Each pass climbs an octave: R 3 5 F R′ 3′ …
  - Out of range, notes fold back by octaves.
- **Guitar 1** gets 4 new cells, alongside the existing ones:
  - `arpSweep`: a two-octave sweep up;
  - `arpSweepDown`: the same sweep down;
  - `arpSkip`: broken thirds (R 5 3 F 5 R′ F 3);
  - `arpTopPedal`: a pedal on the top note, with the chord climbing under
    it.

  Each run of arpeggio notes may also start on the 3rd or 5th (an
  inversion; 3 : 1 : 1 for root, 3rd, 5th). It anchors on a chord root that
  leaves room for the cell's highest note.
- **Guitar 2's Arpeggio mode** (also inside Mixed):
  - **Each chord picks its own pattern and inversion,** and keeps them
    wherever the chord comes back.
  - **Three new patterns:** `roll` (up and back), `skip` (broken thirds) and
    `sweep` (12 steps, so it runs 3 beats against the 4/4).
  - **Wider range:** up to two octaves above its lowest note, instead of
    one, and never above fret 22.
- **Profile fields** (`complexity.ts`): `arpFlavour` (the chance; 0 below
  Extreme), `arpVaries` and `arpRange`. Below Extreme the values draw no
  random numbers and take the old code paths.

**Unchanged:**

- Simple, Normal and Complex riffs: the golden fixture is unchanged.
- The synth pad still plays triads.
- Pedal notes, harmony and counter-melody still favour the triad's tones.

Extreme riffs and links change, as with earlier Extreme refinements.

**Other:** the text tab's chord line now handles names longer than a column
("C#m(add♭9)").

**Tests:**

- chord naming for each kind of flavour;
- flavours are scale tones and never duplicate a chord tone;
- the same chord keeps the same flavour;
- no flavours below Extreme;
- shape and fold arithmetic;
- across 108 Extreme riffs:
  - Guitar 2 plays 4 unique notes over most flavoured chords;
  - it climbs past an octave in most riffs;
  - Guitar 1 uses the wide shapes;
  - a flavour is named only where it is heard.

---

## 7. Decisions

| # | Question | Decision |
|---|----------|----------|
| Q1 | Platform | **Browser web app** (TypeScript + Vite + Tone.js) |
| Q2 | Which two instruments? | **Two guitars** (G1 riff, G2 derived: unison / harmony / counter / octave) |
| Q3 | Guitar sound | **Synthesized first**, swappable for samples later |
| Q4 | Tab only, or tab plus standard notation? | **Tab only** (custom SVG) |
| Q5 | Tuning | **Follows the key** (root = open low string); since §6.14 chosen independently, with Auto as the default |
| Q6 | MIDI / audio export | **MIDI export later**, as a polish item; no audio export |
| Q7 | Default Guitar 2 mode | **Auto**: the archetype picks; never unison (§6.9) |
| Q8 | Count-in | **Off by default** (was on; changed in §6.11) |
| Q9 | Starting settings | **E Harmonic Minor, 4 bars, Extreme**, count-in off (§6.11) |

## 8. Open questions

None at the moment.
