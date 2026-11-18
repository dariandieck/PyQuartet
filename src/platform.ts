/** Browser capabilities that differ between desktop and phones. */

const coarsePointer = matchMedia("(pointer: coarse)");

/** Phones and tablets: no hover, fingers instead of a mouse. */
export function isTouchDevice(): boolean {
  return coarsePointer.matches;
}

/** False on iPhones, where Safari only allows fullscreen for videos. */
export function canFullscreen(): boolean {
  return document.fullscreenEnabled;
}

export function isFullscreen(): boolean {
  return document.fullscreenElement !== null;
}

type LockableOrientation = ScreenOrientation & { lock?: (orientation: string) => Promise<void> };

/**
 * Fullscreen hides the browser bars (more room on small screens) and is required before Android allows
 * locking the orientation. Must be called from a tap/click handler.
 */
export async function enterFullscreen(): Promise<void> {
  if (!canFullscreen() || isFullscreen()) return;
  try {
    await document.documentElement.requestFullscreen({ navigationUI: "hide" });
  } catch {
    return;
  }
  try {
    await (screen.orientation as LockableOrientation).lock?.("landscape");
  } catch {
    // Orientation lock is unsupported on many devices; the rotate hint covers those.
  }
}

export function exitFullscreen(): void {
  if (isFullscreen()) void document.exitFullscreen();
}
