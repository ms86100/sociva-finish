// @ts-nocheck
import { cn } from '@/lib/utils';

/**
 * CSS-animated category icons for festival banners.
 * Each icon is pure CSS/SVG with a looping animation.
 * Store "anim:<key>" in icon_emoji to use these instead of emoji.
 */

interface AnimIconProps {
  size?: number;
  className?: string;
  color?: string;
}

function Gift({ size = 32, className, color = 'currentColor' }: AnimIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={cn('anim-icon anim-icon-bounce', className)}>
      <rect x="6" y="22" width="36" height="20" rx="3" fill={color} opacity="0.2" />
      <rect x="6" y="22" width="36" height="20" rx="3" stroke={color} strokeWidth="2" />
      <rect x="10" y="14" width="28" height="10" rx="2" fill={color} opacity="0.35" />
      <rect x="10" y="14" width="28" height="10" rx="2" stroke={color} strokeWidth="2" />
      <line x1="24" y1="14" x2="24" y2="42" stroke={color} strokeWidth="2" />
      <path d="M24 14c-4-6-12-6-12 0" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M24 14c4-6 12-6 12 0" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function Music({ size = 32, className, color = 'currentColor' }: AnimIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={cn('anim-icon anim-icon-sway', className)}>
      <circle cx="14" cy="36" r="5" fill={color} opacity="0.3" stroke={color} strokeWidth="2" />
      <circle cx="34" cy="32" r="5" fill={color} opacity="0.3" stroke={color} strokeWidth="2" />
      <line x1="19" y1="36" x2="19" y2="10" stroke={color} strokeWidth="2" />
      <line x1="39" y1="32" x2="39" y2="8" stroke={color} strokeWidth="2" />
      <path d="M19 10 Q29 6 39 8" stroke={color} strokeWidth="3" fill="none" strokeLinecap="round" />
      <circle cx="28" cy="16" r="2" fill={color} className="anim-icon-note" />
    </svg>
  );
}

function Food({ size = 32, className, color = 'currentColor' }: AnimIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={cn('anim-icon anim-icon-steam', className)}>
      <ellipse cx="24" cy="32" rx="16" ry="8" fill={color} opacity="0.2" stroke={color} strokeWidth="2" />
      <path d="M8 32 C8 22 40 22 40 32" stroke={color} strokeWidth="2" fill={color} opacity="0.15" />
      <line x1="24" y1="40" x2="24" y2="44" stroke={color} strokeWidth="3" strokeLinecap="round" />
      <path d="M16 18 Q16 12 18 10" stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" className="anim-steam-1" />
      <path d="M24 16 Q24 10 26 8" stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" className="anim-steam-2" />
      <path d="M32 18 Q32 12 30 10" stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" className="anim-steam-3" />
    </svg>
  );
}

function Clothing({ size = 32, className, color = 'currentColor' }: AnimIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={cn('anim-icon anim-icon-sway', className)}>
      <path d="M16 8 L8 16 L14 18 L14 40 L34 40 L34 18 L40 16 L32 8 Q28 14 24 14 Q20 14 16 8Z" fill={color} opacity="0.2" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      <path d="M16 8 Q20 14 24 14 Q28 14 32 8" stroke={color} strokeWidth="2" fill="none" />
    </svg>
  );
}

function Art({ size = 32, className, color = 'currentColor' }: AnimIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={cn('anim-icon anim-icon-spin-slow', className)}>
      <path d="M24 6 C36 6 42 14 42 24 C42 34 34 42 24 42 C18 42 14 38 14 34 C14 30 18 28 22 28 C24 28 26 26 26 24 C26 20 22 18 18 18 C12 18 6 22 6 24 C6 14 14 6 24 6Z" fill={color} opacity="0.2" stroke={color} strokeWidth="2" />
      <circle cx="16" cy="14" r="2.5" fill={color} opacity="0.6" />
      <circle cx="28" cy="12" r="2" fill={color} opacity="0.5" />
      <circle cx="34" cy="20" r="2.5" fill={color} opacity="0.7" />
      <circle cx="36" cy="30" r="2" fill={color} opacity="0.4" />
    </svg>
  );
}

