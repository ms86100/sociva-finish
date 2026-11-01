// @ts-nocheck
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { HelpHubGate } from '@/components/helphub/HelpHubGate';
import { useHelpHubMode } from '@/hooks/queries/useHelpHub';
import { Briefcase, Search, UserPlus, Users } from 'lucide-react';

const ACTIONS = [
  {
    to: '/help-hub/find',
    title: 'Find Help',
    subtitle: 'Residents find cooks, maids, nannies, drivers',
    icon: Search,
  },
  {
    to: '/help-hub/recommend',
    title: 'Recommend Someone',
    subtitle: 'Someone I know is available',
    icon: UserPlus,
  },
  {
    to: '/help-hub/work',
    title: 'Looking for Work',
    subtitle: 'Register availability yourself or with help',
    icon: Users,
  },
];

export default function HelpHubPage() {
  const { forcedDemo } = useHelpHubMode();

  return (
    <AppLayout headerTitle="HelpHub">
      <HelpHubGate>
        <div className="p-4 pb-24 space-y-4">
          <div>
            <h1 className="text-xl font-bold text-foreground">HelpHub</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Find trusted help. Discover local opportunities.
            </p>
            {forcedDemo && (
              <p className="text-[11px] text-warning mt-2">
                Demo mode - listings are local only (add ?live=1 after migration).
              </p>
            )}
          </div>

          <div className="space-y-3">
            {ACTIONS.map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.to}
                  to={action.to}
                  className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-card hover:border-primary/30 transition-colors"
                >
                  <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Icon className="text-primary" size={20} />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-foreground">{action.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{action.subtitle}</p>
                  </div>
                </Link>
              );
            })}
          </div>

          <Link
            to="/worker-hire"
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground pt-2"
          >
            <Briefcase size={14} />
            Need to hire for a specific job? Post a job request
          </Link>
        </div>
      </HelpHubGate>
    </AppLayout>
  );
}
