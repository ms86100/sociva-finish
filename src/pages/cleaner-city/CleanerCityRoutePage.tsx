// @ts-nocheck
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import { CleanerCityRouteSetupPanel } from '@/components/cleaner-city/CleanerCityRouteSetupPanel';
import { Button } from '@/components/ui/button';
import { useCleanerCityProfile } from '@/hooks/queries/useCleanerCity';

export default function CleanerCityRoutePage() {
  const { data: profile } = useCleanerCityProfile();
  const navigate = useNavigate();
  const location = useLocation();
  const arrivalNotice = (location.state as { notice?: string } | null)?.notice || '';

  if (!profile) {
    return (
      <AppLayout headerTitle="Route pins">
        <CleanerCityGate>
          <div className="p-4">
            <p className="text-sm text-muted-foreground">
              Complete{' '}
              <Link to="/cleaner-city/setup" className="text-primary font-semibold">
                set up
              </Link>{' '}
              first.
            </p>
          </div>
        </CleanerCityGate>
      </AppLayout>
    );
  }

  return (
    <AppLayout headerTitle="Office & pickup">
      <CleanerCityGate>
        <div
          className="mx-auto flex w-full max-w-lg flex-col gap-5 px-4 pb-28 pt-4"
          data-testid="cleaner-city-route-page"
        >
          {arrivalNotice ? (
            <div
              className="rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm leading-relaxed"
              data-testid="cleaner-city-route-guide"
            >
              {arrivalNotice}
            </div>
          ) : (
            <div>
              <h1 className="text-xl font-bold tracking-tight">Choose your usual road</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Pin office and home gate, then tap the Google path you drive to office and back home.
              </p>
            </div>
          )}

          <CleanerCityRouteSetupPanel
            onSaved={() => {
              /* chips update via query invalidate */
            }}
          />

          <Button
            className="h-12 w-full font-extrabold"
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
    </AppLayout>
  );
}
