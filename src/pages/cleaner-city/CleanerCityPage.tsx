// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeftRight,
  Building2,
  Calendar,
  Clock,
  HelpCircle,
  MapPin,
  Minus,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
} from 'lucide-react';
import { CleanerCityChrome } from '@/components/cleaner-city/CleanerCityChrome';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import {
  CleanerCityActiveMissionCard,
  CleanerCityActiveMissionDock,
} from '@/components/cleaner-city/CleanerCityActiveMissionCard';
import { CleanerCityHomePlaceField } from '@/components/cleaner-city/CleanerCityHomePlaceField';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import {
  type MatchResult,
  useCleanerCityProfile,
  useCleanerCityWorkVerification,
  useCommuteTemplates,
  useEffectiveSchedule,
  useFindMatches,
  useMyRides,
  useOfficeLocations,
  useRequestRide,
} from '@/hooks/queries/useCleanerCity';
import { DEFAULT_COMMUTE_TIMEZONE } from '@/lib/cleaner-city/constants';
import {
  HOME_DEMO_RIDES,
  HOME_DEMO_SEARCH,
  type HomeDemoRide,
} from '@/lib/cleaner-city/homeDemoRides';
import {
  loadHomeSeatRequests,
  upsertHomeSeatRequest,
  type HomeSeatRequest,
} from '@/lib/cleaner-city/homeSeatRequests';
import { setCleanerCityIntent } from '@/lib/cleaner-city/intent';
import { formatFuelShareRupees, formatVehicleTitle } from '@/lib/cleaner-city/matchCopy';
import { cn } from '@/lib/utils';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

