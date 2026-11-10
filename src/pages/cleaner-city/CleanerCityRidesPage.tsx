// @ts-nocheck
import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Calendar,
  Car,
  Check,
  Clock,
  Users,
} from 'lucide-react';
import { CleanerCityChrome } from '@/components/cleaner-city/CleanerCityChrome';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import {
  CleanerCityActiveMissionCard,
  CleanerCityActiveMissionDock,
} from '@/components/cleaner-city/CleanerCityActiveMissionCard';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useMyPublications, useMyRides } from '@/hooks/queries/useCleanerCity';
import { DEFAULT_COMMUTE_TIMEZONE } from '@/lib/cleaner-city/constants';
import { cc } from '@/components/cleaner-city/ui/ccTheme';
import { firstName, formatDepartTime, rideStatusLabel } from '@/lib/cleaner-city/rideMissionCopy';
import { cn } from '@/lib/utils';

const LIVE = ['pickup_pending', 'started', 'safety_incident'];
const UPCOMING = ['requested', 'confirmed', 'pickup_pending', 'started', 'safety_incident'];
const HISTORY = ['completed', 'cancelled', 'rejected', 'no_show', 'disputed'];

type Filter = 'upcoming' | 'pending' | 'confirmed' | 'hosting' | 'active' | 'history';

