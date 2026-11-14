export type ShortcutAction = 'toggle-play' | 'generate' | 'toggle-loop';

/** The parts of a keyboard event the decision needs (plain data, so it can be unit tested). */
export type KeyInfo = {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat: boolean;
};

/** What has focus: its tag, input type, and whether it's editable text. */
export type FocusInfo = { tag: string; type?: string; editable?: boolean };

const TEXT_INPUT_TYPES = new Set(['text', 'number', 'search', 'email', 'url', 'tel', 'password']);

/** Typing into these must never trigger a shortcut. */
function isTextEntry(focus: FocusInfo): boolean {
  if (focus.editable) return true;
  const tag = focus.tag.toUpperCase();
  if (tag === 'TEXTAREA') return true;
  return tag === 'INPUT' && TEXT_INPUT_TYPES.has((focus.type ?? 'text').toLowerCase());
}

/** Space presses these natively, so Space is left to them. */
function activatesOnSpace(focus: FocusInfo): boolean {
  const tag = focus.tag.toUpperCase();
  if (tag === 'BUTTON' || tag === 'SUMMARY' || tag === 'A') return true;
  return tag === 'INPUT' && ['checkbox', 'radio', 'button', 'submit'].includes((focus.type ?? '').toLowerCase());
}

/**
 * Which app shortcut a key press means, given what has focus:
 * - in a text or number field: none (the user is typing);
 * - on a dropdown: none (letters jump between options); dropdowns picked with the mouse
 *   hand focus back to the page, so this only applies to keyboard users;
 * - Space on a button or switch: none (Space presses it);
 * - otherwise Space plays/stops, G generates, L toggles the loop.
 */
export function shortcutFor(key: KeyInfo, focus: FocusInfo): ShortcutAction | null {
  if (key.ctrlKey || key.metaKey || key.altKey || key.repeat) return null;
  if (isTextEntry(focus) || focus.tag.toUpperCase() === 'SELECT') return null;
  if (key.code === 'Space') return activatesOnSpace(focus) ? null : 'toggle-play';
  const k = key.key.toLowerCase();
  if (k === 'g') return 'generate';
  if (k === 'l') return 'toggle-loop';
  return null;
}

export function focusInfo(target: EventTarget | null): FocusInfo {
  if (!(target instanceof HTMLElement)) return { tag: 'BODY' };
  return {
    tag: target.tagName,
    type: target instanceof HTMLInputElement ? target.type : undefined,
    editable: target.isContentEditable,
  };
}
