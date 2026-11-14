// Temporary preview page until the real UI (milestone 4).
import { Player } from './audio/player.ts';
import type { GuitarId } from './audio/mixer.ts';
import {
  BPM_MAX,
  BPM_MIN,
  NOTE_NAMES,
  SCALES,
  SCALE_IDS,
  formatAsciiTab,
  generateRiff,
  type Bars,
  type NoteName,
  type ScaleId,
} from './engine/index.ts';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel) as T;

const keySel = $<HTMLSelectElement>('#key');
const scaleSel = $<HTMLSelectElement>('#scale');
const bpmInput = $<HTMLInputElement>('#bpm');
const barsSel = $<HTMLSelectElement>('#bars');
const playBtn = $<HTMLButtonElement>('#play');
const position = $<HTMLSpanElement>('#position');
const tab = $<HTMLPreElement>('#tab');

keySel.innerHTML = NOTE_NAMES.map((k) => `<option ${k === 'E' ? 'selected' : ''}>${k}</option>`).join('');
scaleSel.innerHTML = SCALE_IDS.map((s) => `<option value="${s}">${SCALES[s].name}</option>`).join('');

const player = new Player({ loop: true, countIn: true });

function readBpm(): number {
  const bpm = Math.round(Number(bpmInput.value));
  return Math.min(BPM_MAX, Math.max(BPM_MIN, Number.isFinite(bpm) ? bpm : 180));
}

function generate(): void {
  const riff = generateRiff({
    key: keySel.value as NoteName,
    scale: scaleSel.value as ScaleId,
    bpm: readBpm(),
    bars: Number(barsSel.value) as Bars,
  });
  tab.textContent = formatAsciiTab(riff);
  player.load(riff);
}

$('#generate').addEventListener('click', generate);
playBtn.addEventListener('click', () => void player.toggle());
bpmInput.addEventListener('change', () => {
  bpmInput.value = String(readBpm());
  player.setBpm(readBpm());
});
$<HTMLInputElement>('#loop').addEventListener('change', (e) => player.setLoop((e.target as HTMLInputElement).checked));
$<HTMLInputElement>('#countin').addEventListener('change', (e) =>
  player.setCountIn((e.target as HTMLInputElement).checked),
);
document.querySelectorAll<HTMLInputElement>('[data-mute]').forEach((el) =>
  el.addEventListener('change', () => player.setMuted(el.dataset.mute as GuitarId, el.checked)),
);
document.querySelectorAll<HTMLInputElement>('[data-solo]').forEach((el) =>
  el.addEventListener('change', () => player.setSolo(el.dataset.solo as GuitarId, el.checked)),
);

player.onStateChange((playing) => {
  playBtn.textContent = playing ? '■ Stop' : '▶ Play';
});
player.onCursor((p) => {
  if (!p) position.textContent = '';
  else if (p.kind === 'countIn') position.textContent = `count-in ${p.beat + 1}`;
  else position.textContent = `bar ${Math.floor(p.step / 16) + 1}, step ${(p.step % 16) + 1}`;
});

generate();