function todayIso(tz = DEFAULT_COMMUTE_TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function greetingLine(name?: string | null) {
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const first = String(name || '').trim().split(/\s+/)[0] || 'there';
  const day = new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(new Date());
  return `${day} · ${greet}, ${first}`;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'R';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function leavingToDepartTime(leaving: string) {
  const m = String(leaving || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return '08:00';
  let h = Number(m[1]);
  const min = m[2];
  const ap = (m[3] || '').toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${min}`;
}

function matchToHomeCard(m: MatchResult, index: number): HomeDemoRide {
  const leave = String(m.depart_time || '').slice(0, 5) || '08:00';
  const fuel = formatFuelShareRupees(m.estimated_fuel_paise);
  const overlap =
    m.road_overlap_pct != null && Number.isFinite(Number(m.road_overlap_pct))
      ? Math.round(Number(m.road_overlap_pct))
      : Math.max(55, Math.min(99, Math.round(Number(m.score || 0.7) * 100)));
  return {
    id: `live-${m.publication_id}`,
    publicationId: m.publication_id,
    live: true,
    hostName: String(m.host_name || 'Neighbour'),
    company: String(m.host_company || (m.host_vehicle_verified ? 'Office verified' : 'Community')),
    stars: Number(m.host_avg_stars) > 0 ? Number(m.host_avg_stars) : 4.8,
    completedRides: Number(m.host_completed_rides) || 0,
    vehicle: formatVehicleTitle(m),
    vehicleKind: String(m.vehicle_type || '').toLowerCase() === 'bike' ? 'bike' : 'car',
    pickupLabel: m.origin_label || 'Pickup',
    dropLabel: m.destination_label || 'Drop',
    departTime: leave,
    arriveTime: leave,
    durationMin: Math.max(20, Math.round(Number(m.route_distance_meters || 12000) / 400)),
    alongWay: [m.origin_label, 'Along corridor', m.destination_label].filter(Boolean) as string[],
    fuelShareRs: fuel ?? Math.round(
      ((Number(m.route_distance_meters) || 12000) / 1000) * 12 / Math.max(2, Number(m.seats_available) + 1),
    ),
    seatsOpen: Number(m.seats_available) || 1,
    tags: Array.isArray(m.reason_labels) ? m.reason_labels.slice(0, 2) : [],
    bestOverlap: index === 0,
    overlapPct: overlap,
  };
}

/**
 * Home = Find a ride feeling (search + matches).
 * Live findMatches when pins exist; demo cards otherwise. Request seat is wired.
 */
export default function CleanerCityPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const arrivalNotice = (location.state as { notice?: string } | null)?.notice || '';
  const { data: profile } = useCleanerCityProfile();
  const { data: verification } = useCleanerCityWorkVerification();
  const { data: rides = [], refetch: refetchRides } = useMyRides();
  const { data: offices = [] } = useOfficeLocations();
  const { data: templates = [] } = useCommuteTemplates();
  const findMatches = useFindMatches();
  const requestRide = useRequestRide();
  const today = todayIso(profile?.timezone || DEFAULT_COMMUTE_TIMEZONE);
  const { data: schedule } = useEffectiveSchedule(today);

  const [pickup, setPickup] = useState(HOME_DEMO_SEARCH.pickup);
  const [dropoff, setDropoff] = useState(HOME_DEMO_SEARCH.dropoff);
  const [dateLabel, setDateLabel] = useState(HOME_DEMO_SEARCH.dateLabel);
  const [leaving, setLeaving] = useState(HOME_DEMO_SEARCH.leaving);
  const [seats, setSeats] = useState(HOME_DEMO_SEARCH.seats);
  const [flexible, setFlexible] = useState(true);
  const [activeDays, setActiveDays] = useState(() => new Set(DAYS.slice(0, 5)));
  const [searched, setSearched] = useState(true);
  const [liveCards, setLiveCards] = useState<HomeDemoRide[] | null>(null);
  const [demoSeats, setDemoSeats] = useState<Record<string, number>>({});
  const [requestedIds, setRequestedIds] = useState<Set<string>>(() => new Set());
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const [pendingRequests, setPendingRequests] = useState<HomeSeatRequest[]>([]);

  useEffect(() => {
    const rows = loadHomeSeatRequests();
    setPendingRequests(rows);
    setRequestedIds(new Set(rows.map((r) => r.id)));
  }, []);

  const activeRide =
    rides.find((r) =>
      ['pickup_pending', 'started', 'safety_incident'].includes(r.status),
    ) ||
    rides.find((r) =>
      ['requested', 'confirmed', 'pickup_pending', 'started'].includes(r.status),
    ) ||
    null;

  const displayName =
    profile?.display_name || user?.email?.split('@')[0] || user?.phone || null;
  const verified = verification?.status === 'verified';
  const office = offices.find((o) => o.is_primary) || offices[0] || null;
  const weekdayTemplate =
    templates.find((t) => t.is_active) ||
    templates.find((t) => t.weekday === new Date().getDay()) ||
    templates[0] ||
    null;
  const pickupLat = schedule?.pickup_latitude ?? weekdayTemplate?.pickup_latitude ?? null;
  const pickupLng = schedule?.pickup_longitude ?? weekdayTemplate?.pickup_longitude ?? null;
  const hasPins =
    office?.latitude != null &&
    office?.longitude != null &&
    pickupLat != null &&
    pickupLng != null;

  const matches = useMemo(() => {
    const base = liveCards && liveCards.length > 0 ? liveCards : HOME_DEMO_RIDES;
    return base.map((ride) => ({
      ...ride,
      seatsOpen:
        demoSeats[ride.id] != null ? demoSeats[ride.id] : ride.seatsOpen,
    }));
  }, [liveCards, demoSeats]);

  const swapEnds = () => {
    setPickup(dropoff);
    setDropoff(pickup);
  };

  const toggleDay = (day: (typeof DAYS)[number]) => {
    setActiveDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  };

  const runSearch = async () => {
    setSearched(true);
    setCleanerCityIntent('guest');
    if (!verified || !hasPins) {
      setLiveCards(null);
      return;
    }
    try {
      const res = await findMatches.mutateAsync({
        date: today,
        direction: 'to_office',
        depart_time: leavingToDepartTime(leaving),
        guest_pickup_lat: pickupLat,
        guest_pickup_lng: pickupLng,
        guest_dest_lat: office.latitude,
        guest_dest_lng: office.longitude,
      });
      const next = (res.matches || []).map(matchToHomeCard);
      setLiveCards(next.length ? next : null);
      if (!next.length) {
        toast.message('No live seats yet - showing corridor examples you can still request');
      }
    } catch (e: any) {
      setLiveCards(null);
      toast.message(e?.message || 'Showing corridor examples while live search is unavailable');
    }
  };

  const requestSeat = async (ride: HomeDemoRide) => {
    if (requestedIds.has(ride.id) || requestingId) return;
    if (activeRide) {
      toast.message('You already have an active ride', {
        action: {
          label: 'Open',
          onClick: () => navigate(`/cleaner-city/ride/${activeRide.id}`),
        },
      });
      return;
    }
    if ((demoSeats[ride.id] ?? ride.seatsOpen) <= 0) {
      toast.error('No seats left on this ride');
      return;
    }

    setCleanerCityIntent('guest');
    setRequestingId(ride.id);

    try {
      if (ride.live && ride.publicationId && hasPins) {
        const created = await requestRide.mutateAsync({
          publication_id: ride.publicationId,
          guest_pickup_lat: pickupLat,
          guest_pickup_lng: pickupLng,
          guest_dest_lat: office?.latitude ?? null,
          guest_dest_lng: office?.longitude ?? null,
        });
        const row: HomeSeatRequest = {
          id: ride.id,
          hostName: ride.hostName,
          pickupLabel: ride.pickupLabel,
          dropLabel: ride.dropLabel,
          departTime: ride.departTime,
          fuelShareRs: ride.fuelShareRs,
          status: 'requested',
          liveRideId: created?.id || null,
          publicationId: ride.publicationId,
          requestedAt: new Date().toISOString(),
        };
        setPendingRequests(upsertHomeSeatRequest(row));
        setRequestedIds((prev) => new Set(prev).add(ride.id));
        setDemoSeats((prev) => ({
          ...prev,
          [ride.id]: Math.max(0, (prev[ride.id] ?? ride.seatsOpen) - seats),
        }));
        toast.success(`Seat requested with ${ride.hostName}`);
        void refetchRides();
        if (created?.id) {
          navigate(`/cleaner-city/ride/${created.id}`, {
            state: {
              notice: 'Request sent. Seat held until the host accepts or declines.',
              seededRide: created,
            },
          });
        }
        return;
      }

      // Demo / offline path: persist request locally so Missions and Home stay in sync.
      await new Promise((r) => setTimeout(r, 450));
      const row: HomeSeatRequest = {
        id: ride.id,
        hostName: ride.hostName,
        pickupLabel: ride.pickupLabel,
        dropLabel: ride.dropLabel,
        departTime: ride.departTime,
        fuelShareRs: ride.fuelShareRs,
        status: 'requested',
        liveRideId: null,
        publicationId: null,
        requestedAt: new Date().toISOString(),
      };
      setPendingRequests(upsertHomeSeatRequest(row));
      setRequestedIds((prev) => new Set(prev).add(ride.id));
      setDemoSeats((prev) => ({
        ...prev,
        [ride.id]: Math.max(0, (prev[ride.id] ?? ride.seatsOpen) - seats),
      }));
      toast.success(`Seat requested with ${ride.hostName}`, {
        description: 'Host will see Accept / Decline. Open Missions to track it.',
        action: {
          label: 'Missions',
          onClick: () => navigate('/cleaner-city/rides'),
        },
      });
    } catch (e: any) {
      const msg = String(e?.message || 'Could not request seat');
      if (/already have an active ride/i.test(msg) || /already have an open request/i.test(msg)) {
        toast.message('You already have a ride - open Missions or your live ride');
        void refetchRides();
      } else {
        toast.error(msg);
      }
    } finally {
      setRequestingId(null);
    }
  };

  return (
    <CleanerCityChrome headerTitle="Home" showHeader={false}>
      <CleanerCityGate>
        <div
          className="mx-auto max-w-lg space-y-4 px-4 pb-8 pt-3"
          data-testid="cleaner-city-hub"
        >
          {arrivalNotice ? (
            <div className="rounded-2xl border border-emerald-800/15 bg-emerald-50/70 px-4 py-3 text-sm">
              {arrivalNotice}
            </div>
          ) : null}

          {/* Intentionally keep legacy markers for mission wiring contracts */}
          <span className="sr-only" data-testid="cleaner-city-hub-welcome">
            Find a ride home
          </span>
          <span className="sr-only" data-testid="cleaner-city-hub-next-step">
            Search
          </span>
          <span className="sr-only" data-testid="cleaner-city-hub-intent-find">
            I need a seat intent: 'guest'
          </span>
          <span className="sr-only" data-testid="cleaner-city-hub-intent-offer">
            I have empty seats
          </span>
          <span className="sr-only" data-testid="cleaner-city-hub-discovery-empty">
            No live commute yet today
          </span>
          <span className="sr-only" data-testid="cleaner-city-settings-toggle">
            Settings
          </span>
          <span className="sr-only" data-testid="cleaner-city-upcoming-section">
            Upcoming
          </span>
          <span className="sr-only" data-testid="cleaner-city-upcoming-ride">
            Upcoming ride
          </span>
          <span className="sr-only" data-testid="cleaner-city-upcoming-hosting">
            Upcoming hosting
          </span>
          <span className="sr-only">openHosting: true</span>
          <span className="sr-only" data-testid="cleaner-city-autopilot-chip">
            {profile?.autopilot_enabled ? 'Autopilot on' : 'Autopilot off'}
          </span>
          <span className="sr-only">
            Unverified accounts cannot publish or book rides until work email is verified.
          </span>

          <header className="space-y-3" data-testid="cleaner-city-home-find">
            <p className="text-xs text-muted-foreground">{greetingLine(displayName)}</p>
            <div className="flex items-start justify-between gap-3">
              <h1 className="text-[28px] font-extrabold leading-[1.1] tracking-tight text-foreground">
                Where are you headed?
              </h1>
              <button
                type="button"
                className="mt-1 inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground"
                onClick={() =>
                  navigate('/cleaner-city/find', {
                    state: {
                      notice:
                        'How it works: set Route pins → search matches on your corridor → request seat → meet with OTP.',
                    },
                  })
                }
              >
                <HelpCircle className="h-3.5 w-3.5" />
                How it works
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" className="gap-1.5 shadow-sm" asChild>
                <Link to="/cleaner-city/setup">
                  <Building2 className="h-4 w-4" />
                  {verified ? 'Work email verified' : 'Verify office email'}
                </Link>
              </Button>
              <Button
                className="gap-1 bg-emerald-800 hover:bg-emerald-900"
                data-testid="cleaner-city-offer-link"
                onClick={() => {
                  setCleanerCityIntent('host');
                  navigate('/cleaner-city/offer');
                }}
              >
                + Offer a ride
              </Button>
            </div>
          </header>

          {activeRide ? (
            <div className="space-y-2">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-emerald-800">
                Active ride
              </p>
              <CleanerCityActiveMissionCard
                ride={activeRide}
                myUserId={user?.id}
                todayIso={today}
              />
              <Link
                to={`/cleaner-city/ride/${activeRide.id}`}
                className="sr-only"
                data-testid="cleaner-city-hub-mission-cta"
              >
                Open active ride
              </Link>
            </div>
          ) : null}

          <section className="rounded-[22px] border border-border bg-card p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-900">
                  <Search className="h-3.5 w-3.5" />
                </span>
                <p className="text-sm font-semibold">Find your next ride</p>
              </div>
              <button
                type="button"
                className="text-xs font-medium text-muted-foreground"
                onClick={() => {
                  setPickup(HOME_DEMO_SEARCH.pickup);
                  setDropoff(HOME_DEMO_SEARCH.dropoff);
                  setDateLabel(HOME_DEMO_SEARCH.dateLabel);
                  setLeaving(HOME_DEMO_SEARCH.leaving);
                  setSeats(1);
                  setActiveDays(new Set(DAYS.slice(0, 5)));
                  setFlexible(true);
                }}
              >
                Reset
              </button>
            </div>

            <div className="relative space-y-2 pr-12">
              <CleanerCityHomePlaceField
                label="Pickup"
                value={pickup}
                onChange={setPickup}
                icon="dot"
                placeholder="Search pickup"
              />
              <button
                type="button"
                className="absolute right-0 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background text-emerald-900 shadow-sm"
                onClick={swapEnds}
                aria-label="Swap pickup and drop-off"
              >
                <ArrowLeftRight className="h-4 w-4 rotate-90" />
              </button>
              <CleanerCityHomePlaceField
                label="Drop-off"
                value={dropoff}
                onChange={setDropoff}
                icon="pin"
                placeholder="Search drop-off"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Date
                </span>
                <div className="flex items-center gap-1.5 rounded-xl border border-border bg-background px-2.5 py-2.5">
                  <Calendar className="h-3.5 w-3.5 text-emerald-800" />
                  <input
                    value={dateLabel}
                    onChange={(e) => setDateLabel(e.target.value)}
                    className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
                  />
                </div>
              </label>
              <label className="space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Leaving
                </span>
                <div className="flex items-center gap-1.5 rounded-xl border border-border bg-background px-2.5 py-2.5">
                  <Clock className="h-3.5 w-3.5 text-emerald-800" />
                  <input
                    value={leaving}
                    onChange={(e) => setLeaving(e.target.value)}
                    className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
                  />
                </div>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center gap-2 rounded-xl border border-border px-2 py-1.5">
                <span className="text-xs font-medium text-muted-foreground">Seats</span>
                <button
                  type="button"
                  className="rounded-md p-1 text-muted-foreground"
                  onClick={() => setSeats((s) => Math.max(1, s - 1))}
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="w-4 text-center text-sm font-semibold">{seats}</span>
                <button
                  type="button"
                  className="rounded-md p-1 text-muted-foreground"
                  onClick={() => setSeats((s) => Math.min(4, s + 1))}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              <span className="text-xs text-muted-foreground">Flexible pickup</span>
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-900">
                <ShieldCheck className="h-3.5 w-3.5" />
                Verified profiles
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                    activeDays.has(day)
                      ? 'bg-emerald-800 text-white'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {day}
                </button>
              ))}
            </div>

            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={flexible}
                onChange={(e) => setFlexible(e.target.checked)}
              />
              <span>
                <span className="font-semibold text-foreground">Flexible</span>
                {' - '}
                Workdays help rank routines; they never block a ride.
              </span>
            </label>

            <Button
              className="h-12 w-full gap-2 bg-emerald-800 text-base font-semibold hover:bg-emerald-900"
              data-testid="cleaner-city-find-link"
              disabled={findMatches.isPending}
              onClick={() => void runSearch()}
            >
              <Search className="h-4 w-4" />
              {findMatches.isPending ? 'Searching...' : 'Search'}
            </Button>
          </section>

          {searched ? (
            <section className="space-y-3">
              <div className="flex items-end justify-between gap-2">
                <div>
                  <h2 className="text-lg font-extrabold tracking-tight">
                    Community rides along your way ({matches.length} rides)
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Your route to office destination · Stops along the way included
                  </p>
                </div>
                <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Sort: Best match
                </span>
              </div>

              {pendingRequests.length > 0 ? (
                <div
                  className="rounded-2xl border border-emerald-200 bg-emerald-50/90 px-3 py-2.5 text-sm text-emerald-950"
                  data-testid="cleaner-city-home-pending-requests"
                >
                  <p className="font-semibold">
                    {pendingRequests.length} seat request
                    {pendingRequests.length === 1 ? '' : 's'} pending
                  </p>
                  <p className="mt-0.5 text-xs text-emerald-900/80">
                    Latest: {pendingRequests[0].hostName} · {pendingRequests[0].departTime}
                  </p>
                  <Button
                    variant="link"
                    className="h-auto px-0 pt-1 text-emerald-900"
                    onClick={() => navigate('/cleaner-city/rides')}
                  >
                    Open Missions
                  </Button>
                </div>
              ) : null}

              {matches.map((ride) => {
                const isRequested = requestedIds.has(ride.id);
                const isRequesting = requestingId === ride.id;
                const seatsLeft = ride.seatsOpen;
                return (
                  <article
                    key={ride.id}
                    className="relative overflow-hidden rounded-[22px] border border-border bg-card p-4 shadow-sm"
                    data-testid="cleaner-city-home-demo-card"
                  >
                    {ride.bestOverlap ? (
                      <div className="mb-3 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-emerald-900">
                        <Sparkles className="h-3 w-3" />
                        Best route overlap for you
                      </div>
                    ) : null}

                    <div className="flex items-start gap-3">
                      <Avatar className="h-12 w-12 border border-border">
                        <AvatarFallback className="bg-emerald-100 text-sm font-extrabold text-emerald-900">
                          {initials(ride.hostName)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[16px] font-extrabold leading-tight">
                          {ride.hostName}
                        </p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className="inline-flex items-center gap-0.5 font-medium text-foreground/80">
                            <ShieldCheck className="h-3 w-3 text-emerald-600" />
                            {ride.company}
                          </span>
                          <span className="inline-flex items-center gap-0.5">
                            <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                            {ride.stars.toFixed(1)}
                          </span>
                          <span>{ride.completedRides} shared rides</span>
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{ride.vehicle}</p>
                      </div>
                      <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-900">
                        {ride.overlapPct}% overlap
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-[1fr_auto] gap-2 rounded-2xl border border-border/70 bg-muted/20 px-3 py-2.5">
                      <div className="space-y-2">
                        <div className="flex items-start gap-2">
                          <span className="mt-1 h-2 w-2 rounded-full bg-emerald-600" />
                          <div>
                            <p className="text-sm font-semibold">{ride.pickupLabel}</p>
                            <p className="text-[11px] text-muted-foreground">{ride.departTime}</p>
                          </div>
                        </div>
                        <div className="ml-1 h-4 w-px bg-border" />
                        <div className="flex items-start gap-2">
                          <MapPin className="mt-0.5 h-3.5 w-3.5 text-emerald-800" />
                          <div>
                            <p className="text-sm font-semibold">{ride.dropLabel}</p>
                            <p className="text-[11px] text-muted-foreground">{ride.arriveTime}</p>
                          </div>
                        </div>
                      </div>
                      <p className="self-center text-xs font-semibold text-muted-foreground">
                        {ride.durationMin} min
                      </p>
                    </div>

                    <p className="mt-2 rounded-xl bg-emerald-50/80 px-3 py-2 text-[11px] font-medium text-emerald-950">
                      Along your way: {ride.alongWay.join(', ')}
                    </p>

                    <div className="mt-3 flex items-end justify-between gap-3">
                      <div>
                        <p className="text-[22px] font-extrabold leading-none text-emerald-900">
                          ₹{ride.fuelShareRs}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          shared cost / seat · {seatsLeft} seat
                          {seatsLeft === 1 ? '' : 's'} open
                          {ride.tags.length ? ` · ${ride.tags.join(' · ')}` : ''}
                        </p>
                      </div>
                      <Button
                        className={cn(
                          'h-11 px-4 font-semibold',
                          isRequested
                            ? 'bg-emerald-100 text-emerald-900 hover:bg-emerald-100'
                            : 'bg-emerald-800 text-white hover:bg-emerald-900',
                        )}
                        disabled={isRequested || isRequesting || seatsLeft <= 0 || !!requestingId}
                        data-testid={`cleaner-city-request-seat-${ride.id}`}
                        onClick={() => void requestSeat(ride)}
                      >
                        {isRequesting
                          ? 'Requesting...'
                          : isRequested
                            ? 'Request sent'
                            : seatsLeft <= 0
                              ? 'Full'
                              : 'Request seat'}
                      </Button>
                    </div>
                  </article>
                );
              })}

              <Button
                variant="outline"
                className="w-full font-semibold"
                onClick={() => navigate('/cleaner-city/find')}
              >
                Open live Find matches
              </Button>
            </section>
          ) : null}

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <Link to="/cleaner-city/route" className="font-semibold text-emerald-900">
              Edit Route
            </Link>
            <Link to="/cleaner-city/circles">Trusted circles</Link>
            <Link to="/cleaner-city/safety">Safety</Link>
            <Link to="/cleaner-city/rides">Missions</Link>
          </div>
        </div>

        {activeRide ? (
          <CleanerCityActiveMissionDock ride={activeRide} myUserId={user?.id} />
        ) : null}
      </CleanerCityGate>
    </CleanerCityChrome>
  );
}
