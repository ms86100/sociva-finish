// @ts-nocheck
import { Link } from 'react-router-dom';
import { HandHelping, Search, UserPlus } from 'lucide-react';
import { useEffectiveFeatures } from '@/hooks/useEffectiveFeatures';
import { useHelpHubMode } from '@/hooks/queries/useHelpHub';
import { useAuth } from '@/contexts/AuthContext';
import { hapticSelection } from '@/lib/haptics';
import { cn } from '@/lib/utils';

/**
 * Home discovery entry for HelpHub - sits with "What are you looking for"
 * (not under search). Dual CTAs with a soft animated border.
 */
export function HelpHubTeaser({ className }: { className?: string }) {
  const { isFeatureEnabled, isLoading } = useEffectiveFeatures();
  const { forcedDemo } = useHelpHubMode();
  const { effectiveSocietyId } = useAuth();

  if (isLoading && !forcedDemo) return null;

  const enabled =
    forcedDemo ||
    isFeatureEnabled('helphub') ||
    (isFeatureEnabled('worker_marketplace') && !!effectiveSocietyId);

  if (!enabled) return null;

  return (
    <section
      className={cn('px-4 pt-4 pb-2', className)}
      data-testid="helphub-home-entry"
      aria-label="HelpHub - find and recommend help"
    >
      <div className="helphub-entry-shell rounded-[22px] p-[1.5px]">
        <div className="relative overflow-hidden rounded-[20.5px] bg-card px-3.5 py-3.5 shadow-card">
          <div
            className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-primary/10 blur-2xl"
            aria-hidden
          />
          <div className="relative flex items-start gap-2.5 mb-3">
            <div className="h-9 w-9 rounded-xl bg-primary/12 flex items-center justify-center shrink-0">
              <HandHelping className="text-primary" size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-extrabold tracking-tight text-foreground">
                  HelpHub
                </h3>
                <span className="rounded-full bg-primary/12 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary">
                  Society
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                Cooks, maids, nannies, drivers - find or recommend in your society
              </p>
            </div>
          </div>

          <div className="relative grid grid-cols-2 gap-2.5">
            <Link
              to="/help-hub/find"
              onClick={() => hapticSelection()}
              data-testid="helphub-home-find"
              className="group flex flex-col items-start gap-1.5 rounded-2xl border border-primary/25 bg-primary/8 px-3 py-3 active:scale-[0.98] transition-transform"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                <Search size={15} strokeWidth={2.4} />
              </span>
              <span className="text-[13px] font-bold text-foreground leading-tight">
                Find Help
              </span>
              <span className="text-[10px] text-muted-foreground leading-snug">
                Search & call nearby
              </span>
            </Link>

            <Link
              to="/help-hub/recommend"
              onClick={() => hapticSelection()}
              data-testid="helphub-home-recommend"
              className="group flex flex-col items-start gap-1.5 rounded-2xl border border-border bg-background/80 px-3 py-3 active:scale-[0.98] transition-transform hover:border-primary/30"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-foreground">
                <UserPlus size={15} strokeWidth={2.4} />
              </span>
              <span className="text-[13px] font-bold text-foreground leading-tight">
                Recommend
              </span>
              <span className="text-[10px] text-muted-foreground leading-snug">
                Share someone available
              </span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
