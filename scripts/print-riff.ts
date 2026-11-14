// Prints a generated riff as ASCII tab.
// Usage: npm run riff -- [key] [scale] [bpm] [bars] [seed]
// Example: npm run riff -- C phrygian 200 2 1234
import { generateRiff, type Bars, type NoteName, type ScaleId } from '../src/engine/index.ts';
import { formatAsciiTab } from '../src/engine/asciiTab.ts';

const [key = 'E', scale = 'phrygian', bpm = '180', bars = '2', seed] = process.argv.slice(2);

const riff = generateRiff({
  key: key as NoteName,
  scale: scale as ScaleId,
  bpm: Number(bpm),
  bars: Number(bars) as Bars,
  seed: seed === undefined ? undefined : Number(seed),
});

console.log(formatAsciiTab(riff));
