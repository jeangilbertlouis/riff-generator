// Temporary engine preview until the real UI (milestone 4).
import { DEFAULT_BPM, formatAsciiTab, generateRiff } from './engine/index.ts';

const out = document.querySelector<HTMLPreElement>('#tab');
const button = document.querySelector<HTMLButtonElement>('#generate');

function show(): void {
  if (out) out.textContent = formatAsciiTab(generateRiff({ key: 'E', scale: 'phrygian', bpm: DEFAULT_BPM }));
}

button?.addEventListener('click', show);
show();
