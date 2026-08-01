// @ts-nocheck
import { icons, LucideProps } from 'lucide-react';
import { Package } from 'lucide-react';

interface DynamicIconProps extends LucideProps {
  name: string;
}

/**
 * Renders a Lucide icon by its PascalCase name (e.g. "UtensilsCrossed").
 * Falls back to Package icon if the name is not found in the Lucide registry.
 * If the name looks like an emoji (starts with non-ASCII), renders it as text.
 */
export function DynamicIcon({ name, ...props }: DynamicIconProps) {
  // If name is an emoji or empty, render as text span
  if (!name) return <Package {...props} />;

  // Check if first char is non-ASCII (emoji)
  const code = name.codePointAt(0) ?? 0;
  if (code > 127) {
    return <span className="leading-none" style={{ fontSize: props.size ?? 24 }}>{name}</span>;
  }

  const LucideIcon = (icons as Record<string, any>)[name];
  if (!LucideIcon) {
    return <Package {...props} />;
  }

  return <LucideIcon {...props} />;
}
