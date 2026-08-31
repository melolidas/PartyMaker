export const navMotion = {
  scrollDuration: 1600,
  pressInDuration: 620,
  pressHoldDuration: 60,
  pressOutDuration: 1080,
  glintDuration: 400,
  glintFillAt: 0.58,
  reducedFeedbackDuration: 180,
  reducedLayoutDuration: 180,
  selectionDuration: 760,
  compactScale: 0.92,
  pressScaleX: 1.035,
  pressScaleY: 1.06,
} as const;

export const navLayout = {
  horizontalPadding: 9,
  itemCount: 5,
  indicatorHeight: 52,
  indicatorMaxWidth: 68,
} as const;

export function getNavItemLayout(width: number) {
  const slotWidth = Math.max(0, width - navLayout.horizontalPadding * 2) / navLayout.itemCount;
  const indicatorWidth = Math.min(navLayout.indicatorMaxWidth, Math.max(0, slotWidth - 2));
  return {
    slotWidth,
    indicatorWidth,
    indicatorLeft: navLayout.horizontalPadding + (slotWidth - indicatorWidth) / 2,
  };
}

export function getNavScrollAnimation(compact: boolean, reduceMotion: boolean) {
  return {
    // Compact mode is functional layout, not an optional decorative effect.
    // Reduced motion shortens the transition; it must not disable this state.
    toValue: compact ? 1 : 0,
    duration: reduceMotion ? navMotion.reducedLayoutDuration : navMotion.scrollDuration,
  };
}

// A sine curve spreads movement across the duration instead of concentrating
// almost all the size change in the middle of a cubic easing curve.
export function easeNavMotion(progress: number) {
  const clamped = Math.min(1, Math.max(0, progress));
  return (1 - Math.cos(Math.PI * clamped)) / 2;
}

export function getNavGlintLayout(originX: number, width: number, height = 64) {
  const safeWidth = Math.max(0, width);
  const origin = Math.min(safeWidth, Math.max(0, originX));
  const centerY = Math.max(0, height) / 2;
  // A circle centered on the icon reaches every corner of the panel, not just
  // its horizontal edges. The outer capsule clips everything outside the bar.
  const radius = safeWidth > 0 ? Math.hypot(Math.max(origin, safeWidth - origin), centerY) : 0;
  return {
    width: safeWidth,
    origin,
    radius,
    diameter: radius * 2,
    left: origin - radius,
    top: centerY - radius,
  };
}
