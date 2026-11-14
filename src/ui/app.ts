import { GUITARS, isAudible, type GuitarId } from '../audio/mixer.ts';
import { Player } from '../audio/player.ts';
import type { CursorPosition } from '../audio/schedule.ts';
import { generateRiff } from '../engine/generate.ts';
import { randomSeed } from '../engine/random.ts';
import { NOTE_NAMES, type Archetype, type Bars, type Riff, type ScaleId, type SecondGuitarMode } from '../engine/types.ts';
import { SCALE_IDS } from '../engine/theory.ts';
import { TabView } from '../tab/TabView.ts';
import {
  BARS_OPTIONS,
  GUITAR2_LABELS,
  GUITAR2_OPTIONS,
  KEY_OPTIONS,
  SCALE_OPTIONS,
  STYLE_LABELS,
  STYLE_OPTIONS,
  defaultSettings,
  describeRiff,
  parseBpm,
  parseSeed,
  pickOption,
  toGenerateOptions,
  type Option,
  type Settings,
} from './settings.ts';

function el<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`Missing element: ${selector}`);
  return found;
}

function fillSelect(select: HTMLSelectElement, options: Option[], value: string): void {
  select.replaceChildren(
    ...options.map((o) => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      return opt;
    }),
  );
  select.value = value;
}

/** Keyboard shortcuts are for the page, not for fields or focused buttons (Space already presses those). */
function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest('input, select, textarea, button, [contenteditable="true"]');
}

