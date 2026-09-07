import { getChatSwipeOffset, getNativeChatSwipeTravel, NativeChatSwipeEvent, shouldDismissChats } from './chatSwipe';

type MotionAdapter = {
  getWidth: () => number;
  getReduceMotion: () => boolean;
  getPosition: () => number;
  setPosition: (position: number) => void;
  stopAnimation: () => void;
  animateTo: (position: number, duration: number, complete: (finished: boolean) => void) => void;
  onClose: () => void;
};

// Shared by the real native gesture callbacks and lifecycle regression tests.
export function createChatSwipeController(motion: MotionAdapter) {
  let phase: 'idle' | 'dragging' | 'settling' | 'closing' | 'closed' | 'disposed' = 'idle';
  let animationId = 0;
  let dragOffset = 0;
  let peakTravel = 0;

  const interruptAnimation = () => {
    animationId += 1;
    motion.stopAnimation();
    return animationId;
  };

  const restore = () => {
    if (phase !== 'dragging') return;
    phase = 'settling';
    const id = interruptAnimation();
    motion.animateTo(0, motion.getReduceMotion() ? 120 : 220, () => {
      if (id !== animationId || phase === 'disposed') return;
      motion.setPosition(0);
      phase = 'idle';
    });
  };

  const close = () => {
    if (phase === 'closing' || phase === 'closed' || phase === 'disposed') return;
    const wasDragging = phase === 'dragging';
    phase = 'closing';
    const id = interruptAnimation();
    if (motion.getReduceMotion() && !wasDragging) {
      phase = 'closed';
      motion.onClose();
      return;
    }
    motion.animateTo(motion.getWidth(), motion.getReduceMotion() ? 120 : 240, () => {
      // A confirmed dismissal must not get stuck if iOS cancels the animation.
      if (id === animationId && phase === 'closing') {
        phase = 'closed';
        motion.onClose();
      }
    });
  };

  const update = (event: NativeChatSwipeEvent) => {
    if (phase !== 'dragging') return;
    if (event.numberOfPointers !== 1) {
      restore();
      return;
    }
    const travel = getNativeChatSwipeTravel(event, dragOffset);
    peakTravel = Math.max(peakTravel, travel.dx);
    motion.setPosition(getChatSwipeOffset(travel.dx, motion.getWidth()));
  };

  return {
    close,
    cancel: restore,
    start(event: NativeChatSwipeEvent) {
      if (phase === 'closing' || phase === 'closed' || phase === 'disposed' || event.numberOfPointers !== 1) return;
      // Interrupt an unfinished snap-back from its current visible position.
      dragOffset = phase === 'settling' ? motion.getPosition() : 0;
      interruptAnimation();
      peakTravel = dragOffset;
      phase = 'dragging';
      update(event);
    },
    update,
    end(event: NativeChatSwipeEvent, success: boolean) {
      if (phase !== 'dragging') return;
      const travel = getNativeChatSwipeTravel(event, dragOffset);
      if (success && shouldDismissChats({ ...travel, peakDx: peakTravel }, motion.getWidth())) close();
      else restore();
    },
    reset() {
      if (phase === 'closing' || phase === 'disposed') return;
      interruptAnimation();
      motion.setPosition(0);
      phase = 'idle';
    },
    dispose() {
      phase = 'disposed';
      interruptAnimation();
    },
  };
}
