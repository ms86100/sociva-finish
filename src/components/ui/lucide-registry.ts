import { icons } from 'lucide-react';

type IconComponent = (props: Record<string, unknown>) => unknown;

const registry = icons as unknown as Record<string, IconComponent | undefined>;

/** Look up one Lucide icon by its PascalCase export name. */
export function lookupIcon(name: string): IconComponent | null {
  return registry[name] ?? null;
}
