/** RFC3339 at database millisecond precision, restricted to AD years 0001–9999. */
export function parseLobbyInstant(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || value.startsWith('0000-')) return null;
  const wall = `${match[1]}T${match[2]}`;
  const local = new Date(`${wall}${match[3] ?? ''}Z`);
  // Date.parse normalizes e.g. February 30 and 24:00; those are not valid input.
  if (!Number.isFinite(local.getTime()) || local.toISOString().slice(0, 19) !== wall) return null;
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime()) || instant.getUTCFullYear() < 1 || instant.getUTCFullYear() > 9999) return null;
  return instant;
}
