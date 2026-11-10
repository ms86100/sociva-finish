import { cn } from '@/lib/utils';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function ProtoPage({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mx-auto flex w-full max-w-lg flex-col gap-4 px-4 pb-28 pt-3', className)}>
      {children}
    </div>
  );
}

export function ProtoHero({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-emerald-900/10 bg-gradient-to-br from-emerald-900 via-emerald-800 to-teal-800 p-5 text-white shadow-sm">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.25), transparent 40%), radial-gradient(circle at 80% 0%, rgba(16,185,129,0.45), transparent 35%)',
        }}
      />
      <div className="relative z-10 space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-emerald-100/80">
          Your daily commute, connected
        </p>
        <h1 className="font-[family-name:var(--font-display,'Plus_Jakarta_Sans',system-ui)] text-2xl font-semibold leading-tight tracking-tight">
          {title}
        </h1>
        {subtitle ? <p className="text-sm text-emerald-50/90">{subtitle}</p> : null}
        {children}
      </div>
    </section>
  );
}

export function MapPlane({
  label,
  meta,
  compact,
}: {
  label: string;
  meta?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border border-border/70 bg-[#e8f2ec]',
        compact ? 'h-28' : 'h-44',
      )}
    >
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 400 180" preserveAspectRatio="none" aria-hidden>
        <path d="M0 120 C80 80, 140 140, 220 100 S340 60, 400 90" fill="none" stroke="#0f766e" strokeWidth="3" opacity="0.55" />
        <path d="M0 140 C100 110, 180 160, 280 120 S360 100, 400 130" fill="none" stroke="#059669" strokeWidth="2" opacity="0.35" />
        <circle cx="70" cy="115" r="7" fill="#047857" />
        <circle cx="320" cy="85" r="7" fill="#0f766e" />
      </svg>
      <div className="absolute bottom-3 left-3 right-3 rounded-xl bg-white/90 px-3 py-2 backdrop-blur-sm">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        {meta ? <p className="text-xs text-muted-foreground">{meta}</p> : null}
      </div>
    </div>
  );
}

export function ProtoCard({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'w-full rounded-2xl border border-border/70 bg-card p-4 text-left shadow-sm',
        onClick && 'transition hover:border-emerald-700/30 active:scale-[0.99]',
        className,
      )}
    >
      {children}
    </Comp>
  );
}

export function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-2xl bg-secondary p-1">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={cn(
            'rounded-xl px-3 py-2.5 text-sm font-semibold transition',
            value === opt.id
              ? 'bg-emerald-800 text-white shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function ProtoBtn({
  children,
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-11 min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition disabled:opacity-50',
        variant === 'primary' && 'bg-emerald-800 text-white hover:bg-emerald-900',
        variant === 'secondary' && 'border border-border bg-background hover:bg-secondary',
        variant === 'ghost' && 'hover:bg-secondary',
        variant === 'danger' && 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function StatusPill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'live' | 'warn' | 'ok' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
        tone === 'neutral' && 'bg-secondary text-muted-foreground',
        tone === 'live' && 'bg-emerald-100 text-emerald-900',
        tone === 'warn' && 'bg-amber-100 text-amber-900',
        tone === 'ok' && 'bg-sky-100 text-sky-900',
      )}
    >
      {children}
    </span>
  );
}

export function Sheet({
  open,
  title,
  children,
  onClose,
  icon,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  icon?: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-3 sm:items-center">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-3xl border border-border bg-background p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            {icon ? <div className="mt-0.5 text-emerald-800">{icon}</div> : null}
            <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          </div>
          <button type="button" className="text-lg leading-none text-muted-foreground" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({
  label,
  value,
  readOnly,
  onChange,
}: {
  label: string;
  value: string;
  readOnly?: boolean;
  onChange?: (v: string) => void;
}) {
  return (
    <label className="block min-w-0 flex-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <input
        className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-medium"
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
      />
    </label>
  );
}

export function SeatStepper({
  value,
  min = 1,
  max = 4,
  onChange,
  label = 'Seats',
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (n: number) => void;
  label?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-lg font-semibold"
          onClick={() => onChange(Math.max(min, value - 1))}
          aria-label="Decrease"
        >
          −
        </button>
        <span className="min-w-[4.5rem] text-center text-sm font-semibold">{value} seat{value === 1 ? '' : 's'}</span>
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-lg font-semibold"
          onClick={() => onChange(Math.min(max, value + 1))}
          aria-label="Increase"
        >
          +
        </button>
      </div>
    </div>
  );
}

export function DayChips({
  days,
  selected,
  onToggle,
}: {
  days: string[];
  selected: string[];
  onToggle: (day: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {days.map((d) => {
        const on = selected.includes(d);
        return (
          <button
            key={d}
            type="button"
            onClick={() => onToggle(d)}
            className={cn(
              'rounded-xl px-2.5 py-1.5 text-xs font-semibold transition',
              on ? 'bg-emerald-800 text-white' : 'bg-secondary text-muted-foreground',
            )}
          >
            {d}
          </button>
        );
      })}
    </div>
  );
}

export function TrustChip({
  children,
  tone = 'green',
}: {
  children: ReactNode;
  tone?: 'green' | 'muted';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold',
        tone === 'green' && 'bg-emerald-50 text-emerald-900',
        tone === 'muted' && 'bg-secondary text-muted-foreground',
      )}
    >
      <span
        className={cn('h-1.5 w-1.5 rounded-full', tone === 'green' ? 'bg-emerald-600' : 'bg-muted-foreground/50')}
        aria-hidden
      />
      {children}
    </span>
  );
}

export function InitialsAvatar({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <div
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-900"
      aria-hidden
    >
      {initials || '?'}
    </div>
  );
}

export function VerticalRoute({
  from,
  to,
  leaveTime,
  arriveTime,
  durationMin,
}: {
  from: string;
  to: string;
  leaveTime: string;
  arriveTime: string;
  durationMin: number;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center pt-1">
        <span className="h-2.5 w-2.5 rounded-full border-2 border-emerald-700 bg-background" />
        <span className="my-0.5 w-px flex-1 bg-emerald-700/40" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-700" />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{from}</p>
            <p className="text-xs text-muted-foreground">{leaveTime}</p>
          </div>
        </div>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{to}</p>
            <p className="text-xs text-muted-foreground">{arriveTime}</p>
          </div>
          <p className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Travel time: <span className="text-foreground">{durationMin} min</span>
          </p>
        </div>
      </div>
    </div>
  );
}

export function AlongYourWay({ stops }: { stops: string[] }) {
  if (!stops.length) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2">
      <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-800" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M12 19V5M12 5l-5 5M12 5l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p className="text-xs text-emerald-950">
        <span className="font-semibold">Along your way: </span>
        {stops.join(' · ')}
      </p>
    </div>
  );
}

export function RouteTimeline({ stops }: { stops: string[] }) {
  if (!stops.length) return null;
  return <AlongYourWay stops={stops} />;
}

export function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2.5 text-left"
    >
      <span className="text-sm font-medium">{label}</span>
      <span
        className={cn(
          'relative h-6 w-11 rounded-full transition',
          checked ? 'bg-emerald-700' : 'bg-secondary',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition',
            checked ? 'left-5' : 'left-0.5',
          )}
        />
      </span>
    </button>
  );
}
