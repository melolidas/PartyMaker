export const MIN_EXTROVERSION_LEVEL = 1;
export const MAX_EXTROVERSION_LEVEL = 10;
export const DEFAULT_EXTROVERSION_LEVEL = 5.5;

const LEVEL_COLORS = [
  '#47C7FF',
  '#4BA8FF',
  '#567BFF',
  '#6962FF',
  '#8750FF',
  '#B143F4',
  '#D238DC',
  '#EB2C9B',
  '#F72567',
  '#FF3B30',
] as const;

export type ExtroversionBand = 'introvert' | 'ambivert' | 'extrovert';

export function normalizeExtroversionLevel(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_EXTROVERSION_LEVEL;
  const halfStep = Math.round(value * 2) / 2;
  return Math.min(MAX_EXTROVERSION_LEVEL, Math.max(MIN_EXTROVERSION_LEVEL, halfStep));
}

export function getExtroversionBand(level: number): ExtroversionBand {
  const normalized = normalizeExtroversionLevel(level);
  if (normalized <= 3.5) return 'introvert';
  if (normalized >= 7.5) return 'extrovert';
  return 'ambivert';
}

export function getExtroversionVisual(level: number) {
  const normalized = normalizeExtroversionLevel(level);
  const palettePosition = normalized - MIN_EXTROVERSION_LEVEL;
  const leftColorIndex = Math.floor(palettePosition);
  const rightColorIndex = Math.ceil(palettePosition);
  const color = mixHex(
    LEVEL_COLORS[leftColorIndex],
    LEVEL_COLORS[rightColorIndex],
    palettePosition - leftColorIndex,
  );

  return {
    level: normalized,
    color,
    highlight: mixHex(color, '#FFFFFF', 0.2),
    shadow: mixHex(color, '#000000', 0.18),
    needleRotation: ((normalized - DEFAULT_EXTROVERSION_LEVEL) / (MAX_EXTROVERSION_LEVEL - DEFAULT_EXTROVERSION_LEVEL)) * 140,
  };
}

function mixHex(from: string, to: string, amount: number) {
  const left = hexToRgb(from);
  const right = hexToRgb(to);
  const channel = (start: number, end: number) => Math.round(start + (end - start) * amount).toString(16).padStart(2, '0');
  return `#${channel(left[0], right[0])}${channel(left[1], right[1])}${channel(left[2], right[2])}`.toUpperCase();
}

function hexToRgb(value: string): [number, number, number] {
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
}
