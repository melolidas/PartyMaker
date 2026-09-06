/** Read the clock, not interval ticks, so backgrounding cannot slow the timer. */
export function getRemainingSeconds(startsAt: number, now: number): number {
  const difference = startsAt - now;
  return Number.isFinite(difference) ? Math.max(0, Math.ceil(difference / 1000)) : 0;
}

export function formatCountdown(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  return [hours, minutes, remaining].map((value) => String(value).padStart(2, '0')).join(':');
}
