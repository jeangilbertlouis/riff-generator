import type { CursorPosition } from '../audio/schedule.ts';
import type { Riff } from '../engine/types.ts';
import { layoutTab, locateStep, type TabLayout } from './layout.ts';
import { renderTabSvg } from './renderSvg.ts';

/**
 * Shows a riff as SVG tab inside a container, re-lays it out when the container
 * width changes, and moves the playback cursor. During playback only attributes
 * change; the SVG is not re-rendered.
 */
export class TabView {
  private readonly container: HTMLElement;
  private riff: Riff | null = null;
  private layout: TabLayout | null = null;
  private cursors: SVGRectElement[] = [];
  private notesByStep = new Map<number, Element[]>();
  private active: Element[] = [];
  private visibleCursor: SVGRectElement | null = null;
  private position: CursorPosition | null = null;
  private renderedWidth = 0;
  private readonly observer: ResizeObserver;

  constructor(container: HTMLElement) {
    this.container = container;
    // The page never scrolls sideways; only the tab does when it can't fit.
    this.container.style.overflowX = 'auto';
    this.observer = new ResizeObserver(() => {
      if (this.riff && Math.round(this.availableWidth()) !== this.renderedWidth) this.render(this.riff);
    });
    this.observer.observe(container);
  }

  render(riff: Riff): void {
    this.riff = riff;
    const width = Math.round(this.availableWidth());
    this.renderedWidth = width;
    this.layout = layoutTab(riff, { width });
    this.container.innerHTML = renderTabSvg(this.layout);

    this.cursors = [...this.container.querySelectorAll<SVGRectElement>('rect.tab-cursor')];
    this.notesByStep.clear();
    for (const el of this.container.querySelectorAll('text.tab-note')) {
      const step = Number(el.getAttribute('data-step'));
      const list = this.notesByStep.get(step) ?? [];
      list.push(el);
      this.notesByStep.set(step, list);
    }
    this.active = [];
    this.visibleCursor = null;
    this.setCursor(this.position);
  }

  /** Accepts the player's cursor; null or count-in hides the cursor. */
  setCursor(position: CursorPosition | null): void {
    this.position = position;
    for (const el of this.active) el.classList.remove('active');
    this.active = [];

    const located = position?.kind === 'riff' && this.layout ? locateStep(this.layout, position.step) : null;
    if (!located || position?.kind !== 'riff') {
      this.visibleCursor?.setAttribute('visibility', 'hidden');
      this.visibleCursor = null;
      return;
    }

    const rect = this.cursors[located.system.index];
    if (rect !== this.visibleCursor) {
      this.visibleCursor?.setAttribute('visibility', 'hidden');
      rect?.setAttribute('visibility', 'visible');
      this.visibleCursor = rect ?? null;
    }
    rect?.setAttribute('x', String(Math.round(located.x * 10) / 10));

    this.active = this.notesByStep.get(position.step) ?? [];
    for (const el of this.active) el.classList.add('active');
  }

  get currentLayout(): TabLayout | null {
    return this.layout;
  }

  dispose(): void {
    this.observer.disconnect();
    this.container.innerHTML = '';
  }

  private availableWidth(): number {
    const style = getComputedStyle(this.container);
    const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    return Math.max(0, this.container.clientWidth - (Number.isFinite(padding) ? padding : 0));
  }
}
