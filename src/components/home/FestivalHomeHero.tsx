// @ts-nocheck
import { useFestivalTakeover } from '@/hooks/queries/useActiveFestivals';
import { FestivalStringLights } from '@/components/home/FestivalStringLights';
import { hapticSelection } from '@/lib/haptics';
import { Sparkles } from 'lucide-react';

interface FestivalHomeHeroProps {
  onExplore: () => void;
}

export function FestivalHomeHero({ onExplore }: FestivalHomeHeroProps) {
  const takeover = useFestivalTakeover();

  if (!takeover.active) return null;

  const gradient = takeover.gradient || [];
  const canvasStyle = gradient.length >= 2
    ? {
        background: `linear-gradient(180deg, ${takeover.bg} 0%, ${gradient[0]} 48%, ${takeover.bg} 100%)`,
        ['--festival-accent' as string]: takeover.accent,
      }
    : {
        backgroundColor: takeover.bg,
        ['--festival-accent' as string]: takeover.accent,
      };

  return (
    <div
      className="relative overflow-hidden px-4 pt-3 pb-4"
      style={canvasStyle}
      data-testid="festival-home-hero"
    >
      <div className="festival-orb festival-orb-1" />
      <div className="festival-orb festival-orb-2" />
      <FestivalStringLights />

      <div className="relative z-10 mt-1.5 flex items-end justify-between gap-3">
        <div className="min-w-0">
          {(takeover.badge || takeover.subtitle) && (
            <p className="text-[10px] font-semibold tracking-[0.2em] uppercase text-white/70">
              {takeover.badge || takeover.subtitle}
            </p>
          )}
          <h2
            className="mt-1 font-serif text-[28px] leading-[1.05] font-bold [text-shadow:_0_2px_16px_rgba(0,0,0,0.35)]"
            style={{ color: takeover.accent }}
          >
            {takeover.title || 'Festival Special'}
          </h2>
          {takeover.subtitle && takeover.badge && (
            <p className="mt-1 text-sm text-white/85 line-clamp-2 [text-shadow:_0_1px_6px_rgba(0,0,0,0.35)]">
              {takeover.subtitle}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            hapticSelection();
            onExplore();
          }}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/15 backdrop-blur-md px-3.5 py-2 text-[12px] font-bold text-white active:scale-[0.97] transition-transform"
        >
          <Sparkles size={14} style={{ color: takeover.accent }} />
          Explore festival
        </button>
      </div>
    </div>
  );
}
