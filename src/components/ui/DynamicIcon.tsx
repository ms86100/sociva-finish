// @ts-nocheck
import { useEffect, useState } from 'react';
import { Package, LucideProps } from 'lucide-react';

interface DynamicIconProps extends LucideProps {
  name: string;
}

/**
 * Renders a Lucide icon by its PascalCase name (e.g. "UtensilsCrossed").
 * Falls back to Package icon if the name is not found in the Lucide registry.
 * If the name looks like an emoji (starts with non-ASCII), renders it as text.
 * The full icon registry loads only for Lucide names, not for emoji.
 */
function LucideNamedIcon({ name, ...props }: DynamicIconProps) {
  const [Icon, setIcon] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setIcon(null);
    import('./lucide-registry')
      .then((mod) => {
        if (cancelled) return;
        setIcon(() => mod.lookupIcon(name));
      })
      .catch(() => {
        if (!cancelled) setIcon(null);
      });
    return () => {
      cancelled = true;
    };
  }, [name]);

  const Resolved = Icon || Package;
  return <Resolved {...props} />;
}

export function DynamicIcon({ name, ...props }: DynamicIconProps) {
  if (!name) return <Package {...props} />;

  const code = name.codePointAt(0) ?? 0;
  if (code > 127) {
    return <span className="leading-none" style={{ fontSize: props.size ?? 24 }}>{name}</span>;
  }

  return <LucideNamedIcon name={name} {...props} />;
}
