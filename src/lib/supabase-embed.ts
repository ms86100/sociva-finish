/** PostgREST may return a to-one embed as an object or a one-element array. */
export function firstEmbed<T extends object>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const first = value[0];
    return first && typeof first === 'object' ? first : null;
  }
  return typeof value === 'object' ? value : null;
}
