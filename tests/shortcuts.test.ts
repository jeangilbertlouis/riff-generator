import { describe, expect, it } from 'vitest';
import { shortcutFor, type FocusInfo, type KeyInfo } from '../src/ui/shortcuts.ts';

const press = (key: string, extra: Partial<KeyInfo> = {}): KeyInfo => ({
  key,
  code: key === ' ' ? 'Space' : `Key${key.toUpperCase()}`,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  repeat: false,
  ...extra,
});

const BODY: FocusInfo = { tag: 'BODY' };
const BUTTON: FocusInfo = { tag: 'BUTTON' };
const SWITCH: FocusInfo = { tag: 'INPUT', type: 'checkbox' };
const SLIDER: FocusInfo = { tag: 'INPUT', type: 'range' };
const SEED: FocusInfo = { tag: 'INPUT', type: 'text' };
const BPM: FocusInfo = { tag: 'INPUT', type: 'number' };
const SELECT: FocusInfo = { tag: 'SELECT' };

describe('keyboard shortcuts', () => {
  it('work on the page itself', () => {
    expect(shortcutFor(press(' '), BODY)).toBe('toggle-play');
    expect(shortcutFor(press('g'), BODY)).toBe('generate');
    expect(shortcutFor(press('G'), BODY)).toBe('generate');
    expect(shortcutFor(press('l'), BODY)).toBe('toggle-loop');
  });

  it('G and L work right after clicking a button, a switch or a slider (the reported bug)', () => {
    for (const focus of [BUTTON, SWITCH, SLIDER]) {
      expect(shortcutFor(press('g'), focus)).toBe('generate');
      expect(shortcutFor(press('l'), focus)).toBe('toggle-loop');
    }
  });

  it('Space is left to a focused button or switch (it presses them), but plays from a slider', () => {
    expect(shortcutFor(press(' '), BUTTON)).toBeNull();
    expect(shortcutFor(press(' '), SWITCH)).toBeNull();
    expect(shortcutFor(press(' '), SLIDER)).toBe('toggle-play');
  });

  it('never fire while typing in a text or number field, or editable text', () => {
    for (const focus of [SEED, BPM, { tag: 'TEXTAREA' }, { tag: 'DIV', editable: true }]) {
      for (const k of [' ', 'g', 'l']) expect(shortcutFor(press(k), focus)).toBeNull();
    }
  });

  it('leave a keyboard-focused dropdown alone (letters choose options there)', () => {
    for (const k of [' ', 'g', 'l']) expect(shortcutFor(press(k), SELECT)).toBeNull();
  });

  it('ignore modified keys, auto-repeat and other keys', () => {
    expect(shortcutFor(press('g', { ctrlKey: true }), BODY)).toBeNull();
    expect(shortcutFor(press('l', { metaKey: true }), BODY)).toBeNull();
    expect(shortcutFor(press('g', { altKey: true }), BODY)).toBeNull();
    expect(shortcutFor(press(' ', { repeat: true }), BODY)).toBeNull();
    expect(shortcutFor(press('x'), BODY)).toBeNull();
  });
});
