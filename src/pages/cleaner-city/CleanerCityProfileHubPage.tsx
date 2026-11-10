// @ts-nocheck
import { Link } from 'react-router-dom';
import {
  Building2,
  CalendarClock,
  Car,
  ChevronRight,
  MapPinned,
  MessageCircle,
  Shield,
  ShieldCheck,
  UserRound,
  Users,
} from 'lucide-react';
import { CleanerCityChrome } from '@/components/cleaner-city/CleanerCityChrome';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import { cc } from '@/components/cleaner-city/ui/ccTheme';
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

function initials(name?: string | null) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export default function CleanerCityProfileHubPage() {
  const { user, profile: authProfile, society } = useAuth();
  const { data: profile } = useCleanerCityProfile();
  const { data: verification } = useCleanerCityWorkVerification();
  const { data: offices = [] } = useOfficeLocations();
  const { data: templates = [] } = useCommuteTemplates();
  const { data: vehicles = [] } = useCleanerCityVehicles();
  const { data: contacts = [] } = useEmergencyContacts();

  const office = offices.find((o) => o.is_primary) || offices[0];
  const homePin = templates.find(
    (t) =>
      typeof t.pickup_latitude === 'number' &&
      Number.isFinite(t.pickup_latitude) &&
      typeof t.pickup_longitude === 'number' &&
      Number.isFinite(t.pickup_longitude),
  );
  const tmpl = templates.find((t) => t.is_working) || templates[0];
  const verified = verification?.status === 'verified';
  const vehicle = vehicles[0];
  const vehicleLabel = vehicle
    ? [vehicle.color, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle'
    : 'Add vehicle';
  const contact = contacts.find((c) => c.is_primary) || contacts[0];
  const leave = String(tmpl?.depart_time || '08:30').slice(0, 5);
  const displayName =
    authProfile?.name || user?.email?.split('@')[0] || 'Your commute';
  // Real Sociva society membership - never fall back to office pin label.
  const societyLabel =
    society?.name ||
    authProfile?.society_name ||
    'Your society';
  const homeLabel = homePin?.pickup_label || 'Set home pin';
  const officeLabel = office?.label || office?.address_text || 'Set office pin';
  const workEmail =
    verification?.work_email || verification?.email || user?.email || 'Add work email';

  const rows = [
    {
      to: '/cleaner-city/setup',
      icon: Building2,
      label: 'Work email',
      value: workEmail,
      trailing: verified ? 'Verified' : 'Verify',
    },
    {
      to: '/cleaner-city/route',
      icon: MapPinned,
      label: 'Home',
      value: homeLabel,
      state: { initialStep: 'home' },
    },
    {
      to: '/cleaner-city/route',
      icon: MapPinned,
      label: 'Office',
      value: officeLabel,
      state: { initialStep: 'office' },
    },
    {
      to: '/cleaner-city/safety',
      icon: Shield,
      label: 'Emergency contact',
      value: contact
        ? `${contact.contact_name}${contact.phone ? ` · ${contact.phone}` : ''}`
        : 'Add contact',
    },
    {
      to: '/cleaner-city/vehicle',
      icon: Car,
      label: 'Vehicle',
      value: vehicleLabel,
    },
    {
      to: '/cleaner-city/schedule',
      icon: CalendarClock,
      label: 'Regular commute',
      value: 'Home → Office',
      trailing: leave,
      state: { from: '/cleaner-city/profile' },
    },
    {
      to: '/cleaner-city/safety',
      icon: ShieldCheck,
      label: 'Safety settings',
      value: 'SOS, blocks, and contacts',
    },
    {
      to: '/cleaner-city/circles',
      icon: Users,
      label: 'Trusted circles',
      value: 'Invite codes and privacy',
    },
    {
      to: '/cleaner-city/chat',
      icon: MessageCircle,
      label: 'Messages',
      value: 'Ride and circle chats',
    },
    {
      to: '/profile',
      icon: UserRound,
      label: 'Account',
      value: 'Sociva account settings',
    },
  ];

  return (
    <CleanerCityChrome headerTitle="Profile" className={cc.bg}>
      <CleanerCityGate>
        <div className={cc.page}>
          <header className="text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0F3D2E]">
              Sociva · Cleaner City
            </p>
          </header>

          <section className={cn(cc.card, 'flex flex-col items-center px-4 py-5 text-center')}>
            <div className="relative">
              <Avatar className="h-20 w-20 border border-black/5">
                {authProfile?.avatar_url ? (
                  <AvatarImage src={authProfile.avatar_url} alt="" className="object-cover" />
                ) : null}
                <AvatarFallback className="bg-[#E8F2EC] text-lg font-semibold text-[#0F3D2E]">
                  {initials(displayName)}
                </AvatarFallback>
              </Avatar>
              {verified ? (
                <span className="absolute bottom-0 right-0 flex h-6 w-6 items-center justify-center rounded-full bg-[#0F3D2E] text-white">
                  <ShieldCheck className="h-3.5 w-3.5" />
                </span>
              ) : null}
            </div>
            <p className="mt-3 text-[18px] font-semibold text-[#0F3D2E]">{displayName}</p>
            {verified ? (
              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-[#E8F2EC] px-2.5 py-0.5 text-[11px] font-semibold text-[#0F3D2E]">
                Verified
              </span>
            ) : null}
            <p className="mt-2 rounded-full bg-[#F7F5F1] px-3 py-1 text-[12px] text-muted-foreground">
              {workEmail}
            </p>
            <p className="mt-2 flex items-center gap-1 text-[12px] text-muted-foreground">
              <MapPinned className="h-3.5 w-3.5" />
              Society {societyLabel}
            </p>
          </section>

          <section className={cn(cc.card, 'overflow-hidden')}>
            {rows.map((row, idx) => {
              const Icon = row.icon;
              return (
                <Link
                  key={`${row.label}-${row.to}`}
                  to={row.to}
                  state={row.state}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3.5 active:bg-black/[0.02]',
                    idx > 0 && 'border-t border-black/5',
                  )}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#E8F2EC] text-[#0F3D2E]">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold">{row.label}</p>
                    <p className="truncate text-[12px] text-muted-foreground">{row.value}</p>
                  </div>
                  {row.trailing ? (
                    <span className="text-[12px] font-semibold text-[#0F3D2E]">{row.trailing}</span>
                  ) : null}
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              );
            })}
          </section>

          {(preferredRouteFromProfile(profile, 'to_office') ||
            preferredRouteFromProfile(profile, 'to_home')) && (
            <p className="px-1 text-center text-[11px] text-muted-foreground">
              Route roads are set. Edit anytime from Home, Office, or Regular commute.
            </p>
          )}
        </div>
      </CleanerCityGate>
    </CleanerCityChrome>
  );
}
