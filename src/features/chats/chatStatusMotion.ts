export function shouldRunChatPulse(active: boolean, appState: string | null): boolean {
  return active && (appState === 'active' || appState === null);
}

export function getChatPulseMotion(reduceMotion: boolean) {
  return {
    duration: reduceMotion ? 2000 : 1200,
    // Rise quickly, stay bright for most of the cycle, then briefly soften.
    inputRange: [0, 0.14, 0.72, 0.9, 1],
    dotScale: reduceMotion ? [1, 1, 1, 1, 1] : [1, 1.55, 1.2, 1, 1],
    // On devices using Reduce Motion, scaling is disabled. A 90–100% fade
    // looked static on iPhone: keep the red on, then give it a short clear dip.
    dotOpacity: reduceMotion ? [1, 1, 1, 0.45, 1] : [0.88, 1, 1, 0.88, 0.88],
    haloScale: [0.7, 1.3, 1.1, 0.7, 0.7],
    haloOpacity: [0.18, 0.7, 0.48, 0.18, 0.18],
    ringScale: [0.4, 0.75, 1.3, 1.6, 1.7],
    ringOpacity: [0, 0.95, 0.4, 0.1, 0],
  };
}
