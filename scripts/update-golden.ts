// Regenerates tests/fixtures/golden-riffs.json: a regression guard that records what the engine
// produces for 84 fixed cases (every key × scale). Run it only when a change to the generated
// riffs is deliberate:  npm run golden
import { writeFileSync } from 'node:fs';
import { generateRiff } from '../src/engine/generate.ts';
import { SCALE_IDS } from '../src/engine/theory.ts';
import { NOTE_NAMES, type Bars } from '../src/engine/types.ts';
import { riffDigest } from '../tests/digest.ts';

const cases: { key: string; scale: string; bpm: number; bars: Bars; seed: number; hash: string }[] = [];
let seed = 11;
for (const key of NOTE_NAMES) {
  for (const scale of SCALE_IDS) {
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
