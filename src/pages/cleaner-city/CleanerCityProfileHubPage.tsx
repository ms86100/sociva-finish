// @ts-nocheck
import { Link } from 'react-router-dom';
import {
  Building2,
  CalendarClock,
  Car,
  MessageCircle,
  Shield,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { CleanerCityChrome } from '@/components/cleaner-city/CleanerCityChrome';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import {
  preferredRouteFromProfile,
  useCleanerCityProfile,
  useCleanerCityVehicles,
  useCleanerCityWorkVerification,
  useCommuteTemplates,
  useEmergencyContacts,
  useOfficeLocations,
} from '@/hooks/queries/useCleanerCity';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

const TRUST = [
  { to: '/cleaner-city/setup', label: 'Work email & setup', blurb: 'Verify domain and finish basics', icon: Building2 },
  { to: '/cleaner-city/safety', label: 'Safety & contacts', blurb: 'Optional emergency contacts for SOS', icon: Shield },
  { to: '/cleaner-city/circles', label: 'Trusted circles', blurb: 'Invite codes and privacy', icon: Users },
];

const GEAR = [
  { to: '/cleaner-city/schedule', label: 'Schedule & Autopilot', blurb: 'Leave times, pause, drafts', icon: CalendarClock },
  { to: '/cleaner-city/vehicle', label: 'Vehicle & documents', blurb: 'Required before publishing seats', icon: Car },
];

const COMMS = [
  { to: '/cleaner-city/chat', label: 'Commute chat', blurb: 'Messages for your rides', icon: MessageCircle },
];

function LoadoutGroup({
  title,
  items,
}: {
  title: string;
  items: typeof TRUST;
}) {
  return (
    <section className="space-y-2">
      <p className="px-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-800/80">
        {title}
      </p>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            className="flex items-start gap-3 rounded-2xl border border-border/70 bg-card p-4 shadow-sm"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-900">
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold">{item.label}</p>
              <p className="text-sm text-muted-foreground">{item.blurb}</p>
            </div>
          </Link>
        );
      })}
    </section>
  );
}

export default function CleanerCityProfileHubPage() {
  const { user } = useAuth();
  const { data: profile } = useCleanerCityProfile();
  const { data: verification } = useCleanerCityWorkVerification();
  const { data: offices = [] } = useOfficeLocations();
  const { data: templates = [] } = useCommuteTemplates();
  const { data: vehicles = [] } = useCleanerCityVehicles();
  const { data: contacts = [] } = useEmergencyContacts();

  const office = offices[0];
  const tmpl = templates.find((t) => t.is_active) || templates[0];
  const hasPins = !!(
    office &&
    typeof office.latitude === 'number' &&
    tmpl &&
    typeof tmpl.pickup_latitude === 'number'
  );
  const hasRoads = !!(
    preferredRouteFromProfile(profile, 'to_office') &&
    preferredRouteFromProfile(profile, 'to_home')
  );
  const verified = verification?.status === 'verified';
  const corridorLabel = hasPins && hasRoads
    ? 'Corridor unlocked'
    : hasPins
      ? 'Pins set · roads open'
      : 'Corridor locked';

  return (
    <CleanerCityChrome headerTitle="You">
      <CleanerCityGate>
        <div className="mx-auto max-w-lg space-y-4 px-4 pb-6 pt-3">
          <div className="rounded-3xl border border-emerald-900/10 bg-gradient-to-br from-emerald-950 via-emerald-900 to-teal-900 p-5 text-white shadow-md">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-emerald-100/80">
              Your loadout
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              {profile?.display_name || user?.email?.split('@')[0] || 'Your commute'}
            </h1>
            <p className="mt-1 text-sm text-emerald-50/90">
              Trust, gear, and safety. Route stays on its own tab.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {verified ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Work email verified
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/20 px-3 py-1 text-xs font-semibold text-amber-50">
                  Verify work email
                </span>
              )}
              {vehicles.length > 0 ? (
                <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
                  {vehicles.length} vehicle{vehicles.length === 1 ? '' : 's'}
                </span>
              ) : null}
            </div>
          </div>

          <Link
            to="/cleaner-city/route"
            className={cn(
              'flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold shadow-sm',
              hasPins && hasRoads
                ? 'border-emerald-800/20 bg-emerald-50/70 text-emerald-950'
                : 'border-amber-500/25 bg-amber-50/70 text-amber-950',
            )}
          >
            <span>{corridorLabel}</span>
            <span className="text-xs font-semibold opacity-70">Open Route tab →</span>
          </Link>

          {verified ? (
            <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-900">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold">Your profile is verified</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Hosts see your trusted member badge when you request a seat.
                  {contacts.length ? ` · ${contacts.length} emergency contact(s)` : ''}
                </p>
              </div>
            </div>
          ) : null}

          <LoadoutGroup title="Trust" items={TRUST} />
          <LoadoutGroup title="Gear" items={GEAR} />
          <LoadoutGroup title="Comms" items={COMMS} />
        </div>
      </CleanerCityGate>
    </CleanerCityChrome>
  );
}
