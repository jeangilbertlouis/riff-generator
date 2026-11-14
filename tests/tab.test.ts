import { describe, expect, it } from 'vitest';
import { generateRiff } from '../src/engine/generate.ts';
import { SCALE_IDS } from '../src/engine/theory.ts';
import { NOTE_NAMES, type Bars, type NoteEvent, type Riff } from '../src/engine/types.ts';
import { METRICS, STEPS_PER_BAR, fitBars, layoutTab, locateStep, palmMuteGroups, stringNames } from '../src/tab/layout.ts';
import { escapeXml, renderTabSvg } from '../src/tab/renderSvg.ts';

const WIDTHS = [320, 420, 800, 1200, 1600];
const riff = (bars: Bars, seed = 7, extra: Partial<Parameters<typeof generateRiff>[0]> = {}): Riff =>
  generateRiff({ key: 'E', scale: 'phrygian', bpm: 180, bars, seed, ...extra });

describe('fitBars', () => {
  it('balances rows: 4 bars that fit 3 per row become 2 + 2', () => {
    const m = METRICS;
    const threeBars = m.marginLeft + m.labelWidth + m.marginRight + 3 * (16 * m.stepWidthPreferred + m.barPad) + 5;
    expect(fitBars(threeBars, 4).barsPerSystem).toBe(2);
  });

  it('puts everything on one row when it fits', () => {
    expect(fitBars(1600, 4).barsPerSystem).toBe(4);
    expect(fitBars(1600, 2).barsPerSystem).toBe(2);
  });

  it('shrinks the step width on narrow screens, but not below the minimum', () => {
    const narrow = fitBars(330, 2);
    expect(narrow.barsPerSystem).toBe(1);
    expect(narrow.stepWidth).toBeLessThan(METRICS.stepWidthPreferred);
    expect(narrow.stepWidth).toBeGreaterThanOrEqual(METRICS.stepWidthMin);
    expect(fitBars(100, 1).stepWidth).toBe(METRICS.stepWidthMin);
  });

  it('never stretches steps past the maximum', () => {
    expect(fitBars(5000, 1).stepWidth).toBe(METRICS.stepWidthMax);
  });
});

describe('layoutTab', () => {
  it('fits the container width whenever one bar at minimum step width fits', () => {
    for (const bars of [1, 2, 4] as Bars[]) {
      for (const width of WIDTHS) expect(layoutTab(riff(bars), { width }).width).toBeLessThanOrEqual(width);
    }
  });

  it('covers every bar exactly once, in order', () => {
    for (const bars of [1, 2, 4] as Bars[]) {
      for (const width of WIDTHS) {
        const layout = layoutTab(riff(bars), { width });
        const covered = layout.systems.flatMap((s) => Array.from({ length: s.steps }, (_, i) => s.firstStep + i));
        expect(covered).toEqual(Array.from({ length: bars * STEPS_PER_BAR }, (_, i) => i));
      }
    }
  });

  it('places every note once, on its string line, inside its system', () => {
    for (const key of NOTE_NAMES) {
      for (const scale of SCALE_IDS) {
        const r = generateRiff({ key, scale, bpm: 200, bars: 4, seed: key.length * 31 + scale.length });
        const layout = layoutTab(r, { width: 800 });
        for (const [i, part] of [r.guitar1, r.guitar2].entries()) {
          const placed = layout.systems.flatMap((s) => s.staves[i]!.notes.map((n) => ({ n, s })));
          expect(placed.map((p) => p.n.step)).toEqual(part.map((n) => n.step));
          placed.forEach(({ n, s }, j) => {
            const src = part[j] as NoteEvent;
            expect(n.fret).toBe(src.fret);
            expect(n.y).toBe(s.staves[i]!.stringYs[src.string - 1]);
            expect(n.x).toBeGreaterThan(s.x0);
            expect(n.x).toBeLessThan(s.xEnd);
          });
        }
      }
    }
  });

  it('spaces notes by rhythm: equal step widths, x grows with step', () => {
    const r = riff(2);
    const layout = layoutTab(r, { width: 1600 });
    const notes = layout.systems[0]!.staves[0]!.notes;
    for (let i = 1; i < notes.length; i++) {
      const a = notes[i - 1]!;
      const b = notes[i]!;
      const sameBar = Math.floor(a.step / 16) === Math.floor(b.step / 16);
      if (sameBar) expect(b.x - a.x).toBeCloseTo((b.step - a.step) * layout.stepWidth, 5);
      else expect(b.x).toBeGreaterThan(a.x);
    }
  });

  it('labels strings from the tuning, 7 strings for B', () => {
    expect(stringNames([64, 59, 55, 50, 45, 40])).toEqual(['e', 'B', 'G', 'D', 'A', 'E']);
    const seven = layoutTab(generateRiff({ key: 'B', scale: 'phrygian', bpm: 180, seed: 1 }), { width: 800 });
    expect(seven.stringNames).toEqual(['e', 'B', 'G', 'D', 'A', 'E', 'B']);
    expect(seven.systems[0]!.staves[0]!.stringYs).toHaveLength(7);
  });

  it('titles Guitar 2 with its mode', () => {
    const layout = layoutTab(riff(1, 7, { guitar2Mode: 'counter' }), { width: 800 });
    expect(layout.systems[0]!.staves[0]!.title).toBe('Guitar 1 (L)');
    expect(layout.systems[0]!.staves[1]!.title).toBe('Guitar 2 · counter (R)');
  });

  it('stacks systems without overlap and fits the height', () => {
    const layout = layoutTab(riff(4), { width: 420 });
    expect(layout.systems.length).toBe(4);
    for (let i = 1; i < layout.systems.length; i++) {
      const prev = layout.systems[i - 1]!;
      expect(layout.systems[i]!.y).toBeGreaterThanOrEqual(prev.y + prev.height);
    }
    const last = layout.systems.at(-1)!;
    expect(layout.height).toBeGreaterThanOrEqual(last.y + last.height);
  });
});

