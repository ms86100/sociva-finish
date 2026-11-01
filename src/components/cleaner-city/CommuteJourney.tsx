import { Link } from 'react-router-dom';
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
  const current = quests.find((q) => !q.done) || null;
  const levelIndex = Math.min(LEVELS.length - 1, Math.floor(done / 2) + (completedRides > 0 ? 1 : 0));
  const xp = done * 40 + completedRides * 30;
  const intoLevel = xp % 100;

  return (
    <section
      className="rounded-[24px] border border-[#A3C9A8]/40 bg-[#0D3327] p-4 text-white"
      data-testid="cleaner-city-journey"
    >
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#A3C9A8]">
            Level {levelIndex + 1}
          </p>
          <h2 className="text-lg font-extrabold">{LEVELS[levelIndex]}</h2>
        </div>
        <p className="text-xs text-white/70">{xp} xp</p>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-[#A3C9A8]" style={{ width: `${intoLevel}%` }} />
      </div>
      <p className="mt-2 text-xs text-white/75">
        {done} of {quests.length} steps done
        {completedRides > 0 ? ` · ${completedRides} finished ride${completedRides === 1 ? '' : 's'}` : ''}
        {cityOn ? ' · city marketplace on' : ''}
      </p>

      <ol className="mt-4 space-y-2">
        {quests.map((quest, index) => {
          const active = current?.id === quest.id;
          return (
            <li key={quest.id}>
              <Link
                to={quest.href}
                className={cn(
                  'flex items-center gap-3 rounded-2xl px-3 py-2',
                  active ? 'bg-[#A3C9A8] text-[#0D3327]' : 'bg-white/5 text-white',
                )}
                data-testid={`cleaner-city-quest-${quest.id}`}
              >
                <span
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-extrabold',
                    quest.done
                      ? 'bg-[#0D3327] text-[#A3C9A8]'
                      : active
                        ? 'bg-[#0D3327] text-white'
                        : 'bg-white/10 text-white/80',
                  )}
                >
                  {quest.done ? '✓' : index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{quest.title}</span>
                  <span className={cn('block text-[11px]', active ? 'text-[#0D3327]/80' : 'text-white/60')}>
                    {quest.done ? 'Done' : quest.detail}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>

      {badges.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2" data-testid="cleaner-city-journey-badges">
          {badges.map((badge) => (
            <span key={badge.badge_key} className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-semibold">
              {({
                first_ride: 'First ride',
                five_rides: 'Five rides',
                ten_rides: 'Ten rides',
                reliable_host: 'Reliable host',
                circle_rider: 'Circle rider',
                safety_ready: 'Safety ready',
                city_explorer: 'City explorer',
                multi_office: 'Multi office',
              })[badge.badge_key] || badge.badge_key}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
