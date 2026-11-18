/** Logical canvas size; the viewport scales it to the window at full device-pixel resolution. */
export const SCREEN_W = 1280;
export const SCREEN_H = 720;

export const colors = {
  bg: "#182030",
  bgAccent: "#202c42",
  text: "#ebeef5",
  textDim: "#96a0b4",
  pyBlue: "#3776ab",
  pyYellow: "#ffd43b",
  white: "#ffffff",
  cardFace: "#faf8f2",
  cardText: "#1e222c",
  cardBack: "#1c3458",
  cardBackGrid: "#26426c",
  rowHover: "#dde9ff",
  rowSelected: "#ffe58a",
  rowWin: "#9be59b",
  rowLose: "#f2a3a3",
  rowTie: "#ffd27f",
  arrowUp: "#289650",
  arrowDown: "#c8503c",
  button: "#3776ab",
  buttonHover: "#4b91cd",
  buttonDisabled: "#465064",
  shadow: "rgba(0, 0, 0, 0.27)",
} as const;

// System fonts: crisp at every size and zero download time.
const FONT_FAMILY = '"Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif';

export function font(size: number, bold = false): string {
  return `${bold ? 700 : 400} ${size}px ${FONT_FAMILY}`;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Fallback card color for cards without a `color` in cards.json. */
export function libraryColor(library: string): string {
  return `hsl(${hash(library) % 360} 40% 50%)`;
}

/** Dark text on light brand colors (e.g. yellow), white otherwise; non-hex colors get white. */
export function textColorOn(color: string): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!match) return colors.white;
  const [r, g, b] = match.slice(1).map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? colors.cardText : colors.white;
}
