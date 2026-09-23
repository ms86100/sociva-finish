/** Compare dotted numeric versions. Empty minimum never blocks. */

export function isVersionBelow(current: string | null | undefined, minimum: string | null | undefined): boolean {
  const min = (minimum || '').trim();
  if (!min) return false;
  const cur = (current || '').trim();
  if (!cur) return true;

  const parts = (value: string) =>
    value
      .split(/[^0-9]+/)
      .filter(Boolean)
      .map((n) => Number.parseInt(n, 10));

  const a = parts(cur);
  const b = parts(min);
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff < 0) return true;
    if (diff > 0) return false;
  }
  return false;
}
