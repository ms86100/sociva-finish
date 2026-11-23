import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

type HeroTone = 'primary' | 'emerald' | 'amber' | 'slate';

const TONE_CLASS: Record<HeroTone, string> = {
  primary: 'from-primary via-primary/85 to-emerald-700 shadow-primary/20',
  emerald: 'from-emerald-600 via-emerald-700 to-teal-800 shadow-emerald-700/20',
  amber: 'from-amber-500 via-orange-500 to-rose-600 shadow-orange-500/20',
  slate: 'from-slate-900 via-slate-800 to-indigo-900 shadow-slate-900/25',
};

interface SocietyModuleHeroProps {
  eyebrow: string;
  title: ReactNode;
  subtitle: string;
  icon: LucideIcon;
  action?: ReactNode;
  tone?: HeroTone;
}

export function SocietyModuleHero({
  eyebrow,
  title,
  subtitle,
  icon: Icon,
  action,
  tone = 'primary',
}: SocietyModuleHeroProps) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-gradient-to-br p-5 text-primary-foreground shadow-lg',
        TONE_CLASS[tone],
      )}
    >
      <div className="pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full bg-white/15 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-12 left-10 h-28 w-28 rounded-full bg-white/10 blur-2xl" />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary-foreground/80">
            <Sparkles size={12} /> {eyebrow}
          </p>
          <div className="mt-2 text-3xl font-bold leading-none tracking-tight">{title}</div>
          <p className="mt-1.5 text-sm text-primary-foreground/85">{subtitle}</p>
        </div>
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 backdrop-blur">
          <Icon size={26} />
        </div>
      </div>
      {action ? <div className="relative mt-5">{action}</div> : null}
    </div>
  );
}

interface SocietyEmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}

export function SocietyEmptyState({ icon: Icon, title, description, action }: SocietyEmptyStateProps) {
  return (
    <div className="relative overflow-hidden rounded-[1.75rem] border border-border/60 bg-gradient-to-br from-card via-background to-secondary/50 px-5 py-14 text-center shadow-card">
      <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-primary/10 blur-2xl" />
      <div className="relative mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Icon size={26} />
      </div>
      <p className="relative text-sm font-semibold text-foreground">{title}</p>
      <p className="relative mx-auto mt-2 max-w-[280px] text-xs leading-relaxed text-muted-foreground">
        {description}
      </p>
      {action ? <div className="relative mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}
