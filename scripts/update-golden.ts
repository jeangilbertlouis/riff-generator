// Regenerates tests/fixtures/golden-riffs.json: a regression guard that records what the engine
// produces for 84 fixed cases (every key × the original seven scales). Run it only when a change
// to the generated riffs is deliberate:  npm run golden
import { writeFileSync } from 'node:fs';
import { generateRiff } from '../src/engine/generate.ts';
import { NOTE_NAMES, type Bars, type ScaleId } from '../src/engine/types.ts';
import { riffDigest } from '../tests/digest.ts';

// A fixed list, not SCALE_IDS: adding a scale must not shift the seeds of the recorded cases.
const SCALES: ScaleId[] = ['phrygian', 'phrygianDominant', 'locrian', 'naturalMinor', 'harmonicMinor', 'diminished', 'chromatic'];

const cases: { key: string; scale: string; bpm: number; bars: Bars; seed: number; hash: string }[] = [];
let seed = 11;
for (const key of NOTE_NAMES) {
  for (const scale of SCALES) {
    const bars = ([1, 2, 4] as const)[seed % 3] as Bars;
    const opts = { key, scale, bpm: 60 + ((seed * 37) % 200), bars, seed };
    cases.push({ ...opts, hash: riffDigest(generateRiff(opts)) });
    seed += 7919;
  }
}

const path = new URL('../tests/fixtures/golden-riffs.json', import.meta.url);
writeFileSync(
  path,
  JSON.stringify(
    {
      note: 'Regression guard: musical content of 84 riffs (engine defaults). Regenerate with `npm run golden` only for deliberate changes.',
      cases,
    },
    null,
    1,
  ),
);
console.log(`${cases.length} riffs recorded`);
