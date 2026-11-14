import type { StaffLayout, SystemLayout, TabLayout } from './layout.ts';

const r = (n: number) => Math.round(n * 10) / 10;

export function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Colors come from CSS variables so the page can theme the tab (light/dark). */
const STYLE = `
.tab-bg{fill:var(--tab-bg,#fff)}
.tab-line{stroke:var(--tab-line,#9a9a9a);stroke-width:1}
.tab-bar{stroke:var(--tab-text,#222);stroke-width:1.2}
.tab-bar-end{stroke:var(--tab-text,#222);stroke-width:3}
.tab-beat{stroke:var(--tab-line,#9a9a9a);stroke-width:1;opacity:.6}
.tab-label{fill:var(--tab-muted,#777);font:600 11px ui-monospace,Consolas,monospace}
.tab-title{fill:var(--tab-text,#222);font:600 12px system-ui,sans-serif}
.tab-barnum{fill:var(--tab-muted,#777);font:11px system-ui,sans-serif}
.tab-chord{fill:var(--tab-accent,#d33);font:700 12px system-ui,sans-serif}
.tab-note{fill:var(--tab-text,#222);font:700 12px ui-monospace,Consolas,monospace;
  stroke:var(--tab-bg,#fff);stroke-width:4px;paint-order:stroke;stroke-linejoin:round;
  text-anchor:middle;dominant-baseline:central}
.tab-note.passing{fill:var(--tab-muted,#777)}
.tab-note.active{fill:var(--tab-accent,#d33)}
.tab-pm{fill:var(--tab-muted,#777);font:600 9px system-ui,sans-serif;dominant-baseline:central}
.tab-pm-line{stroke:var(--tab-muted,#777);stroke-width:1;stroke-dasharray:3 2}
.tab-cursor{fill:var(--tab-cursor,rgba(221,51,51,.18))}
`;

function line(x1: number, y1: number, x2: number, y2: number, cls: string): string {
  return `<line class="${cls}" x1="${r(x1)}" y1="${r(y1)}" x2="${r(x2)}" y2="${r(y2)}"/>`;
}

function renderStaff(staff: StaffLayout, sys: SystemLayout, names: string[]): string {
  const out: string[] = [];
  const topY = staff.stringYs[0] as number;
  const bottomY = staff.stringYs.at(-1) as number;
  out.push(`<text class="tab-title" x="${r(sys.x0)}" y="${r(staff.headerY)}">${escapeXml(staff.title)}</text>`);

  staff.stringYs.forEach((y, i) => {
    out.push(line(sys.x0, y, sys.xEnd, y, 'tab-line'));
    out.push(`<text class="tab-label" x="${r(sys.x0 - 6)}" y="${r(y)}" text-anchor="end" dominant-baseline="central">${escapeXml(names[i] as string)}</text>`);
  });
  for (const x of sys.barXs) out.push(line(x, topY, x, bottomY, 'tab-bar'));
  for (const x of sys.beatXs) out.push(line(x, bottomY + 3, x, bottomY + 7, 'tab-beat'));

  for (const g of staff.pmGroups) {
    out.push(`<text class="tab-pm" x="${r(g.x1)}" y="${r(g.y)}">P.M.</text>`);
    // Short groups get the label alone; longer ones a dashed line to where the muting ends.
    const lineStart = g.x1 + 22;
    if (g.x2 > lineStart + 10) {
      out.push(line(lineStart, g.y, g.x2, g.y, 'tab-pm-line'));
      out.push(line(g.x2, g.y - 3, g.x2, g.y + 3, 'tab-pm-line'));
    }
  }

  for (const n of staff.notes) {
    const cls = ['tab-note', n.passing ? 'passing' : ''].filter(Boolean).join(' ');
    out.push(
      `<text class="${cls}" data-step="${n.step}" data-guitar="${staff.guitar}" x="${r(n.x)}" y="${r(n.y)}">${n.fret}</text>`,
    );
  }
  return out.join('');
}

/** Turn a tab layout into a standalone SVG string. */
export function renderTabSvg(layout: TabLayout): string {
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" class="tab-svg" viewBox="0 0 ${layout.width} ${layout.height}" ` +
      `width="${layout.width}" height="${layout.height}" role="img" aria-label="${escapeXml(layout.label)}">`,
    `<title>${escapeXml(layout.label)}</title>`,
    `<style>${STYLE}</style>`,
    `<rect class="tab-bg" x="0" y="0" width="${layout.width}" height="${layout.height}"/>`,
  ];

  layout.systems.forEach((sys, i) => {
    const isLast = i === layout.systems.length - 1;
    parts.push(`<g class="tab-system" data-system="${sys.index}">`);
    parts.push(
      `<rect class="tab-cursor" data-system="${sys.index}" x="${r(sys.x0)}" y="${r(sys.cursorTop)}" ` +
        `width="${r(layout.stepWidth)}" height="${r(sys.cursorBottom - sys.cursorTop)}" visibility="hidden"/>`,
    );
    for (let b = 0; b < sys.barXs.length - 1; b++) {
      parts.push(
        `<text class="tab-barnum" x="${r((sys.barXs[b] as number) + 3)}" y="${r(sys.y + 10)}">${sys.firstBar + b + 1}</text>`,
      );
    }
    for (const c of sys.chords) {
      parts.push(
        `<text class="tab-chord" x="${r(c.x)}" y="${r(c.y)}"><title>${escapeXml(c.roman)}</title>${escapeXml(c.name)}</text>`,
      );
    }
    for (const staff of sys.staves) parts.push(renderStaff(staff, sys, layout.stringNames));
    if (isLast) {
      // Final double bar on both staves.
      for (const staff of sys.staves) {
        const top = staff.stringYs[0] as number;
        const bottom = staff.stringYs.at(-1) as number;
        parts.push(line(sys.xEnd - 4, top, sys.xEnd - 4, bottom, 'tab-bar'));
        parts.push(line(sys.xEnd - 0.5, top, sys.xEnd - 0.5, bottom, 'tab-bar-end'));
      }
    }
    parts.push('</g>');
  });

  parts.push('</svg>');
  return parts.join('');
}
