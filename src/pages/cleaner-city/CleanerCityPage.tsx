// @ts-nocheck
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import { CalendarClock, Car, Leaf, ShieldCheck, Users } from 'lucide-react';
import {
  useCleanerCityProfile,
  useCleanerCityWorkVerification,
  useEffectiveSchedule,
} from '@/hooks/queries/useCleanerCity';
import { DEFAULT_COMMUTE_TIMEZONE, WORK_EMAIL_BADGE } from '@/lib/cleaner-city/constants';
import { cn } from '@/lib/utils';

function todayIso(tz = DEFAULT_COMMUTE_TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export default function CleanerCityPage() {
  const { data: profile } = useCleanerCityProfile();
  const { data: verification } = useCleanerCityWorkVerification();
  const today = todayIso(profile?.timezone || DEFAULT_COMMUTE_TIMEZONE);
  const { data: todaySchedule } = useEffectiveSchedule(profile ? today : null);
  const ready = !!profile && verification?.status === 'verified' && !profile.is_paused;

  return (
    <AppLayout headerTitle="A Cleaner City">
      <CleanerCityGate>
        <div className="p-4 pb-24 space-y-4" data-testid="cleaner-city-hub">
          <div className="overflow-hidden rounded-[26px] border border-white/10 bg-[#0D3327] px-4 py-5 text-white">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-extrabold tracking-tight">sociva</p>
                <h1 className="mt-1 text-[24px] font-extrabold leading-tight text-[#A3C9A8]">
                  A Cleaner City
                </h1>
                <p className="mt-2 text-[11px] font-extrabold uppercase tracking-[0.16em] text-white/80">
                  Commute together. Save more. Breathe better.
                </p>
              </div>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10">
                <Leaf size={18} className="text-[#A3C9A8]" aria-hidden />
              </span>
            </div>
          </div>

          <Link
            to="/cleaner-city/setup"
            className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-card"
            data-testid="cleaner-city-setup-link"
          >
            <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <ShieldCheck className="text-primary" size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm text-foreground">
                {profile ? 'Edit my commute' : 'Set up my commute'}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {verification?.status === 'verified'
                  ? WORK_EMAIL_BADGE
                  : 'Profile + official work email verification'}
              </p>
            </div>
          </Link>

          {profile && (
            <Link
              to="/cleaner-city/schedule"
              className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-card"
              data-testid="cleaner-city-schedule-link"
            >
              <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <CalendarClock className="text-primary" size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm text-foreground">My commute schedule</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {todaySchedule?.is_paused
                    ? 'Paused'
                    : todaySchedule?.is_working
                      ? `Today ${String(todaySchedule.depart_time || '').slice(0, 5) || '-'} (${todaySchedule.source})`
                      : 'Today off / not set - edit anytime'}
                </p>
              </div>
            </Link>
          )}

          {profile && (
            <div className="grid grid-cols-2 gap-3">
              <Link
                to="/cleaner-city/vehicle"
                className="rounded-2xl border border-border bg-card p-4"
                data-testid="cleaner-city-vehicle-link"
              >
                <Car size={18} className="text-primary mb-2" aria-hidden />
                <p className="text-sm font-semibold text-foreground">My vehicle</p>
                <p className="text-xs text-muted-foreground mt-1">Car or bike + seats</p>
              </Link>
              <Link
                to="/cleaner-city/route"
                className="rounded-2xl border border-border bg-card p-4"
                data-testid="cleaner-city-route-link"
              >
                <Users size={18} className="text-primary mb-2" aria-hidden />
                <p className="text-sm font-semibold text-foreground">Office & pickup</p>
                <p className="text-xs text-muted-foreground mt-1">Map pins for matching</p>
              </Link>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Link
              to={ready ? '/cleaner-city/offer' : '/cleaner-city/setup'}
              className={cn(
                'rounded-2xl border border-border bg-card p-4',
                !ready && 'opacity-80',
              )}
              data-testid="cleaner-city-offer-link"
            >
              <Car size={18} className="text-primary mb-2" aria-hidden />
              <p className="text-sm font-semibold text-foreground">Offer a ride</p>
              <p className="text-xs text-muted-foreground mt-1">I have an empty seat</p>
              <p className="text-[10px] text-muted-foreground mt-3">
                {ready ? 'Publish seats for a date' : 'Verify work email first'}
              </p>
            </Link>
            <Link
              to={ready ? '/cleaner-city/find' : '/cleaner-city/setup'}
              className={cn(
                'rounded-2xl border border-border bg-card p-4',
                !ready && 'opacity-80',
              )}
              data-testid="cleaner-city-find-link"
            >
              <Users size={18} className="text-primary mb-2" aria-hidden />
              <p className="text-sm font-semibold text-foreground">Find a ride</p>
              <p className="text-xs text-muted-foreground mt-1">I need a commute</p>
              <p className="text-[10px] text-muted-foreground mt-3">
                {ready ? 'Match by route overlap' : 'Verify work email first'}
              </p>
            </Link>
          </div>

          {!ready && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
              <p className="text-sm font-semibold">Participation gate</p>
              <p className="text-xs mt-1">
                Unverified accounts cannot publish or book rides. Complete set up and work email OTP
                first.
              </p>
            </div>
          )}
        </div>
      </CleanerCityGate>
    </AppLayout>
  );
}
