import type { GuitarId } from '../audio/mixer.ts';
import { NOTE_NAMES, type NoteEvent, type Riff } from '../engine/types.ts';
import { SCALES } from '../engine/theory.ts';

export const STEPS_PER_BAR = 16;
export const STEPS_PER_BEAT = 4;

/** All sizes in SVG user units (px at 1:1). */
export const METRICS = {
  marginLeft: 8,
  marginRight: 8,
  labelWidth: 20,
  barPad: 8,
  stringSpacing: 12,
  barNumberHeight: 14,
  headerHeight: 28,
  pmHeight: 18,
  staffGap: 6,
  systemGap: 18,
  /** Step width used to decide how many bars fit on a row; the row is then stretched to fill. */
  stepWidthPreferred: 18,
  stepWidthMin: 14,
  stepWidthMax: 30,
} as const;

export type PlacedNote = {
  step: number;
  /** Center of the note's step column. */
  x: number;
  y: number;
  string: number;
  fret: number;
  palmMute: boolean;
  passing: boolean;
  accent: boolean;
};

export type PmGroup = { x1: number; x2: number; y: number };

export type StaffLayout = {
  guitar: GuitarId;
  title: string;
  headerY: number;
  /** y of each string line, index 0 = string 1 (highest). */
  stringYs: number[];
  notes: PlacedNote[];
  pmGroups: PmGroup[];
};

export type SystemLayout = {
  index: number;
  firstStep: number;
  steps: number;
  firstBar: number;
  y: number;
  height: number;
  /** x of the first bar line; xEnd = x of the last. */
  x0: number;
  xEnd: number;
  /** x of every bar line, including the start and end of the system. */
  barXs: number[];
  /** x of every beat inside a bar (not on bar lines), for the faint rhythm ticks. */
  beatXs: number[];
  staves: [StaffLayout, StaffLayout];
  cursorTop: number;
  cursorBottom: number;
};

export type TabLayout = {
  width: number;
  height: number;
  stepWidth: number;
  barWidth: number;
  barsPerSystem: number;
  stringNames: string[];
  systems: SystemLayout[];
  totalSteps: number;
  label: string;
};

export type LayoutOptions = { width: number };

/** String names for the left margin, top string lowercase as in common tab. */
export function stringNames(openStrings: number[]): string[] {
  return openStrings.map((m, i) => {
    const name = NOTE_NAMES[((m % 12) + 12) % 12] as string;
    return i === 0 ? name.toLowerCase() : name;
  });
}

/** How many bars per row, and the step width, for a container width. Rows are balanced (4 → 2+2, not 3+1). */
export function fitBars(width: number, bars: number): { barsPerSystem: number; stepWidth: number } {
  const m = METRICS;
  const available = width - m.marginLeft - m.labelWidth - m.marginRight;
  const preferredBar = STEPS_PER_BAR * m.stepWidthPreferred + m.barPad;
  const fit = Math.max(1, Math.min(bars, Math.floor(available / preferredBar)));
  const rows = Math.ceil(bars / fit);
  const barsPerSystem = Math.ceil(bars / rows);
  const raw = (available / barsPerSystem - m.barPad) / STEPS_PER_BAR;
  const stepWidth = Math.min(m.stepWidthMax, Math.max(m.stepWidthMin, Math.floor(raw * 10) / 10));
  return { barsPerSystem, stepWidth };
}