export function mountApp(root: ParentNode = document): { player: Player; tabView: TabView } {
  const ui = {
    key: el<HTMLSelectElement>(root, '#key'),
    scale: el<HTMLSelectElement>(root, '#scale'),
    bars: el<HTMLSelectElement>(root, '#bars'),
    style: el<HTMLSelectElement>(root, '#style'),
    guitar2: el<HTMLSelectElement>(root, '#guitar2'),
    bpmRange: el<HTMLInputElement>(root, '#bpm-range'),
    bpmNumber: el<HTMLInputElement>(root, '#bpm-number'),
    seed: el<HTMLInputElement>(root, '#seed'),
    seedError: el<HTMLSpanElement>(root, '#seed-error'),
    copySeed: el<HTMLButtonElement>(root, '#copy-seed'),
    generate: el<HTMLButtonElement>(root, '#generate'),
    play: el<HTMLButtonElement>(root, '#play'),
    playLabel: el<HTMLSpanElement>(root, '#play .play-label'),
    loop: el<HTMLInputElement>(root, '#loop'),
    countIn: el<HTMLInputElement>(root, '#countin'),
    beats: [...el<HTMLDivElement>(root, '#beats').children] as HTMLElement[],
    position: el<HTMLSpanElement>(root, '#position'),
    summary: el<HTMLParagraphElement>(root, '#summary'),
    tab: el<HTMLDivElement>(root, '#tab'),
  };

  const settings: Settings = defaultSettings();
  const player = new Player({ loop: ui.loop.checked, countIn: ui.countIn.checked });
  const tabView = new TabView(ui.tab);

  fillSelect(ui.key, KEY_OPTIONS, settings.key);
  fillSelect(ui.scale, SCALE_OPTIONS, settings.scale);
  fillSelect(ui.bars, BARS_OPTIONS.map((b) => ({ value: String(b), label: String(b) })), String(settings.bars));
  fillSelect(ui.style, STYLE_OPTIONS, settings.style);
  fillSelect(ui.guitar2, GUITAR2_OPTIONS, settings.guitar2Mode);
  showBpm(settings.bpm);
  ui.seed.value = String(settings.seed);

  function showBpm(bpm: number): void {
    ui.bpmRange.value = String(bpm);
    ui.bpmNumber.value = String(bpm);
  }

  function regenerate(): void {
    const riff: Riff = generateRiff(toGenerateOptions(settings));
    ui.seed.value = String(settings.seed);
    setSeedError('');
    ui.summary.textContent = describeRiff(riff);
    tabView.render(riff);
    player.load(riff);
  }

  function setSeedError(message: string): void {
    ui.seedError.textContent = message;
    ui.seed.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  // Settings that regenerate with the same seed.
  ui.key.addEventListener('change', () => {
    settings.key = pickOption(ui.key.value, NOTE_NAMES) ?? settings.key;
    regenerate();
  });
  ui.scale.addEventListener('change', () => {
    settings.scale = pickOption<ScaleId>(ui.scale.value, SCALE_IDS) ?? settings.scale;
    regenerate();
  });
  ui.bars.addEventListener('change', () => {
    settings.bars = (pickOption(ui.bars.value, ['1', '2', '4']) ? Number(ui.bars.value) : settings.bars) as Bars;
    regenerate();
  });
  ui.style.addEventListener('change', () => {
    settings.style = pickOption(ui.style.value, Object.keys(STYLE_LABELS) as (Archetype | 'auto')[]) ?? settings.style;
    regenerate();
  });
  ui.guitar2.addEventListener('change', () => {
    settings.guitar2Mode =
      pickOption(ui.guitar2.value, Object.keys(GUITAR2_LABELS) as (SecondGuitarMode | 'auto')[]) ?? settings.guitar2Mode;
    regenerate();
  });

  // Tempo: live, and used for the next generation.
  const applyBpm = (raw: string) => {
    settings.bpm = parseBpm(raw, settings.bpm);
    player.setBpm(settings.bpm);
  };
  ui.bpmRange.addEventListener('input', () => {
    applyBpm(ui.bpmRange.value);
    ui.bpmNumber.value = String(settings.bpm);
  });
  ui.bpmNumber.addEventListener('change', () => {
    applyBpm(ui.bpmNumber.value);
    showBpm(settings.bpm);
  });

  // Seed: Enter or leaving the field commits it.
  const commitSeed = () => {
    const seed = parseSeed(ui.seed.value);
    if (seed === null) {
      setSeedError('Use a whole number from 0 to 4294967295.');
      return;
    }
    if (seed === settings.seed) {
      setSeedError('');
      return;
    }
    settings.seed = seed;
    regenerate();
  };
  ui.seed.addEventListener('change', commitSeed);
  ui.seed.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commitSeed();
    if (e.key === 'Escape') {
      ui.seed.value = String(settings.seed);
      setSeedError('');
    }
  });
  ui.copySeed.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(String(settings.seed));
      ui.copySeed.textContent = 'Copied';
    } catch {
      ui.seed.select();
      ui.copySeed.textContent = 'Press Ctrl+C';
    }
    setTimeout(() => (ui.copySeed.textContent = 'Copy'), 1500);
  });

  // Transport.
  const generateNew = () => {
    settings.seed = randomSeed();
    regenerate();
  };
  ui.generate.addEventListener('click', generateNew);
  ui.play.addEventListener('click', () => void player.toggle());
  ui.loop.addEventListener('change', () => player.setLoop(ui.loop.checked));
  ui.countIn.addEventListener('change', () => player.setCountIn(ui.countIn.checked));

  player.onStateChange((playing) => {
    ui.play.dataset.playing = String(playing);
    ui.playLabel.textContent = playing ? 'Stop' : 'Play';
  });
  player.onCursor((p: CursorPosition | null) => {
    tabView.setCursor(p);
    ui.beats.forEach((b, i) => b.classList.toggle('on', p?.kind === 'countIn' && i <= p.beat));
    if (!p) ui.position.textContent = '';
    else if (p.kind === 'countIn') ui.position.textContent = `Count-in ${p.beat + 1}`;
    else ui.position.textContent = `Bar ${Math.floor(p.step / 16) + 1} · beat ${Math.floor((p.step % 16) / 4) + 1}`;
  });

  // Mixer.
  const syncMixer = () => {
    const mixer = player.getMixer();
    for (const g of GUITARS) {
      const channel = el<HTMLDivElement>(root, `.channel[data-guitar="${g}"]`);
      el<HTMLButtonElement>(channel, '[data-action="mute"]').setAttribute('aria-pressed', String(mixer[g].muted));
      el<HTMLButtonElement>(channel, '[data-action="solo"]').setAttribute('aria-pressed', String(mixer[g].solo));
      channel.classList.toggle('silent', !isAudible(mixer, g));
    }
  };
  for (const g of GUITARS) {
    const channel = el<HTMLDivElement>(root, `.channel[data-guitar="${g}"]`);
    el<HTMLButtonElement>(channel, '[data-action="mute"]').addEventListener('click', () => {
      player.setMuted(g as GuitarId, !player.getMixer()[g].muted);
      syncMixer();
    });
    el<HTMLButtonElement>(channel, '[data-action="solo"]').addEventListener('click', () => {
      player.setSolo(g as GuitarId, !player.getMixer()[g].solo);
      syncMixer();
    });
    const volume = el<HTMLInputElement>(channel, '[data-action="volume"]');
    volume.addEventListener('input', () => player.setVolume(g as GuitarId, Number(volume.value)));
  }

  // Keyboard shortcuts.
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTypingTarget(e.target)) return;
    if (e.code === 'Space') {
      e.preventDefault();
      void player.toggle();
    } else if (e.key === 'g' || e.key === 'G') {
      generateNew();
    } else if (e.key === 'l' || e.key === 'L') {
      ui.loop.checked = !ui.loop.checked;
      player.setLoop(ui.loop.checked);
    }
  });

  syncMixer();
  regenerate();
  return { player, tabView };
}
