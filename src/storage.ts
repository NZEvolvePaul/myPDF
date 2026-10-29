// Saved signature and initials live only on this device.
const KEYS = { signature: 'mypdf.signature', initials: 'mypdf.initials' } as const;
export type MarkKind = keyof typeof KEYS;

export function loadMark(kind: MarkKind): string | null {
  try {
    return localStorage.getItem(KEYS[kind]);
  } catch {
    return null;
  }
}

export function saveMark(kind: MarkKind, dataUrl: string | null) {
  try {
    if (dataUrl) localStorage.setItem(KEYS[kind], dataUrl);
    else localStorage.removeItem(KEYS[kind]);
  } catch {
    // Storage unavailable (private mode); the mark still works for this session.
  }
}
