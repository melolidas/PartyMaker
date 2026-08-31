export type NavScrollState = {
  offset: number;
  direction: -1 | 0 | 1;
  distance: number;
  compact: boolean;
};

export const initialNavScrollState: NavScrollState = {
  offset: 0,
  direction: 0,
  distance: 0,
  compact: false,
};

type ScrollMetrics = {
  contentOffset: { y: number };
  contentSize?: { height: number };
  layoutMeasurement?: { height: number };
  contentInset?: { top: number; bottom: number };
};

export function getNavScrollInput(
  event: ScrollMetrics,
  measured: { contentHeight: number; viewportHeight: number },
) {
  const insetTop = event.contentInset?.top ?? 0;
  const insetBottom = event.contentInset?.bottom ?? 0;
  const contentHeight = event.contentSize?.height || measured.contentHeight;
  const viewportHeight = event.layoutMeasurement?.height || measured.viewportHeight;
  return {
    // UIScrollView can rest at a negative offset when it has a top inset.
    offset: event.contentOffset.y + insetTop,
    maxOffset: Math.max(0, contentHeight + insetTop + insetBottom - viewportHeight),
  };
}

/** Clamp overscroll and accumulate deliberate movement, not single-frame jitter. */
export function getNavScrollState(
  previous: NavScrollState,
  offset: number,
  maxOffset: number,
): NavScrollState {
  const scrollRange = Math.max(maxOffset, 0);
  const nextOffset = Math.min(Math.max(offset, 0), scrollRange);

  // Large iPhones can have only a few points of actual scroll range. Fixed
  // 32px/14px thresholds made compact mode unreachable on those short screens.
  const topThreshold = Math.min(12, scrollRange * 0.1);
  const collapseOffset = Math.min(32, scrollRange * 0.35);
  const collapseDistance = Math.min(14, scrollRange * 0.3);
  const expandDistance = Math.min(10, scrollRange * 0.2);

  if (nextOffset <= topThreshold) {
    return { ...initialNavScrollState, offset: nextOffset };
  }

  const delta = nextOffset - previous.offset;
  if (Math.abs(delta) < 0.5) {
    return previous;
  }

  const direction = delta > 0 ? 1 : -1;
  const distance = previous.direction === direction
    ? previous.distance + Math.abs(delta)
    : Math.abs(delta);

  let compact = previous.compact;
  if (direction === 1 && nextOffset > collapseOffset && distance >= collapseDistance) {
    compact = true;
  } else if (direction === -1 && distance >= expandDistance) {
    compact = false;
  }

  return { offset: nextOffset, direction, distance, compact };
}