function Flower({ size = 32, className, color = 'currentColor' }: AnimIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={cn('anim-icon anim-icon-bloom', className)}>
      {[0, 60, 120, 180, 240, 300].map(angle => (
        <ellipse key={angle} cx="24" cy="14" rx="5" ry="8" fill={color} opacity="0.25" transform={`rotate(${angle} 24 24)`} stroke={color} strokeWidth="1" />
      ))}
      <circle cx="24" cy="24" r="5" fill={color} opacity="0.5" stroke={color} strokeWidth="1.5" />
      <line x1="24" y1="32" x2="24" y2="46" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M24 38 Q18 34 16 36" stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function Diya({ size = 32, className, color = 'currentColor' }: AnimIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={cn('anim-icon', className)}>
      <ellipse cx="24" cy="36" rx="14" ry="5" fill={color} opacity="0.2" stroke={color} strokeWidth="2" />
      <path d="M10 36 Q12 24 24 22 Q36 24 38 36" fill={color} opacity="0.15" stroke={color} strokeWidth="2" />
      <path d="M24 22 Q22 14 24 8 Q26 14 24 22Z" fill={color} opacity="0.6" className="anim-flame" />
      <circle cx="24" cy="10" r="2" fill={color} opacity="0.4" className="anim-flame-glow" />
    </svg>
  );
}

function Star({ size = 32, className, color = 'currentColor' }: AnimIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={cn('anim-icon anim-icon-twinkle', className)}>
      <path d="M24 4 L28 18 L42 20 L30 28 L34 42 L24 34 L14 42 L18 28 L6 20 L20 18Z" fill={color} opacity="0.25" stroke={color} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function Heart({ size = 32, className, color = 'currentColor' }: AnimIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={cn('anim-icon anim-icon-pulse', className)}>
      <path d="M24 42 C12 32 4 24 4 16 C4 10 8 6 14 6 C18 6 22 8 24 12 C26 8 30 6 34 6 C40 6 44 10 44 16 C44 24 36 32 24 42Z" fill={color} opacity="0.25" stroke={color} strokeWidth="2" />
    </svg>
  );
}

function ShoppingBag({ size = 32, className, color = 'currentColor' }: AnimIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={cn('anim-icon anim-icon-bounce', className)}>
      <path d="M10 16 L8 42 L40 42 L38 16Z" fill={color} opacity="0.2" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      <path d="M16 16 C16 10 20 6 24 6 C28 6 32 10 32 16" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function Sparkle({ size = 32, className, color = 'currentColor' }: AnimIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={cn('anim-icon anim-icon-twinkle', className)}>
      <path d="M24 4 L26 20 L42 24 L26 28 L24 44 L22 28 L6 24 L22 20Z" fill={color} opacity="0.3" stroke={color} strokeWidth="2" />
      <path d="M38 8 L39 14 L44 16 L39 18 L38 24 L37 18 L32 16 L37 14Z" fill={color} opacity="0.2" className="anim-icon-note" />
    </svg>
  );
}

function Drum({ size = 32, className, color = 'currentColor' }: AnimIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={cn('anim-icon anim-icon-bounce', className)}>
      <ellipse cx="24" cy="18" rx="14" ry="6" fill={color} opacity="0.3" stroke={color} strokeWidth="2" />
      <rect x="10" y="18" width="28" height="16" fill={color} opacity="0.15" stroke={color} strokeWidth="2" />
      <ellipse cx="24" cy="34" rx="14" ry="6" fill={color} opacity="0.2" stroke={color} strokeWidth="2" />
      <line x1="10" y1="4" x2="18" y2="18" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="38" y1="4" x2="30" y2="18" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <circle cx="10" cy="4" r="2.5" fill={color} opacity="0.5" />
      <circle cx="38" cy="4" r="2.5" fill={color} opacity="0.5" />
    </svg>
  );
}

function Sweet({ size = 32, className, color = 'currentColor' }: AnimIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={cn('anim-icon anim-icon-sway', className)}>
      <circle cx="24" cy="26" r="12" fill={color} opacity="0.25" stroke={color} strokeWidth="2" />
      <path d="M14 20 Q10 14 14 10" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M34 20 Q38 14 34 10" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" />
      <circle cx="20" cy="24" r="2" fill={color} opacity="0.4" />
      <circle cx="28" cy="24" r="2" fill={color} opacity="0.4" />
      <circle cx="24" cy="30" r="2" fill={color} opacity="0.4" />
    </svg>
  );
}

function Craft({ size = 32, className, color = 'currentColor' }: AnimIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={cn('anim-icon anim-icon-spin-slow', className)}>
      <path d="M20 6 L6 24 L20 42" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M28 6 L42 24 L28 42" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24" cy="24" r="4" fill={color} opacity="0.3" stroke={color} strokeWidth="2" />
    </svg>
  );
}

function HomeDecor({ size = 32, className, color = 'currentColor' }: AnimIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={cn('anim-icon anim-icon-bounce', className)}>
      <path d="M6 24 L24 8 L42 24" stroke={color} strokeWidth="2" fill="none" strokeLinejoin="round" />
      <rect x="12" y="24" width="24" height="18" fill={color} opacity="0.15" stroke={color} strokeWidth="2" />
      <rect x="20" y="30" width="8" height="12" fill={color} opacity="0.25" stroke={color} strokeWidth="1.5" rx="1" />
      <rect x="14" y="28" width="5" height="5" fill={color} opacity="0.2" stroke={color} strokeWidth="1.5" rx="0.5" />
    </svg>
  );
}