describe('palmMuteGroups', () => {
  const left = (local: number) => local * 10;
  const note = (step: number, duration: number, palmMute: boolean): NoteEvent => ({
    step, duration, palmMute, midi: 40, accent: false, passing: false, string: 6, fret: 0,
  });

  it('joins consecutive palm mutes and breaks at an open note', () => {
    const groups = palmMuteGroups(
      [note(0, 2, true), note(2, 1, true), note(3, 1, true), note(4, 2, false), note(6, 1, true)],
      0, 16, left, 50,
    );
    expect(groups).toEqual([{ x1: 1, x2: 38, y: 50 }, { x1: 61, x2: 68, y: 50 }]);
  });

  it('breaks at a rest of a beat or more, but not a shorter one', () => {
    expect(palmMuteGroups([note(0, 1, true), note(3, 1, true)], 0, 16, left, 0)).toHaveLength(1);
    expect(palmMuteGroups([note(0, 1, true), note(5, 1, true)], 0, 16, left, 0)).toHaveLength(2);
  });

  it('clamps a group at the end of the system', () => {
    const [g] = palmMuteGroups([note(14, 4, true)], 0, 16, left, 0);
    expect(g!.x2).toBe(158);
  });
});

describe('locateStep', () => {
  it('finds the system and column of each step', () => {
    const layout = layoutTab(riff(4), { width: 800 });
    expect(layout.barsPerSystem).toBe(2);
    expect(locateStep(layout, 0)!.system.index).toBe(0);
    expect(locateStep(layout, 31)!.system.index).toBe(0);
    expect(locateStep(layout, 32)!.system.index).toBe(1);
    const a = locateStep(layout, 5)!;
    const b = locateStep(layout, 6)!;
    expect(b.x - a.x).toBeCloseTo(layout.stepWidth, 5);
    expect(locateStep(layout, -1)).toBeNull();
    expect(locateStep(layout, 64)).toBeNull();
  });

  it('lines the cursor column up with the note drawn on that step', () => {
    const layout = layoutTab(riff(2), { width: 800 });
    for (const sys of layout.systems) {
      for (const n of sys.staves[1].notes) {
        const loc = locateStep(layout, n.step)!;
        expect(loc.x + loc.width / 2).toBeCloseTo(n.x, 5);
      }
    }
  });
});

describe('renderTabSvg', () => {
  const r = riff(2, 7, { guitar2Mode: 'harmony' });
  const layout = layoutTab(r, { width: 800 });
  const svg = renderTabSvg(layout);
  const count = (re: RegExp) => (svg.match(re) ?? []).length;

  it('draws one text element per note for both guitars', () => {
    expect(count(/class="tab-note[^"]*" data-step=/g)).toBe(r.guitar1.length + r.guitar2.length);
    expect(count(/data-guitar="guitar1"/g)).toBe(r.guitar1.length);
    expect(count(/data-guitar="guitar2"/g)).toBe(r.guitar2.length);
  });

  it('draws one hidden cursor per system', () => {
    expect(count(/class="tab-cursor"[^>]*visibility="hidden"/g)).toBe(layout.systems.length);
  });

  it('draws string lines for both staves', () => {
    expect(count(/class="tab-line"/g)).toBe(layout.systems.length * 2 * r.tuning.openStrings.length);
  });

  it('marks palm mutes and passing tones', () => {
    const chug = riff(2, 3, { style: 'chug' });
    const chugSvg = renderTabSvg(layoutTab(chug, { width: 800 }));
    expect(chugSvg).toContain('P.M.');
    const passing = [chug, r].some((x) => x.guitar1.some((n) => n.passing));
    if (passing) expect(svg + chugSvg).toContain('tab-note passing');
  });

  it('is accessible and escapes text', () => {
    expect(svg).toMatch(/^<svg [^>]*role="img"[^>]*aria-label="Guitar tab: E Phrygian/);
    expect(svg).toContain('<title>Guitar tab: E Phrygian');
    expect(escapeXml('<a & "b">')).toBe('&#60;a &#38; &#34;b&#34;&#62;');
  });

  it('uses CSS variables for every color', () => {
    const style = svg.match(/<style>([\s\S]*?)<\/style>/)![1]!;
    const colors = style.match(/(fill|stroke):[^;}]+/g)!;
    for (const c of colors) {
      if (c.startsWith('stroke-')) continue;
      expect(c).toMatch(/var\(--tab-/);
    }
  });

  it('has balanced tags', () => {
    expect(count(/<g /g)).toBe(count(/<\/g>/g));
    expect(count(/<text /g)).toBe(count(/<\/text>/g));
    expect(svg.endsWith('</svg>')).toBe(true);
  });
});
