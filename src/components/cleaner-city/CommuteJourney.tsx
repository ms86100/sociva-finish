// @ts-nocheck
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export type JourneyQuest = {
  id: string;
  title: string;
  detail: string;
  href: string;
  done: boolean;
};

const LEVELS = [
  'New commuter',
  'Pin setter',
  'Week planner',
  'On the road',
  'Regular',
];

const BADGE_LABELS: Record<string, string> = {
  first_ride: 'First ride',
  five_rides: 'Five rides',
  ten_rides: 'Ten rides',
  reliable_host: 'Reliable host',
  circle_rider: 'Circle rider',
  safety_ready: 'Safety ready',
  city_explorer: 'City explorer',
  multi_office: 'Multi office',
};

export function journeyProgressPercent(done: number, total: number) {
  if (!total || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

export function CommuteJourney({
  quests,
  completedRides,
  cityOn,
  badges,
}: {
  quests: JourneyQuest[];
  completedRides: number;
  cityOn: boolean;
  badges: Array<{ badge_key: string }>;
}) {
  const done = quests.filter((q) => q.done).length;
  const total = quests.length || 1;
  const pct = journeyProgressPercent(done, total);
  const current = quests.find((q) => !q.done) || null;
  const levelIndex = Math.min(
    LEVELS.length - 1,
    Math.floor(done / 2) + (completedRides > 0 ? 1 : 0),
  );
  const xp = done * 40 + completedRides * 30;
  const allDone = done >= total;
  const [open, setOpen] = useState(!allDone && done < 3);

  return (
    <section
      className="relative overflow-hidden rounded-[22px] border border-[#A3C9A8]/40 bg-[#0D3327] p-3.5 text-white"
      data-testid="cleaner-city-journey"
    >
      <div
        className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full bg-[#A3C9A8]/20 blur-2xl"
        aria-hidden
      />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#A3C9A8]">
            <Sparkles size={11} aria-hidden />
            Level {levelIndex + 1} · {LEVELS[levelIndex]}
          </p>
          <p className="mt-1 text-sm font-semibold text-white/85">
            {allDone
              ? 'Setup complete - go ride'
              : current
                ? `Next: ${current.title}`
                : 'Keep going'}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p
            className="text-lg font-extrabold leading-none text-[#A3C9A8]"
            data-testid="cleaner-city-journey-pct"
          >
            {pct}%
          </p>
          <p className="mt-0.5 text-[10px] text-white/55">{xp} xp</p>
        </div>
      </div>

      <div className="relative mt-3 space-y-1.5">
        <div
          className="h-2.5 overflow-hidden rounded-full bg-white/10"
          data-testid="cleaner-city-journey-progress-track"
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#7BA88A] to-[#A3C9A8] transition-all duration-500"
            style={{ width: `${pct}%` }}
            data-testid="cleaner-city-journey-progress-fill"
          />
        </div>
        <p className="text-[11px] text-white/65">
          {done} of {total} steps
          {cityOn ? ' · city matching on' : ''}
          {completedRides > 0
            ? ` · ${completedRides} ride${completedRides === 1 ? '' : 's'} done`
            : ''}
        </p>
      </div>

      {current && !allDone ? (
        <Link
          to={current.href}
          className="relative mt-3 flex items-center justify-between gap-2 rounded-xl bg-[#A3C9A8] px-3 py-2.5 text-[#0D3327]"
          data-testid={`cleaner-city-quest-${current.id}`}
        >
          <span className="min-w-0">
            <span className="block text-sm font-extrabold">{current.title}</span>
            <span className="block truncate text-[11px] text-[#0D3327]/75">{current.detail}</span>
          </span>
          <span className="shrink-0 text-xs font-extrabold">Go</span>
        </Link>
      ) : null}

      <button
        type="button"
        className="relative mt-2.5 flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1 text-left"
        onClick={() => setOpen((v) => !v)}
        data-testid="cleaner-city-journey-toggle"
      >
        <span className="text-[11px] font-semibold text-white/70">
          {open ? 'Hide checklist' : 'See all steps'}
        </span>
        <ChevronDown
          size={14}
          className={cn('text-white/50 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {open ? (
        <ol className="relative mt-1 space-y-1" data-testid="cleaner-city-journey-list">
          {quests.map((quest, index) => {
            const active = current?.id === quest.id;
            return (
              <li key={quest.id}>
                <Link
                  to={quest.href}
                  className={cn(
                    'flex items-center gap-2.5 rounded-xl px-2.5 py-1.5',
                    active ? 'bg-[#A3C9A8]/20 text-white' : 'text-white/80',
                  )}
                  data-testid={
                    active ? undefined : `cleaner-city-quest-${quest.id}`
                  }
                >
                  <span
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold',
                      quest.done
                        ? 'bg-[#A3C9A8] text-[#0D3327]'
                        : active
                          ? 'bg-white/20 text-[#A3C9A8]'
                          : 'bg-white/10 text-white/60',
                    )}
                  >
                    {quest.done ? '✓' : index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                    {quest.title}
                  </span>
                  {quest.done ? (
                    <span className="text-[10px] text-[#A3C9A8]">Done</span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ol>
      ) : null}

      {badges.length > 0 ? (
        <div className="relative mt-2 flex flex-wrap gap-1.5" data-testid="cleaner-city-journey-badges">
          {badges.slice(0, 4).map((badge) => (
            <span
              key={badge.badge_key}
              className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/80"
            >
              {BADGE_LABELS[badge.badge_key] || badge.badge_key}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