function Firework({ size = 32, className, color = 'currentColor' }: AnimIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={cn('anim-icon anim-icon-twinkle', className)}>
      <circle cx="24" cy="20" r="4" fill={color} opacity="0.4" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map(angle => {
        const rad = (angle * Math.PI) / 180;
        const x1 = 24 + Math.cos(rad) * 8;
        const y1 = 20 + Math.sin(rad) * 8;
        const x2 = 24 + Math.cos(rad) * 16;
        const y2 = 20 + Math.sin(rad) * 16;
        return <line key={angle} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.5" />;
      })}
      <line x1="24" y1="28" x2="24" y2="46" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.3" />
    </svg>
  );
}

function Jewelry({ size = 32, className, color = 'currentColor' }: AnimIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={cn('anim-icon anim-icon-twinkle', className)}>
      <polygon points="24,6 30,18 42,20 33,28 36,40 24,34 12,40 15,28 6,20 18,18" fill={color} opacity="0.2" stroke={color} strokeWidth="1.5" />
      <circle cx="24" cy="24" r="6" fill={color} opacity="0.3" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

function Rangoli({ size = 32, className, color = 'currentColor' }: AnimIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={cn('anim-icon anim-icon-spin-slow', className)}>
      <circle cx="24" cy="24" r="18" stroke={color} strokeWidth="1.5" opacity="0.3" />
      <circle cx="24" cy="24" r="10" stroke={color} strokeWidth="1.5" opacity="0.4" />
      <circle cx="24" cy="24" r="4" fill={color} opacity="0.3" />
      {[0, 60, 120, 180, 240, 300].map(angle => {
        const rad = (angle * Math.PI) / 180;
        const x = 24 + Math.cos(rad) * 14;
        const y = 24 + Math.sin(rad) * 14;
        return <circle key={angle} cx={x} cy={y} r="3" fill={color} opacity="0.25" stroke={color} strokeWidth="1" />;
      })}
    </svg>
  );
}

// ── Registry ──

export const ANIMATED_ICON_REGISTRY: Record<string, {
  component: React.FC<AnimIconProps>;
  label: string;
  category: string;
}> = {
  gift:       { component: Gift, label: 'Gift', category: 'General' },
  shopping:   { component: ShoppingBag, label: 'Shopping', category: 'General' },
  sparkle:    { component: Sparkle, label: 'Sparkle', category: 'General' },
  star:       { component: Star, label: 'Star', category: 'General' },
  heart:      { component: Heart, label: 'Heart', category: 'General' },
  music:      { component: Music, label: 'Music', category: 'Culture' },
  drum:       { component: Drum, label: 'Drum', category: 'Culture' },
  art:        { component: Art, label: 'Art / Palette', category: 'Culture' },
  craft:      { component: Craft, label: 'Craft', category: 'Culture' },
  rangoli:    { component: Rangoli, label: 'Rangoli', category: 'Culture' },
  food:       { component: Food, label: 'Food', category: 'Lifestyle' },
  sweet:      { component: Sweet, label: 'Sweets', category: 'Lifestyle' },
  clothing:   { component: Clothing, label: 'Clothing', category: 'Lifestyle' },
  jewelry:    { component: Jewelry, label: 'Jewelry', category: 'Lifestyle' },
  flower:     { component: Flower, label: 'Flowers', category: 'Lifestyle' },
  diya:       { component: Diya, label: 'Diya / Lamp', category: 'Festival' },
  firework:   { component: Firework, label: 'Fireworks', category: 'Festival' },
  homedecor:  { component: HomeDecor, label: 'Home Decor', category: 'Festival' },
};

export const ANIMATED_ICON_KEYS = Object.keys(ANIMATED_ICON_REGISTRY);

/**
 * Render an animated icon by key.
 * Supports "anim:<key>" format (stored in icon_emoji) or plain key.
 */
export function AnimatedCategoryIcon({
  iconKey,
  size = 32,
  color,
  className,
}: {
  iconKey: string;
  size?: number;
  color?: string;
  className?: string;
}) {
  const key = iconKey.replace(/^anim:/, '');
  const entry = ANIMATED_ICON_REGISTRY[key];
  if (!entry) return <span className="text-2xl">📦</span>;
  const Comp = entry.component;
  return <Comp size={size} color={color} className={className} />;
}

/** Check if icon_emoji value is an animated icon */
export function isAnimatedIcon(iconEmoji: string | null | undefined): boolean {
  if (!iconEmoji) return false;
  return iconEmoji.startsWith('anim:');
}