export function layoutTab(riff: Riff, { width }: LayoutOptions): TabLayout {
  const m = METRICS;
  const { barsPerSystem, stepWidth } = fitBars(width, riff.bars);
  const barWidth = STEPS_PER_BAR * stepWidth + m.barPad;
  const x0 = m.marginLeft + m.labelWidth;
  const stringCount = riff.tuning.openStrings.length;
  const staffSpan = (stringCount - 1) * m.stringSpacing;
  const staffBlock = m.headerHeight + staffSpan + m.pmHeight;
  const systemHeight = m.barNumberHeight + staffBlock * 2 + m.staffGap;
  const systemCount = Math.ceil(riff.bars / barsPerSystem);

  const systems: SystemLayout[] = [];
  for (let s = 0; s < systemCount; s++) {
    const y = s * (systemHeight + m.systemGap);
    const firstBar = s * barsPerSystem;
    const bars = Math.min(barsPerSystem, riff.bars - firstBar);
    const firstStep = firstBar * STEPS_PER_BAR;
    const steps = bars * STEPS_PER_BAR;
    const xEnd = x0 + bars * barWidth;

    /** Left edge of a step's column, for a step relative to this system. */
    const left = (local: number): number => {
      if (local >= steps) return xEnd;
      const bar = Math.floor(local / STEPS_PER_BAR);
      return x0 + bar * barWidth + m.barPad + (local % STEPS_PER_BAR) * stepWidth;
    };

    const staff = (guitar: GuitarId, notes: NoteEvent[], top: number): StaffLayout => {
      const headerY = top + 12;
      const stringYs = Array.from({ length: stringCount }, (_, i) => top + m.headerHeight + i * m.stringSpacing);
      const pmY = (stringYs.at(-1) as number) + 13;
      const inSystem = notes.filter((n) => n.step >= firstStep && n.step < firstStep + steps);
      const placed = inSystem.map<PlacedNote>((n) => ({
        step: n.step,
        x: left(n.step - firstStep) + stepWidth / 2,
        y: stringYs[n.string - 1] as number,
        string: n.string,
        fret: n.fret,
        palmMute: n.palmMute,
        passing: n.passing,
        accent: n.accent,
      }));
      return {
        guitar,
        title: guitar === 'guitar1' ? 'Guitar 1 (L)' : `Guitar 2 · ${riff.guitar2Mode} (R)`,
        headerY,
        stringYs,
        notes: placed,
        pmGroups: palmMuteGroups(inSystem, firstStep, steps, left, pmY),
      };
    };

    const top1 = y + m.barNumberHeight;
    const top2 = top1 + staffBlock + m.staffGap;
    const staves: [StaffLayout, StaffLayout] = [staff('guitar1', riff.guitar1, top1), staff('guitar2', riff.guitar2, top2)];

    const barXs = Array.from({ length: bars + 1 }, (_, i) => x0 + i * barWidth);
    const beatXs: number[] = [];
    for (let local = 0; local < steps; local += STEPS_PER_BEAT) {
      if (local % STEPS_PER_BAR !== 0) beatXs.push(left(local));
    }

    systems.push({
      index: s,
      firstStep,
      steps,
      firstBar,
      y,
      height: systemHeight,
      x0,
      xEnd,
      barXs,
      beatXs,
      staves,
      cursorTop: (staves[0].stringYs[0] as number) - 8,
      cursorBottom: (staves[1].stringYs.at(-1) as number) + 8,
    });
  }

  const contentWidth = x0 + barsPerSystem * barWidth + m.marginRight;
  return {
    width: Math.ceil(contentWidth),
    height: Math.ceil(systemCount * systemHeight + (systemCount - 1) * m.systemGap + 4),
    stepWidth,
    barWidth,
    barsPerSystem,
    stringNames: stringNames(riff.tuning.openStrings),
    systems,
    totalSteps: riff.totalSteps,
    label:
      `Guitar tab: ${riff.key} ${SCALES[riff.scale].name}, ${riff.tuning.name}, ${riff.bars} ` +
      `bar${riff.bars === 1 ? '' : 's'} at ${riff.bpm} BPM, Guitar 2 ${riff.guitar2Mode}`,
  };
}

/**
 * Group consecutive palm-muted notes. A group breaks at an open (unmuted) note,
 * at a rest of a beat or longer, or at the end of the system.
 */
export function palmMuteGroups(
  notes: NoteEvent[],
  firstStep: number,
  steps: number,
  left: (local: number) => number,
  y: number,
): PmGroup[] {
  const groups: PmGroup[] = [];
  let current: { start: number; end: number } | null = null;
  const close = () => {
    if (current) groups.push({ x1: left(current.start) + 1, x2: left(current.end) - 2, y });
    current = null;
  };
  for (const n of notes) {
    const start = n.step - firstStep;
    const end = Math.min(steps, start + n.duration);
    if (!n.palmMute) {
      close();
      continue;
    }
    if (current && start - current.end < STEPS_PER_BEAT) current.end = end;
    else {
      close();
      current = { start, end };
    }
  }
  close();
  return groups;
}

/** Which system a riff step falls in, and its column. */
export function locateStep(layout: TabLayout, step: number): { system: SystemLayout; x: number; width: number } | null {
  if (step < 0 || step >= layout.totalSteps) return null;
  const system = layout.systems.find((s) => step >= s.firstStep && step < s.firstStep + s.steps);
  if (!system) return null;
  const local = step - system.firstStep;
  const bar = Math.floor(local / STEPS_PER_BAR);
  const x = system.x0 + bar * layout.barWidth + METRICS.barPad + (local % STEPS_PER_BAR) * layout.stepWidth;
  return { system, x, width: layout.stepWidth };
}
