import { NOTE_NAMES, type NoteEvent, type Riff, type Tuning } from './types.ts';

const COL = 3; // characters per 16th step

/** Plain-text tab for one part: one row per string, bar lines every 16 steps, a PM row for palm mutes. */
export function formatPartTab(notes: NoteEvent[], tuning: Tuning, totalSteps: number): string {
  const names = tuning.openStrings.map((m) => (NOTE_NAMES[m % 12] as string).padEnd(2));
  // The top string is written lowercase, as in common tab.
  names[0] = (names[0] as string).toLowerCase();

  const rows = tuning.openStrings.map(() => [] as string[]);
  const pm: string[] = [];
  const byStep = new Map(notes.map((n) => [n.step, n]));

  for (let step = 0; step < totalSteps; step++) {
    if (step > 0 && step % 16 === 0) {
      rows.forEach((r) => r.push('|'));
      pm.push(' ');
    }
    const n = byStep.get(step);
    rows.forEach((r, i) => {
      if (n && n.string === i + 1) r.push(String(n.fret).padEnd(COL, '-'));
      else r.push('-'.repeat(COL));
    });
    pm.push((n?.palmMute ? 'x' : ' ').padEnd(COL));
  }

  const lines = rows.map((r, i) => `${names[i]}|${r.join('')}|`);
  lines.push(`PM ${pm.join('')}`.trimEnd());
  return lines.join('\n');
}

export function formatAsciiTab(riff: Riff): string {
  const header = `${riff.key} ${riff.scale}, ${riff.bpm} BPM, ${riff.bars} bar(s), ${riff.tuning.name}, ` +
    `${riff.archetype}, ${riff.complexity}, G2 ${riff.guitar2Mode}, seed ${riff.seed}`;
  return [
    header,
    '',
    'Guitar 1',
    formatPartTab(riff.guitar1, riff.tuning, riff.totalSteps),
    '',
    `Guitar 2 (${riff.guitar2Mode})`,
    formatPartTab(riff.guitar2, riff.tuning, riff.totalSteps),
  ].join('\n');
}
