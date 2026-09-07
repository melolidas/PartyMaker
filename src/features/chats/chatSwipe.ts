type SwipeMovement = { dx: number; dy: number };
type SwipeRelease = SwipeMovement & { vx: number; peakDx?: number };

export type NativeChatSwipeEvent = {
  translationX: number;
  translationY: number;
  velocityX: number;
  numberOfPointers: number;
};

// Evaluated by the native recognizer before ScrollView may begin scrolling.
// The detector covers the full screen, including the very first left-edge pixel.
export const chatPanActivation = {
  activeOffsetX: 6,
  failOffsetX: -10,
  failOffsetY: [-16, 16] as [number, number],
  maxPointers: 1,
};

export function getNativeChatSwipeTravel(gesture: NativeChatSwipeEvent, offset = 0): SwipeRelease {
  // RNGH supplies the entire translation and velocity in points/second.
  // Unlike PanResponder, there is no lost prefix to add back after activation.
  return { dx: offset + gesture.translationX, dy: gesture.translationY, vx: gesture.velocityX / 1000 };
}

export function getChatSwipeOffset(dx: number, width: number): number {
  return Math.max(0, Math.min(dx, width));
}

export function shouldDismissChats({ dx, dy, vx, peakDx = dx }: SwipeRelease, width: number): boolean {
  if (width <= 0 || dx <= 0 || dx < Math.abs(dy) * 0.8) return false;
  // A tiny leftward wobble while lifting a thumb isn't a cancellation. Require
  // a meaningful return towards the starting edge, not just a negative frame.
  if (peakDx - dx >= 24 && vx <= 0) return false;
  const distanceThreshold = Math.min(80, Math.max(48, width * 0.15));
  const projectedDistance = dx + Math.max(0, vx) * 180;
  return dx >= distanceThreshold || (dx >= 18 && vx >= 0.3 && projectedDistance >= distanceThreshold);
}
