import { icons } from 'lucide-react';

type IconComponent = (props: Record<string, unknown>) => unknown;

const registry = icons as unknown as Record<string, IconComponent | undefined>;

/** Look up one Lucide icon by PascalCase name, or a lowercase/snake alias. */
export function lookupIcon(name: string): IconComponent | null {
  if (!name) return null;
  if (registry[name]) return registry[name] ?? null;
  const pascal = name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
  return registry[pascal] ?? null;
}