function todayIso(tz = DEFAULT_COMMUTE_TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function directionLabel(direction: string | null | undefined) {
  if (direction === 'to_home') return 'Office to home';
  if (direction === 'to_office') return 'Home to office';
  return 'Commute';
}

function rideTag(status: string, hosting: boolean) {
  if (hosting && status === 'requested') return { label: 'Hosting', tone: 'host' as const };
  if (status === 'requested') return { label: 'Pending', tone: 'pending' as const };
  if (status === 'confirmed') return { label: 'Upcoming', tone: 'up' as const };
  if (LIVE.includes(status)) return { label: 'Active', tone: 'up' as const };
  if (hosting) return { label: 'Hosting', tone: 'host' as const };
  return { label: rideStatusLabel(status), tone: 'up' as const };
}

export default function CleanerCityRidesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const arrival = (location.state as { notice?: string; focusHosting?: boolean } | null) || {};
  const { data: rides = [] } = useMyRides();
  const { data: publications = [] } = useMyPublications();
  const today = todayIso();
  const [filter, setFilter] = useState<Filter>(
    arrival.focusHosting ? 'hosting' : 'upcoming',
  );

  const active =
    rides.find((r) => LIVE.includes(r.status) && r.travel_date === today) ||
    rides.find((r) => LIVE.includes(r.status));

  const pending = rides.filter(
    (r) =>
      r.status === 'requested' &&
      (r.guest_user_id === user?.id || r.host_user_id === user?.id),
  );
  const confirmed = rides.filter((r) => r.status === 'confirmed');
  const upcoming = rides.filter(
    (r) => UPCOMING.includes(r.status) && r.id !== active?.id,
  );
  const hosting = rides.filter(
    (r) =>
      r.host_user_id === user?.id &&
      ['requested', 'confirmed', 'pickup_pending', 'started', 'safety_incident'].includes(
        r.status,
      ),
  );
  const history = rides.filter((r) => HISTORY.includes(r.status)).slice(0, 12);
  const livePubs = publications.filter((p) => ['published', 'full'].includes(p.status));

  const filters: { id: Filter; label: string }[] = [
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'pending', label: 'Pending' },
    { id: 'confirmed', label: 'Confirmed' },
    { id: 'hosting', label: 'Hosting' },
    { id: 'active', label: 'Active' },
    { id: 'history', label: 'History' },
  ];

  const list = useMemo(() => {
    if (filter === 'pending') return pending;
    if (filter === 'confirmed') return confirmed;
    if (filter === 'hosting') return hosting;
    if (filter === 'active') return active ? [active] : [];
    if (filter === 'history') return history;
    return upcoming;
  }, [filter, pending, confirmed, hosting, active, history, upcoming]);

  const hasAnyContent =
    !!active || pending.length > 0 || upcoming.length > 0 || livePubs.length > 0 || history.length > 0;

  return (
    <CleanerCityChrome headerTitle="My rides" className={cc.bg}>
      <CleanerCityGate>
        <div className={cn(cc.page, 'space-y-4')}>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0F3D2E]">
              Sociva · Cleaner City
            </p>
            <h1 className="mt-1 text-[22px] font-semibold tracking-tight uppercase">My rides</h1>
          </div>

          {arrival.notice ? (
            <div className="rounded-2xl border border-emerald-800/20 bg-emerald-50/80 px-4 py-3 text-sm">
              {arrival.notice}
            </div>
          ) : null}

          {active ? (
            <CleanerCityActiveMissionCard
              ride={active}
              myUserId={user?.id}
              todayIso={today}
            />
          ) : null}

          <div className="flex gap-1.5 overflow-x-auto pb-1" data-testid="cleaner-city-rides-filters">
            {filters.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={cn(
                  'shrink-0 transition',
                  filter === f.id ? cc.pillActive : cc.pillIdle,
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          {filter === 'hosting' && livePubs.length > 0 ? (
            <section className="space-y-2" data-testid="cleaner-city-trips-live-offers">
              <h2 className="text-sm font-semibold">Open seats you offered</h2>
              {livePubs.slice(0, 8).map((p) => (
                <Link
                  key={p.id}
                  to="/cleaner-city/offer"
                  state={{ focusPublicationId: p.id, tab: 'rides' }}
                  className={cn(cc.card, 'block p-4')}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#0F3D2E]">
                    Hosting
                  </p>
                  <p className="mt-1 text-sm font-semibold">
                    {p.seats_available ?? p.seats_total} seats published
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {p.travel_date} · {directionLabel(p.direction)}
                  </p>
                </Link>
              ))}
            </section>
          ) : null}

          {list.length > 0 ? (
            <section className="space-y-3">
              {list.map((r) => {
                const isHost = user?.id === r.host_user_id;
                const tag = rideTag(r.status, isHost);
                const partner = isHost ? r.guest_name : r.host_name;
                const leave = formatDepartTime(r.depart_time);
                const when =
                  r.travel_date === today
                    ? 'Today'
                    : r.travel_date
                      ? 'Tomorrow'
                      : '';
                return (
                  <button
                    key={r.id}
                    type="button"
                    className={cn(cc.card, 'w-full p-4 text-left active:scale-[0.99]')}
                    onClick={() => {
                      navigate(`/cleaner-city/ride/${r.id}`);
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p
                        className={cn(
                          'inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.12em]',
                          tag.tone === 'pending' ? 'text-amber-800' : 'text-[#0F3D2E]',
                        )}
                      >
                        {tag.tone === 'pending' ? (
                          <Clock className="h-3.5 w-3.5" />
                        ) : tag.tone === 'host' ? (
                          <Users className="h-3.5 w-3.5" />
                        ) : (
                          <Calendar className="h-3.5 w-3.5" />
                        )}
                        {tag.label}
                      </p>
                      <p className="text-[12px] text-muted-foreground">{when}</p>
                    </div>
                    <div className="mt-3 flex items-start gap-3">
                      <div
                        className={cn(
                          'flex h-11 w-11 shrink-0 items-center justify-center rounded-full',
                          tag.tone === 'pending' ? 'bg-amber-50 text-amber-800' : 'bg-[#E8F2EC] text-[#0F3D2E]',
                        )}
                      >
                        {tag.tone === 'pending' ? (
                          <Users className="h-5 w-5" />
                        ) : (
                          <Car className="h-5 w-5" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-semibold">
                          {isHost && r.status === 'requested'
                            ? 'Request waiting'
                            : isHost
                              ? `${r.seats_total || 2} seats published`
                              : `Ride with ${firstName(partner)}`}
                        </p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#0F3D2E]" />
                          {isHost && r.status === 'requested'
                            ? `${firstName(partner)} requested to join your ride.`
                            : `Leave ${leave || '--:--'}${r.destination_label ? ` · To ${r.destination_label}` : ''}`}
                        </p>
                      </div>
                      {r.status === 'confirmed' ? (
                        <div className="flex flex-col items-center gap-1 text-[#0F3D2E]">
                          <span className="text-[10px] font-semibold uppercase">Confirmed</span>
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#E8F2EC]">
                            <Check className="h-4 w-4" />
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </section>
          ) : null}

          {filter === 'history' && history.length === 0 ? (
            <p className="rounded-2xl border border-border/70 bg-muted/20 px-4 py-5 text-center text-[13px] text-muted-foreground">
              No completed rides yet.
            </p>
          ) : null}

          {!hasAnyContent ? (
            <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/20 px-4 py-5 text-center">
              <p className="text-[13px] text-muted-foreground">
                No trips yet. Find a seat or offer one from Home.
              </p>
              <div className="flex justify-center gap-2">
                <Button
                  className="rounded-xl bg-emerald-800 text-white hover:bg-emerald-900"
                  onClick={() => navigate('/cleaner-city/find')}
                >
                  Find a seat
                </Button>
                <Button
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => navigate('/cleaner-city/offer')}
                >
                  Offer a seat
                </Button>
              </div>
            </div>
          ) : null}
        </div>
        {active ? <CleanerCityActiveMissionDock ride={active} myUserId={user?.id} /> : null}
      </CleanerCityGate>
    </CleanerCityChrome>
  );
}
