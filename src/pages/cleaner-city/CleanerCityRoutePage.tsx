// @ts-nocheck
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { MapPinned, Route } from 'lucide-react';
import { CleanerCityChrome } from '@/components/cleaner-city/CleanerCityChrome';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import { CleanerCityRouteSetupPanel } from '@/components/cleaner-city/CleanerCityRouteSetupPanel';
import { Button } from '@/components/ui/button';
import {
  preferredRouteFromProfile,
  useCleanerCityProfile,
  useCommuteTemplates,
  useOfficeLocations,
} from '@/hooks/queries/useCleanerCity';
import { cn } from '@/lib/utils';

/**
 * First-class Route tab. Pins + preferred roads power Find and Offer matching.
 * Framed as corridor unlock for both host and guest.
 */
export default function CleanerCityRoutePage() {
  const { data: profile } = useCleanerCityProfile();
  const { data: offices = [] } = useOfficeLocations();
  const { data: templates = [] } = useCommuteTemplates();
  const navigate = useNavigate();
  const location = useLocation();
  const arrivalNotice = (location.state as { notice?: string } | null)?.notice || '';

  const office = offices[0];
  const tmpl = templates.find((t) => t.is_active) || templates[0];
  const hasPins = !!(
    office &&
    typeof office.latitude === 'number' &&
    tmpl &&
    typeof tmpl.pickup_latitude === 'number'
  );
  const hasToOffice = !!preferredRouteFromProfile(profile, 'to_office');
  const hasToHome = !!preferredRouteFromProfile(profile, 'to_home');
  const hasRoads = hasToOffice && hasToHome;
  const unlocked = hasPins && hasRoads;
  const guestReady = hasPins;

  if (!profile) {
    return (
      <CleanerCityChrome headerTitle="Route">
        <CleanerCityGate>
          <div className="p-4">
            <p className="text-sm text-muted-foreground">
              Complete{' '}
              <Link to="/cleaner-city/setup" className="font-semibold text-emerald-900">
                set up
              </Link>{' '}
              first.
            </p>
          </div>
        </CleanerCityGate>
      </CleanerCityChrome>
    );
  }

  return (
    <CleanerCityChrome headerTitle="Route">
      <CleanerCityGate>
        <div
          className="mx-auto flex w-full max-w-lg flex-col gap-5 px-4 pb-8 pt-3"
          data-testid="cleaner-city-route-page"
        >
          <div className="relative overflow-hidden rounded-3xl border border-emerald-900/10 bg-gradient-to-br from-emerald-950 via-emerald-900 to-teal-900 p-5 text-white shadow-md">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-40"
              style={{
                backgroundImage:
                  'radial-gradient(circle at 18% 20%, rgba(255,255,255,0.22), transparent 42%), radial-gradient(circle at 90% 0%, rgba(16,185,129,0.4), transparent 36%)',
              }}
            />
            <div className="relative">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-emerald-100/80">
                Corridor unlock
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                {unlocked ? 'Corridor unlocked' : 'Unlock your corridor'}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-emerald-50/90">
                Guests need pins. Hosts need pins plus the roads they drive. Matching only works on
                this corridor.
              </p>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {(
                  [
                    { label: 'Pins', done: hasPins, icon: MapPinned },
                    { label: 'Morning', done: hasToOffice, icon: Route },
                    { label: 'Evening', done: hasToHome, icon: Route },
                  ] as const
                ).map((step) => {
                  const Icon = step.icon;
                  return (
                    <div
                      key={step.label}
                      className={cn(
                        'rounded-2xl border px-2.5 py-2.5',
                        step.done
                          ? 'border-emerald-300/40 bg-white/15'
                          : 'border-white/10 bg-white/5',
                      )}
                    >
                      <Icon className="h-3.5 w-3.5 text-emerald-100/90" />
                      <p className="mt-1 text-[11px] font-semibold text-emerald-100/80">
                        {step.label}
                      </p>
                      <p className="text-xs font-semibold">
                        {step.done ? 'Done' : 'Open'}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {arrivalNotice ? (
            <div
              className="rounded-2xl border border-emerald-800/20 bg-emerald-50/60 px-4 py-3 text-sm leading-relaxed"
              data-testid="cleaner-city-route-guide"
            >
              {arrivalNotice}
            </div>
          ) : (
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Set pins, then roads</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Home gate first, then office, then pick the Google road you drive. Exact office stays owner-private.
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Pin a real pickup point on the map before saving. Guests and hosts both depend on this corridor.
              </p>
            </div>
          )}

          <CleanerCityRouteSetupPanel
            onSaved={() => {
              /* chips update via query invalidate */
            }}
          />

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              className="h-12 font-semibold"
              disabled={!guestReady}
              onClick={() =>
                navigate('/cleaner-city/find', {
                  state: {
                    notice: guestReady
                      ? 'Find uses your pins against hosts on overlapping roads.'
                      : 'Pin office and pickup first.',
                  },
                })
              }
            >
              {guestReady ? 'Unlock Find' : 'Need pins'}
            </Button>
            <Button
              className="h-12 bg-emerald-800 font-semibold hover:bg-emerald-900"
              disabled={!unlocked}
              onClick={() =>
                navigate('/cleaner-city/offer', {
                  state: {
                    notice: unlocked
                      ? 'Offer publishes empty seats on the roads you saved.'
                      : 'Save pins and both roads before Offer.',
                  },
                })
              }
            >
              {unlocked ? 'Unlock Offer' : 'Need roads'}
            </Button>
          </div>

          {unlocked ? (
            <Button
              className="h-11 w-full bg-white font-semibold text-emerald-950 border border-emerald-800/20"
              onClick={() => navigate('/cleaner-city/find')}
            >
              Corridor unlocked · Play
            </Button>
          ) : null}

          <Button
            variant="outline"
            className="h-11 w-full font-semibold"
            data-testid="cleaner-city-route-next"
            onClick={() =>
              navigate('/cleaner-city/schedule', {
                state: {
                  notice:
                    'Leave and return times change day to day. Your home gate and usual roads usually do not.',
                },
              })
            }
          >
            Next - weekly schedule
          </Button>
        </div>
      </CleanerCityGate>
    </CleanerCityChrome>
  );
}
